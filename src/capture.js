// Frame capture API: renders bot POV to PNG/JPEG
const { PNG } = require('pngjs')
const jpeg = require('jpeg-js')
const { createFrame } = require('./frame')
const { getCameraVP } = require('./camera')
const { renderMesh, frustumPlanes, aabbInFrustum } = require('./raster')
const { renderWorld } = require('./worldRender')
const { renderEntities } = require('./entities')
const { loadAtlasAndViewerAssets } = require('./atlas')
const { resolveTime, dayFactor, skyColor, bakeLight } = require('./light')
const { getDefaultVersion } = require('./config')

let cachedAssets = null
// Reused across renders: lit-colour buffer (light itself is cached per mesh).
const defaultLightScratch = { buf: null }

function getAssets(version, assetsVersion) {
  if (!cachedAssets) {
    cachedAssets = loadAtlasAndViewerAssets(version, assetsVersion)
  }
  return cachedAssets
}

function frameToPng(frame) {
  const png = new PNG({ width: frame.width, height: frame.height })
  png.data = frame.data
  return PNG.sync.write(png)
}

function frameToJpeg(frame, quality = 90) {
  return jpeg.encode(
    {
      data: Buffer.from(
        frame.data.buffer,
        frame.data.byteOffset,
        frame.data.length
      ),
      width: frame.width,
      height: frame.height
    },
    quality
  ).data
}

// renderFrame(bot, opts) → frame (no encoding). When opts.timing is an object
// it is filled with per-stage milliseconds: world, light, terrain, entities.
// Split out from captureFrame so benchmarks can separate render from encode.
function renderFrame(bot, opts = {}) {
  const width = opts.width || 640
  const height = opts.height || 360
  const version = (bot && bot.version) || opts.version || getDefaultVersion()

  // 1.21.4 → assets 1.21.4
  const assetsVersion = opts.assetsVersion || version
  const assets = getAssets(version, assetsVersion)

  const timing = opts.timing
  let t = 0

  // Collect world geometry around the bot. With opts.meshCache only sections
  // that aren't cached yet are meshed; otherwise every section is rebuilt.
  if (timing) t = performance.now()
  const meshes = opts.meshCache
    ? opts.meshCache.collect(bot, assets, opts.viewDistance || 6)
    : renderWorld(bot, assets, opts.viewDistance || 6)
  if (timing) {
    timing.world = performance.now() - t
    timing.meshes = meshes.length
    let tris = 0
    for (const m of meshes) tris += m.indices.length / 3
    timing.tris = tris
  }

  // Time of day drives sky colour and how much sky light counts; block light
  // (torches etc.) is unaffected. Override with opts.timeOfDay / TIME_OF_DAY.
  const timeOfDay = resolveTime(bot, opts)
  const factor = dayFactor(timeOfDay)

  const frame = createFrame(width, height, { skyColor: skyColor(timeOfDay) })
  const vp = getCameraVP(bot, width, height, opts)
  // Cull whole sections outside the camera frustum: they cannot touch a pixel,
  // so skip both the light bake and the triangle loop. opts.noCull disables it
  // (used to verify culling against the unculled output).
  const planes = opts.noCull ? null : frustumPlanes(vp)
  let culled = 0

  // Frustum-cull once: both passes draw the same survivor list.
  const visible = []
  for (const mesh of meshes) {
    if (
      planes &&
      mesh.aabb &&
      !aabbInFrustum(
        planes,
        mesh.aabb[0],
        mesh.aabb[1],
        mesh.aabb[2],
        mesh.aabb[3],
        mesh.aabb[4],
        mesh.aabb[5]
      )
    ) {
      culled++
      continue
    }
    visible.push(mesh)
  }

  // Light is baked into a scratch buffer per mesh (never into the cached mesh
  // itself, otherwise repeated frames would multiply the darkening). The
  // per-quad light was computed when the section was meshed.
  const scratch = opts.lightScratch || defaultLightScratch
  const atlas = {
    data: assets.atlasImage.data,
    width: assets.atlasImage.width,
    height: assets.atlasImage.height
  }
  let lightMs = 0
  let terrainMs = 0
  // Lit colours for blended meshes are kept between the passes in a per-mesh
  // scratch buffer (never in mesh.colors, so cached geometry stays unlit).
  const litColors = new Map()
  const bake = mesh => {
    if (!mesh.colors || opts.noLight) return undefined
    if (timing) t = performance.now()
    let colors
    if (mesh.translucent) {
      if (!mesh._litScratch || mesh._litScratch.length < mesh.colors.length) {
        mesh._litScratch = new Float32Array(mesh.colors.length)
      }
      colors = bakeLight(mesh, factor, { buf: mesh._litScratch })
      litColors.set(mesh, colors)
    } else {
      colors = bakeLight(mesh, factor, scratch)
    }
    if (timing) lightMs += performance.now() - t
    return colors
  }

  // Pass 1: opaque terrain and alpha cutouts write depth.
  for (const mesh of visible) {
    const colors = bake(mesh)
    if (timing) t = performance.now()
    renderMesh(frame, vp, mesh, atlas, {
      colors,
      pass: 'opaque',
      indices: mesh.opaqueIndices || mesh.indices
    })
    if (timing) terrainMs += performance.now() - t
  }

  // Entities are opaque as well; drawing them before the blended pass lets
  // water blend over a submerged entity instead of being painted over.
  if (timing) t = performance.now()
  renderEntities(bot, frame, vp, assets, { ...opts, lightFactor: factor })
  if (timing) timing.entities = performance.now() - t

  // Pass 2: blended blocks, far to near. Sections are the sort unit; the
  // depth-free blend is order-independent enough within one section.
  const eye = (bot.entity && bot.entity.position) || { x: 0, y: 0, z: 0 }
  const eyeY = eye.y + 1.62
  const dist2 = mesh => {
    const a = mesh.aabb
    const dx = (a[0] + a[3]) * 0.5 - eye.x
    const dy = (a[1] + a[4]) * 0.5 - eyeY
    const dz = (a[2] + a[5]) * 0.5 - eye.z
    return dx * dx + dy * dy + dz * dz
  }
  const blendedMeshes = visible
    .filter(mesh => mesh.translucent)
    .sort((a, b) => dist2(b) - dist2(a))
  for (const mesh of blendedMeshes) {
    if (timing) t = performance.now()
    renderMesh(frame, vp, mesh, atlas, {
      colors: litColors.get(mesh),
      pass: 'translucent',
      indices: mesh.translucentIndices
    })
    if (timing) terrainMs += performance.now() - t
  }

  if (timing) {
    timing.light = lightMs
    timing.terrain = terrainMs
    timing.culled = culled
  }

  return frame
}

// captureFrame(bot, { width, height, format, yaw, pitch, fov, viewDistance })
// Returns a Buffer (PNG by default).
async function captureFrame(bot, opts = {}) {
  const frame = renderFrame(bot, opts)
  const format = opts.format || 'png'
  return format === 'jpeg'
    ? frameToJpeg(frame, opts.quality)
    : frameToPng(frame)
}

module.exports = {
  captureFrame,
  renderFrame,
  frameToPng,
  frameToJpeg,
  getAssets
}
