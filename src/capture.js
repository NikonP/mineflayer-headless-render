// Frame capture API: renders bot POV to PNG/JPEG
const { PNG } = require('pngjs')
const jpeg = require('jpeg-js')
const { createFrame } = require('./frame')
const { getCameraVP } = require('./camera')
const { renderMesh } = require('./raster')
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
  for (const mesh of meshes) {
    let colors
    if (mesh.colors && !opts.noLight) {
      if (timing) t = performance.now()
      colors = bakeLight(mesh, factor, scratch)
      if (timing) lightMs += performance.now() - t
    }
    if (timing) t = performance.now()
    renderMesh(frame, vp, mesh, atlas, { colors })
    if (timing) terrainMs += performance.now() - t
  }
  if (timing) {
    timing.light = lightMs
    timing.terrain = terrainMs
  }

  if (timing) t = performance.now()
  renderEntities(bot, frame, vp, assets, { ...opts, lightFactor: factor })
  if (timing) timing.entities = performance.now() - t

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
