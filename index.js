// mineflayer-headless-render
//
// Headless POV frame capture for a mineflayer bot: renders what the bot sees to
// PNG/JPEG with a software rasterizer (no GPU, no canvas, no WebGL).
//
//   const { captureFrame, PovRenderer } = require('mineflayer-headless-render')
//
//   // one-shot
//   const png = await captureFrame(bot, { width: 640, height: 360 })
//
//   // live bot: keep section meshes between frames
//   const pov = new PovRenderer({ viewDistance: 6 })
//   pov.attach(bot)
//   const png = pov.capture({ yaw, pitch })
//   pov.detach()
const { captureFrame, renderFrame, frameToPng, frameToJpeg, getAssets } = require('./src/capture')
const { PovRenderer } = require('./src/renderer')
const { configure, DEFAULT_VERSION } = require('./src/config')

module.exports = {
  captureFrame,
  renderFrame,
  frameToPng,
  frameToJpeg,
  getAssets,
  PovRenderer,
  configure,
  DEFAULT_VERSION
}
