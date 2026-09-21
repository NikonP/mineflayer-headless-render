// Minimal Truevision TGA decoder for the Bedrock entity textures that ship as
// .tga (e.g. sheep). Supports uncompressed and RLE true-color (types 2/10) and
// grayscale (types 3/11); returns top-down RGBA like pngjs.
function decodeTGA (buf) {
  if (buf.length < 18) throw new Error('tga: truncated header')
  const idLength = buf[0]
  const colorMapType = buf[1]
  const imageType = buf[2]
  const width = buf.readUInt16LE(12)
  const height = buf.readUInt16LE(14)
  const bpp = buf[16]
  const descriptor = buf[17]
  if (colorMapType !== 0) throw new Error('tga: color-mapped images unsupported')

  const rle = imageType === 10 || imageType === 11
  const grayscale = imageType === 3 || imageType === 11
  const trueColor = imageType === 2 || imageType === 10
  if (!rle && !grayscale && !trueColor) throw new Error('tga: unsupported type ' + imageType)

  const bytesPerPixel = grayscale ? 1 : bpp / 8
  let p = 18 + idLength
  const out = Buffer.alloc(width * height * 4)

  const writePixel = (index, data, off) => {
    out[index * 4 + 3] = 255
    if (grayscale) {
      out[index * 4] = out[index * 4 + 1] = out[index * 4 + 2] = data[off]
    } else {
      // TGA stores BGRA
      out[index * 4] = data[off + 2]
      out[index * 4 + 1] = data[off + 1]
      out[index * 4 + 2] = data[off]
      // Bedrock entity textures use alpha as a cutout mask; 32bpp .tga files
      // can carry tiny non-zero values on fully visible texels (sheep's face
      // stores 3), so anything non-zero becomes opaque.
      if (bytesPerPixel === 4) out[index * 4 + 3] = data[off + 3] > 0 ? 255 : 0
    }
  }

  const count = width * height
  let index = 0
  while (index < count) {
    let runLength = 1
    if (rle) {
      const packet = buf[p++]
      runLength = (packet & 0x7f) + 1
      if (packet & 0x80) {
        const pixel = buf.subarray(p, p + bytesPerPixel)
        p += bytesPerPixel
        for (let i = 0; i < runLength; i++) writePixel(index++, pixel, 0)
        continue
      }
    }
    for (let i = 0; i < runLength; i++) {
      writePixel(index++, buf, p)
      p += bytesPerPixel
    }
  }

  // descriptor bit 5: 1 = top-left origin, 0 = bottom-left
  if (!(descriptor & 0x20)) {
    const flipped = Buffer.alloc(out.length)
    for (let y = 0; y < height; y++) {
      out.copy(flipped, y * width * 4, (height - 1 - y) * width * 4, (height - y) * width * 4)
    }
    return { width, height, data: flipped }
  }
  return { width, height, data: out }
}

module.exports = { decodeTGA }
