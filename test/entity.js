// Offline entity render: no server needed. Renders a few Bedrock models with a
// deterministic camera and writes PNGs so model/UV regressions are visible.
//
//   node test/entity.js [name ...]     # default: zombie creeper cow
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

// Light grey floor quad so silhouettes read against something.
const floor = {
  positions: new Float32Array([-4, 0, -4, 4, 0, -4, 4, 0, 4, -4, 0, 4]),
  uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
  colors: new Float32Array([0.82, 0.82, 0.82, ...Array(11).fill(1)]),
  indices: new Uint32Array([0, 2, 1, 0, 3, 2]),
  sx: 0,
  sy: 0,
  sz: 0
}

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

fs.mkdirSync(outDir, { recursive: true })
for (const name of names) {
  const model = getEntityModel(name, version)
  if (!model) {
    console.error(name, ': no model')
    continue
  }
  const frame = createFrame(320, 320)
  // eye 2.2m from the model so the silhouette reads at 320px
  const vp = makeViewProjection(0, 1.0, -3, Math.PI, 0, 70, 1, 0.1, 200)
  renderMesh(frame, vp, floor, floorAtlas, { backfaceCull: false })
  // entity yaw 0 faces -z, toward the camera at z=-3
  const mesh = composeEntityMesh(model, {
    position: { x: 0, y: 0, z: 0 },
    yaw: 0
  })
  renderMesh(frame, vp, mesh, model.texture, { backfaceCull: false })
  const png = new PNG({ width: frame.width, height: frame.height })
  png.data = frame.data
  fs.writeFileSync(
    path.join(outDir, 'unit_' + name + '.png'),
    PNG.sync.write(png)
  )
  console.log('saved', name)
}
