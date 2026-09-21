// Dropped-item rendering. Item entities have no Bedrock model: vanilla draws
// them as a flat sprite of the item's texture. We render a camera-facing
// billboard quad with that texture (an approximation that keeps items readable
// from any angle). Textures come from minecraft-assets: items/*.png for plain
// items, blocks/*.png for block items (torch, planks, ...).
const fs = require('fs')
const path = require('path')
const { PNG } = require('pngjs')
const mcData = require('minecraft-data')
const mcAssets = require('minecraft-assets')

const assetsCache = new Map()
const texCache = new Map()

function getAssets (version) {
  let a = assetsCache.get(version)
  if (!a) {
    a = mcAssets(version)
    assetsCache.set(version, a)
  }
  return a
}

// The dropped stack lives in entity metadata as { itemId, itemCount }; its slot
// index varies by version, so find it by shape.
function itemStack (entity) {
  const meta = entity.metadata
  if (!Array.isArray(meta)) return null
  for (const m of meta) {
    if (m && typeof m === 'object' && typeof m.itemId === 'number' && (m.itemCount !== undefined || m.count !== undefined)) return m
  }
  return null
}

function itemName (entity, version) {
  const stack = itemStack(entity)
  if (!stack || stack.itemId <= 0) return null
  const data = mcData(version)
  const item = (data.items && data.items[stack.itemId]) || (data.itemsById && data.itemsById[stack.itemId])
  return item ? item.name : null
}

// Resolve the sprite PNG: item texture first, then the block texture for
// block items, then a name-based guess.
function textureFile (assets, name) {
  const candidates = []
  const entry = assets.items && assets.items[name]
  if (entry && entry.texture) {
    const rel = entry.texture.replace(/^minecraft:/, '')
    candidates.push(rel)
    if (rel.startsWith('block/')) candidates.push('blocks/' + rel.slice('block/'.length))
  }
  candidates.push('items/' + name)
  candidates.push('blocks/' + name)
  for (const rel of candidates) {
    const file = path.join(assets.directory, rel + '.png')
    if (fs.existsSync(file)) return file
  }
  return null
}

// Decoded RGBA sprite, first animation frame only. Cached per version+name.
function itemTexture (version, name) {
  const key = version + ':' + name
  if (texCache.has(key)) return texCache.get(key)
  let tex = null
  try {
    const assets = getAssets(version)
    const file = textureFile(assets, name)
    if (file) {
      const png = PNG.sync.read(fs.readFileSync(file))
      let data = png.data
      let height = png.height
      if (png.height > png.width) { // animated strip: keep the first frame
        height = png.width
        data = data.subarray(0, png.width * height * 4)
      }
      tex = { data, width: png.width, height }
    }
  } catch (e) {
    tex = null
  }
  texCache.set(key, tex)
  return tex
}

// Camera-facing quad for one dropped item. `right`/`up` are the camera basis
// vectors in world space (derived from the view-projection matrix).
function buildSpriteMesh (entity, right, up, opts = {}) {
  const size = opts.size || 0.45
  const half = size / 2
  const lift = opts.lift !== undefined ? opts.lift : 0.3
  const p = entity.position
  const cx = p.x
  const cy = p.y + lift
  const cz = p.z
  const [rx, ry, rz] = right
  const [ux, uy, uz] = up

  const corners = [
    [-half, half, 0, 0], // top-left
    [half, half, 1, 0], // top-right
    [half, -half, 1, 1], // bottom-right
    [-half, -half, 0, 1] // bottom-left
  ]
  const positions = new Float32Array(12)
  const uvs = new Float32Array(8)
  for (let i = 0; i < 4; i++) {
    const [a, b, u, v] = corners[i]
    positions[i * 3] = cx + rx * a + ux * b
    positions[i * 3 + 1] = cy + ry * a + uy * b
    positions[i * 3 + 2] = cz + rz * a + uz * b
    uvs[i * 2] = u
    uvs[i * 2 + 1] = v
  }
  return {
    positions,
    uvs,
    colors: new Float32Array(12).fill(1),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    sx: 0,
    sy: 0,
    sz: 0
  }
}

module.exports = { itemName, itemTexture, buildSpriteMesh }
