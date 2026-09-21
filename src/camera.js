// Software-rendered first-person camera from bot state
const { makeViewProjection } = require('./raster')

const EYE_HEIGHT = 1.62

// Camera convention notes (verified against mineflayer/lib/conversions.js):
// bot yaw = PI - notchianYaw → mineflayer yaw 0 looks north (-Z);
// bot pitch = -notchianPitch → mineflayer pitch positive = UP.
function getCameraVP(bot, width, height, opts = {}) {
  const pos = bot.entity.position
  const yaw = opts.yaw !== undefined ? opts.yaw : bot.entity.yaw
  const pitch = opts.pitch !== undefined ? opts.pitch : bot.entity.pitch
  const fov = opts.fov || 70
  const near = opts.near || 0.05
  const far = opts.far || 1000

  return makeViewProjection(
    pos.x,
    pos.y + EYE_HEIGHT,
    pos.z,
    yaw,
    pitch,
    fov,
    width / height,
    near,
    far
  )
}

module.exports = { getCameraVP, EYE_HEIGHT }
