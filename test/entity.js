// Offline entity render: no server needed. Renders Bedrock models front and
// side with a deterministic, auto-framed camera and writes PNGs so model/UV
// regressions are visible.
//
//   node test/entity.js [name ...]     # default: zombie creeper cow
//
// Each requested name writes out/<name>_front.png and out/<name>_side.png.
// Names without a Bedrock model/texture pair are reported and skipped (the
// live renderer falls back to a coloured box for those).
//
// Requires a bedrock-samples checkout (see scripts/setup-assets.sh).
const fs = require('fs')
const path = require('path')
const { PNG } = require('pngjs')
const { makeViewProjection, renderMesh } = require('../src/raster')
const { getEntityModel, composeEntityMesh } = require('../src/entityModels')
const { createFrame } = require('../src/frame')

const version = process.env.MC_VERSION || '1.21.4'
const names = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['zombie', 'creeper', 'cow']
const outDir = path.join(__dirname, 'out')

const SIZE = 320
const FOV = 45
// front looks south (+z) at the entity, whose yaw-0 model faces north (-z);
// side looks west (-x) from the entity's east side.
const VIEWS = {
  front: { yaw: Math.PI, axis: 'z', sign: -1 },
  side: { yaw: Math.PI / 2, axis: 'x', sign: 1 }
}

// Light grey floor so silhouettes read against something.
const floorAtlas = (() => {
  const data = new Uint8ClampedArray(2 * 2 * 4)
  for (let i = 0; i < 4; i++) {
    data[i * 4] = 200
    data[i * 4 + 1] = 200
    data[i * 4 + 2] = 200
    data[i * 4 + 3] = 255
  }
  return { data, width: 2, height: 2 }
})()

function bounds(positions) {
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]
    const y = positions[i + 1]
    const z = positions[i + 2]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  return { minX, minY, minZ, maxX, maxY, maxZ }
}

// Frame the model so it fills a fixed fraction of the view regardless of size;
// without this, big mobs (ender dragon, ghast) spill off the frame.
function cameraFor(b, view) {
  const cx = (b.minX + b.maxX) / 2
  const cy = (b.minY + b.maxY) / 2
  const cz = (b.minZ + b.maxZ) / 2
  const radius = Math.max(
    (b.maxX - b.minX) / 2,
    (b.maxY - b.minY) / 2,
    (b.maxZ - b.minZ) / 2
  )
  const dist = (radius / Math.tan((FOV * Math.PI) / 360)) * 1.15 + 0.4
  const eye = { x: cx, y: cy + 0.1, z: cz }
  eye[view.axis] += dist * view.sign
  return makeViewProjection(eye.x, eye.y, eye.z, view.yaw, 0, FOV, 1, 0.05, 500)
}

function renderView(model, view) {
  const b = bounds(model.positions)
  const frame = createFrame(SIZE, SIZE)
  const vp = cameraFor(b, view)

  const floor = {
    positions: new Float32Array([-8, 0, -8, 8, 0, -8, 8, 0, 8, -8, 0, 8]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    colors: new Float32Array([0.82, 0.82, 0.82, ...Array(11).fill(1)]),
    indices: new Uint32Array([0, 2, 1, 0, 3, 2]),
    sx: 0,
    sy: 0,
    sz: 0
  }
  renderMesh(frame, vp, floor, floorAtlas, { backfaceCull: false })

  // entity yaw 0 faces -z; front/side cameras look at the corresponding faces
  const mesh = composeEntityMesh(model, {
    position: { x: 0, y: 0, z: 0 },
    yaw: 0
  })
  renderMesh(frame, vp, mesh, model.texture, { backfaceCull: false })
  return frame
}

function writeFrame(file, frame) {
  const png = new PNG({ width: frame.width, height: frame.height })
  png.data = frame.data
  fs.writeFileSync(file, PNG.sync.write(png))
}

fs.mkdirSync(outDir, { recursive: true })
let missing = 0
for (const name of names) {
  const model = getEntityModel(name, version)
  if (!model) {
    console.error(name, ': no model (falls back to a coloured box)')
    missing++
    continue
  }
  for (const [viewName, view] of Object.entries(VIEWS)) {
    const frame = renderView(model, view)
    writeFrame(
      path.join(outDir, 'unit_' + name + '_' + viewName + '.png'),
      frame
    )
  }
  console.log('saved', name)
}
if (missing) console.error(missing + ' of ' + names.length + ' had no model')
