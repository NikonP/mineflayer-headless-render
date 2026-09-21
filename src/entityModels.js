// Entity model loader: converts Bedrock-geometry models into indexed triangle
// meshes with per-vertex UVs for our software rasterizer.
//
// Geometry, entity definitions and textures all come from the bedrock-samples
// submodule (the vanilla Bedrock resource pack), so the uv layout and the
// texture files match 1:1 — no cross-edition normalization hacks. The pack is
// pinned to a tag chosen as the closest Bedrock release to the java version we
// render; bedrock entity assets do not change often, so no per-version mapping
// is applied.
//
// Every .json under models/ is indexed, not just the per-entity *.geo.json:
// a few mobs (player, iron golem, skull, ...) define their geometry in the
// shared models/mobs.json. Entity defs that key their geometry or textures by
// variant with no "default" (tropicalfish, horse, cat, ...) get one
// deterministic variant — mineflayer doesn't expose the actual variant, and any
// one is recognizable.
//
// Conversion (mirrors prismarine-viewer/viewer/lib/entity/Entity.js):
// - static bind pose only: bind_pose_rotation/rotation are applied to a bone's
//   own cubes around its pivot, but do NOT propagate to children — the cube
//   origins in these models are already authored in the final pose, and
//   inheriting rotations (as the three.js scene graph does) tips heads/legs
// - model space is x-mirrored and scaled by 1/16: world = (-x/16, y/16, z/16)
// - y=0 is the entity's feet, x/z centered on the hitbox
// - yaw rotation to world space happens in composeEntityMesh
const fs = require('fs')
const path = require('path')
const { PNG } = require('pngjs')
const { decodeTGA } = require('./tga')
const { getBedrockPath } = require('./config')

// Asset roots are resolved lazily so BEDROCK_SAMPLES_PATH / configure() can be
// applied before the first model is built.
function bedrockRoot () { return path.join(getBedrockPath(), 'resource_pack') }
function modelDir () { return path.join(bedrockRoot(), 'models') }
function entityDir () { return path.join(bedrockRoot(), 'entity') }
function textureDir () { return path.join(bedrockRoot(), 'textures') }

// mineflayer entity name -> bedrock asset base name, when they differ
const bedrockAlias = {
  mooshroom: 'cow',
  cave_spider: 'spider',
  wandering_trader: 'villager',
  trader_llama: 'llama',
  piglin_brute: 'piglin',
  zoglin: 'hoglin',
  elder_guardian: 'guardian',
  horse: 'horse_v3',
  donkey: 'donkey_v3',
  mule: 'mule_v3',
  skeleton_horse: 'skeleton_horse_v3',
  zombie_horse: 'zombie_horse_v3'
}

// Textures for entities whose bedrock entity.json only lists variant/profession
// keys (no "default") and whose variant we cannot know from mineflayer.
const textureOverride = {
  villager: 'entity/villager/villager',
  zombie_villager: 'entity/zombie_villager/zombie_villager'
}

// Per-face UV setup, copied from Entity.js elemFaces (bedrock box faces).
// corners: [x, y, z, uSel, vSel] — uSel/vSel pick the u0/v0 vs u1/v1 basis,
// dotted with the cube size to walk the texture sheet.
const elemFaces = {
  up: {
    u0: [0, 0, 1], v0: [0, 0, 0], u1: [1, 0, 1], v1: [0, 0, 1],
    corners: [[0, 1, 1, 0, 0], [1, 1, 1, 1, 0], [0, 1, 0, 0, 1], [1, 1, 0, 1, 1]]
  },
  down: {
    u0: [1, 0, 1], v0: [0, 0, 0], u1: [2, 0, 1], v1: [0, 0, 1],
    corners: [[1, 0, 1, 1, 0], [0, 0, 1, 0, 0], [1, 0, 0, 1, 1], [0, 0, 0, 0, 1]]
  },
  east: {
    u0: [1, 0, 1], v0: [0, 0, 1], u1: [1, 0, 2], v1: [0, 1, 1],
    corners: [[1, 1, 1, 1, 0], [1, 0, 1, 1, 1], [1, 1, 0, 0, 0], [1, 0, 0, 0, 1]]
  },
  west: {
    u0: [0, 0, 0], v0: [0, 0, 1], u1: [0, 0, 1], v1: [0, 1, 1],
    corners: [[0, 1, 0, 1, 0], [0, 0, 0, 1, 1], [0, 1, 1, 0, 0], [0, 0, 1, 0, 1]]
  },
  north: {
    u0: [0, 0, 1], v0: [0, 0, 1], u1: [1, 0, 1], v1: [0, 1, 1],
    corners: [[1, 0, 0, 1, 1], [0, 0, 0, 0, 1], [1, 1, 0, 1, 0], [0, 1, 0, 0, 0]]
  },
  south: {
    u0: [1, 0, 2], v0: [0, 0, 1], u1: [2, 0, 2], v1: [0, 1, 1],
    corners: [[0, 0, 1, 1, 1], [1, 0, 1, 0, 1], [0, 1, 1, 1, 0], [1, 1, 1, 0, 0]]
  }
}

function dot (a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

// Minimal 3D math, replacing the three.js Vector3/Euler this file used to pull
// in. Matches three.js semantics: Euler order 'XYZ', row-major 3x3.
function matFromEuler (e) {
  const cx = Math.cos(e.x); const sx = Math.sin(e.x)
  const cy = Math.cos(e.y); const sy = Math.sin(e.y)
  const cz = Math.cos(e.z); const sz = Math.sin(e.z)
  return [
    cy * cz, -cy * sz, sy,
    cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy,
    sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy
  ]
}

function eulerFromDegrees (r) {
  return { x: -r[0] * Math.PI / 180, y: -r[1] * Math.PI / 180, z: -r[2] * Math.PI / 180 }
}

// Rotate (x, y, z) around `pivot` by matrix m, writing into out.
function rotateAround (m, pivot, x, y, z, out) {
  const vx = x - pivot[0]
  const vy = y - pivot[1]
  const vz = z - pivot[2]
  out[0] = m[0] * vx + m[1] * vy + m[2] * vz + pivot[0]
  out[1] = m[3] * vx + m[4] * vy + m[5] * vz + pivot[1]
  out[2] = m[6] * vx + m[7] * vy + m[8] * vz + pivot[2]
}

function readJson (file) {
  try {
    return JSON.parse(fs.readFileSync(file))
  } catch (err) {
    return null
  }
}

// Assets are read once; the packed mesh and rgba texture stay resident.
const geoFileCache = new Map()
const entityDefCache = new Map()
const geoIndexCache = new Map() // identifier -> { bones, texturewidth, textureheight }

function parseGeoFile (json) {
  const out = []
  if (!json) return out
  if (json['minecraft:geometry']) {
    // 1.12+ format: an array of { description, bones }
    for (const geo of json['minecraft:geometry']) {
      const desc = geo.description || {}
      out.push([desc.identifier, {
        bones: geo.bones || [],
        texturewidth: desc.texture_width || 64,
        textureheight: desc.texture_height || 64
      }])
    }
    return out
  }
  for (const [key, geo] of Object.entries(json)) {
    if (!key.startsWith('geometry.') || !geo || !geo.bones) continue
    const entry = {
      bones: geo.bones,
      texturewidth: geo.texturewidth || 64,
      textureheight: geo.textureheight || 64
    }
    out.push([key, entry])
    // "geometry.child:geometry.parent" — the key is a derived geometry
    // referenced by its part before the colon (sheep fur derives from sheared)
    const colon = key.indexOf(':')
    if (colon !== -1) out.push([key.slice(0, colon), entry])
  }
  return out
}

// Geometry identifiers can live in any model file — most are per-entity
// *.geo.json, but a few (player, iron golem, skull, ...) are defined in the
// shared models/mobs.json. Index every .json under models/ so an entity def's
// geometry.default always resolves. Built lazily, once.
function listModelFiles (dir, out = []) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    return out
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) listModelFiles(full, out)
    else if (entry.name.endsWith('.json')) out.push(full)
  }
  return out
}

function buildGeoIndex () {
  if (geoIndexCache.size) return geoIndexCache
  for (const full of listModelFiles(modelDir())) {
    let json = geoFileCache.get(full)
    if (json === undefined) {
      json = readJson(full)
      geoFileCache.set(full, json)
    }
    for (const [identifier, geo] of parseGeoFile(json)) {
      if (!geoIndexCache.has(identifier)) geoIndexCache.set(identifier, geo)
    }
  }
  return geoIndexCache
}

function entityDef (base) {
  if (entityDefCache.has(base)) return entityDefCache.get(base)
  const def = readJson(path.join(entityDir(), base + '.entity.json'))
  const description = def && def['minecraft:client_entity'] && def['minecraft:client_entity'].description
  entityDefCache.set(base, description || null)
  return entityDefCache.get(base)
}

// Asset texture cache: texPath like "entity/zombie/zombie" (no extension).
const textureCache = new Map()

function loadEntityTexture (texPath) {
  if (textureCache.has(texPath)) return textureCache.get(texPath)
  let tex = null
  for (const ext of ['.png', '.tga']) {
    const file = path.join(textureDir(), texPath + ext)
    try {
      const buf = fs.readFileSync(file)
      tex = ext === '.tga' ? decodeTGA(buf) : PNG.sync.read(buf)
      break
    } catch (err) { /* try next extension */ }
  }
  textureCache.set(texPath, tex)
  return tex
}

// Geometry layers baked into one mesh. The sheep's woolly fur shell has no
// face texels (its head is a plain wool box); the face lives on the sheared
// layer, whose longer snout pokes out in front of the fur box, so both are
// drawn. Vanilla picks a layer via query.is_sheared, which we don't have.
const extraGeometryKeys = { sheep: ['sheared'] }

// Some entity defs key their textures by variant/profession with no "default"
// (cat, fox, horse, llama, ...). mineflayer doesn't expose the variant, so pick
// one deterministically: prefer "default", else the first key as authored. Any
// one variant is enough to recognize the mob.
function pickTexture (textures) {
  const keys = Object.keys(textures).filter(k => typeof textures[k] === 'string')
  const key = textures.default ? 'default' : keys[0]
  return key ? textures[key].replace(/^textures\//, '') : null
}

// Same idea for geometry: some defs only key it by variant (tropicalfish:
// typeA/typeB). Prefer "default", else the first key as authored.
function pickGeometry (geometry) {
  if (!geometry) return null
  const key = geometry.default ? 'default' : Object.keys(geometry)[0]
  return key || null
}

const modelCache = new Map()

// Build the static-pose mesh for an entity type.
// Returns { positions, uvs, colors, indices, texture } (model space, feet at
// y=0), or null when the client falls back to a colored box.
function getEntityModel (name, version) {
  if (!name) return null
  const key = version + ':' + name
  if (modelCache.has(key)) return modelCache.get(key)
  let model = null
  try {
    model = buildEntityModel(name)
  } catch (err) {
    // one malformed model must not take down the whole frame: fall back to the
    // colored box instead
    model = null
  }
  modelCache.set(key, model)
  return model
}

function buildEntityModel (name) {
  const base = bedrockAlias[name] || name
  const desc = entityDef(base)
  if (!desc || !desc.geometry) return null
  const primary = pickGeometry(desc.geometry)
  if (!primary) return null
  const texPath = textureOverride[name] || textureOverride[base] || pickTexture(desc.textures || {})
  if (!texPath) return null
  const layers = []
  for (const key of [primary, ...(extraGeometryKeys[name] || [])]) {
    const geometry = desc.geometry[key] && buildGeoIndex().get(desc.geometry[key])
    if (geometry) layers.push({ geometry, texPath })
  }
  if (!layers.length) return null
  const texture = loadEntityTexture(texPath)
  if (!texture) return null

  const positions = []
  const uvs = []
  const indices = []
  const tmp = [0, 0, 0]

  for (const { geometry } of layers) {
    const texW = geometry.texturewidth || 64
    const texH = geometry.textureheight || 64

    for (const bone of geometry.bones) {
      if (bone.neverRender || !bone.cubes) continue
      // bind-pose / static rotations apply to this bone's own cubes only;
      // cube pivots in these models are already laid out for the final pose,
      // so children do not inherit the rotation (matches how the flat static
      // geometry is authored)
      const pivot = bone.pivot || [0, 0, 0]
      const boneEuler = bone.bind_pose_rotation
        ? eulerFromDegrees(bone.bind_pose_rotation)
        : (bone.rotation && typeof bone.rotation[0] === 'number' ? eulerFromDegrees(bone.rotation) : null)
      const boneMat = boneEuler ? matFromEuler(boneEuler) : null
      for (const cube of bone.cubes) {
        // cubes without a uv (leash_knot, tripod_camera) are drawn through a
        // render controller/material, not the texture sheet — skip them
        if (!cube.uv) continue
        // mirrored cubes flip the texture within each face's u span
        const swapU = !!bone.mirror
        // A cube's rotation pivots around its own `pivot` when given, otherwise
        // around the center of the box (geometry schema); rotating around the
        // model origin throws rotated cubes (chicken body, goat head, ...) away.
        const cubePivot = cube.pivot || [
          cube.origin[0] + cube.size[0] / 2,
          cube.origin[1] + cube.size[1] / 2,
          cube.origin[2] + cube.size[2] / 2
        ]
        const cubeMat = cube.rotation ? matFromEuler(eulerFromDegrees(cube.rotation)) : null
        for (const { corners, u0, v0, u1, v1 } of Object.values(elemFaces)) {
          const ndx = positions.length / 3
          for (const pos of corners) {
            const inflate = cube.inflate || 0
            let x = cube.origin[0] + pos[0] * cube.size[0] + (pos[0] ? inflate : -inflate)
            let y = cube.origin[1] + pos[1] * cube.size[1] + (pos[1] ? inflate : -inflate)
            let z = cube.origin[2] + pos[2] * cube.size[2] + (pos[2] ? inflate : -inflate)
            if (cubeMat) {
              rotateAround(cubeMat, cubePivot, x, y, z, tmp)
              x = tmp[0]; y = tmp[1]; z = tmp[2]
            }
            if (boneMat) {
              rotateAround(boneMat, pivot, x, y, z, tmp)
              x = tmp[0]; y = tmp[1]; z = tmp[2]
            }
            // mirror x, scale to block units
            positions.push(-x / 16, y / 16, z / 16)
            const uSel = swapU ? (pos[3] ? u0 : u1) : (pos[3] ? u1 : u0)
            const u = (cube.uv[0] + dot(uSel, cube.size)) / texW
            const v = (cube.uv[1] + dot(pos[4] ? v1 : v0, cube.size)) / texH
            uvs.push(u, v)
          }
          indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3)
        }
      }
    }
  }
  // nothing survived (only uv-less cubes): treat as unrenderable
  if (!positions.length) return null
  // white vertex colors: renderMesh multiplies texel by color
  const nVerts = positions.length / 3
  const colors = new Float32Array(nVerts * 3).fill(1)

  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    colors,
    indices: new Uint32Array(indices),
    texture
  }
}

// Bake one entity instance: yaw-rotate the model around Y and translate to the
// entity's feet position. Returns a mesh object renderMesh can consume, with
// rotation applied in place (model cache stays untouched).
const composeBufCache = new Map()
function composeEntityMesh (model, entity) {
  const n = model.positions.length
  let buf = composeBufCache.get(model)
  if (!buf || buf.length < n * 3) {
    buf = new Float32Array(n * 3)
    composeBufCache.set(model, buf)
  }
  const yaw = entity.yaw || 0
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const px = entity.position.x
  const py = entity.position.y
  const pz = entity.position.z
  for (let i = 0; i < n; i++) {
    const mx = model.positions[i * 3]
    const my = model.positions[i * 3 + 1]
    const mz = model.positions[i * 3 + 2]
    // rotate around Y (three.js convention, same as prismarine-viewer applies
    // to the mirrored mesh)
    const rx = cy * mx + sy * mz
    const rz = -sy * mx + cy * mz
    buf[i * 3] = px + rx
    buf[i * 3 + 1] = py + my
    buf[i * 3 + 2] = pz + rz
  }
  return {
    positions: buf,
    uvs: model.uvs,
    colors: model.colors,
    indices: model.indices,
    sx: 0, sy: 0, sz: 0
  }
}

module.exports = { getEntityModel, composeEntityMesh, clearAssetCaches }

// Drops every cached asset; used when the Bedrock asset root changes.
function clearAssetCaches () {
  geoFileCache.clear()
  entityDefCache.clear()
  geoIndexCache.clear()
  textureCache.clear()
  modelCache.clear()
}
