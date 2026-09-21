// Framebuffer with z-buffer and sky background
// opts.skyColor: [r, g, b] background (day/dusk/night), defaults to day blue.
function createFrame(width, height, opts = {}) {
  const data = new Uint8ClampedArray(width * height * 4)
  const sky = opts.skyColor || [0x78, 0xa7, 0xff]
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = sky[0]
    data[i * 4 + 1] = sky[1]
    data[i * 4 + 2] = sky[2]
    data[i * 4 + 3] = 255
  }
  return {
    width,
    height,
    data,
    zbuffer: new Float32Array(width * height).fill(Infinity),
    _clip: new Float32Array(0)
  }
}

module.exports = { createFrame }
