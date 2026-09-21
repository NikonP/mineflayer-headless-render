// Entity rendering: textured Bedrock models (via entityModels), colored box
// fallback for anything without a model/textures pair.
const { renderSolidMesh, renderMesh } = require('./raster')
const { getEntityModel, composeEntityMesh } = require('./entityModels')
const { entityBrightness } = require('./light')
const { getHeightmap } = require('./heightmap')
const { itemName, itemTexture, buildSpriteMesh } = require('./items')
const { getDefaultVersion } = require('./config')

// World-space camera right/up, taken from the view-projection matrix rows
// (VP = P·V, so rows 0 and 1 are the scaled camera basis). Used for billboards.
function cameraBasis (vp) {
  let rx = vp[0]
  let ry = vp[1]
  let rz = vp[2]
  let ux = vp[4]
  let uy = vp[5]
  let uz = vp[6]
  const rl = Math.hypot(rx, ry, rz) || 1
  const ul = Math.hypot(ux, uy, uz) || 1
  rx /= rl; ry /= rl; rz /= rl
  ux /= ul; uy /= ul; uz /= ul
  return { right: [rx, ry, rz], up: [ux, uy, uz] }
}

// Deterministic color per entity type
function colorForType (type) {
  let hash = 0
  for (let i = 0; i < type.length; i++) hash = (hash * 31 + type.charCodeAt(i)) & 0xffffff
  const r = 80 + (hash & 0x7f)
  const g = 80 + ((hash >> 8) & 0x7f)
  const b = 80 + ((hash >> 16) & 0x7f)
  return [r, g, b]
}

// Axis-aligned box: 8 vertices, 12 triangles
function boxGeometry (minX, minY, minZ, maxX, maxY, maxZ) {
  const v = [
    [minX, minY, minZ], [maxX, minY, minZ], [maxX, maxY, minZ], [minX, maxY, minZ],
    [minX, minY, maxZ], [maxX, minY, maxZ], [maxX, maxY, maxZ], [minX, maxY, maxZ]
  ]
  const idx = [
    0, 2, 1, 0, 3, 2, // -Z
    4, 5, 6, 4, 6, 7, // +Z
    0, 1, 5, 0, 5, 4, // -Y
    3, 6, 2, 3, 7, 6, // +Y
    0, 7, 3, 0, 4, 7, // -X
    1, 2, 6, 1, 6, 5 // +X
  ]
  const positions = new Float32Array(24)
  v.forEach((p, i) => {
    positions[i * 3] = p[0]
    positions[i * 3 + 1] = p[1]
    positions[i * 3 + 2] = p[2]
  })
  return { positions, indices: idx }
}

function renderEntities (bot, frame, vp, assets, opts = {}) {
  const includeSelf = opts.includeSelf || false
  const version = bot.version || getDefaultVersion()
  const factor = opts.lightFactor !== undefined ? opts.lightFactor : 1
  const basis = cameraBasis(vp)
  const heightmap = getHeightmap(bot)
  for (const entity of Object.values(bot.entities)) {
    if (entity === bot.entity && !includeSelf) continue
    if (!entity.position) continue
    if (entity.name === 'player' && entity.username === bot.username && !includeSelf) continue

    const light = entityBrightness(bot.world, entity, factor, heightmap)

    // Dropped items: texture billboard (no Bedrock model exists for them).
    if (entity.name === 'item' || entity.name === 'item_stack') {
      const name = itemName(entity, version)
      const tex = name ? itemTexture(version, name) : null
      if (tex) {
        const mesh = buildSpriteMesh(entity, basis.right, basis.up)
        renderMesh(frame, vp, mesh, tex, { backfaceCull: false, brightness: light })
        continue
      }
    }

    const model = getEntityModel(entity.name, version)
    if (model) {
      const mesh = composeEntityMesh(model, entity)
      // model.colors is shared/cached — brightness is applied as a uniform
      renderMesh(frame, vp, mesh, model.texture, { backfaceCull: false, brightness: light })
      continue
    }

    // Fallback: colored box
    const w = (entity.width || 0.6) / 2
    const h = entity.height || 1.8
    const p = entity.position
    const [r, g, b] = colorForType(entity.name || entity.type || 'unknown')
    const geom = boxGeometry(p.x - w, p.y, p.z - w, p.x + w, p.y + h, p.z + w)
    renderSolidMesh(frame, vp, geom.positions, geom.indices, r, g, b, light)
  }
}

module.exports = { renderEntities }
