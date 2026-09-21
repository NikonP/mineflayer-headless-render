const { PNG } = require('pngjs')
const {
  prepareBlocksStates
} = require('../vendor/prismarine-viewer/modelsBuilder')
const mcAssets = require('minecraft-assets')
const fs = require('fs')
const path = require('path')

// The upstream atlas builder needs node-canvas; we install a minimal shim so
// it works without a native dependency. It draws tiles into a raw RGBA buffer.
class Ctx2DShim {
  constructor(width, height) {
    this.width = width
    this.height = height
    this.data = new Uint8ClampedArray(width * height * 4)
  }

  drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) {
    const src = img.__rgba || img.data
    const iw = img.__width || img.width
    const ih = img.__height || img.height
    for (let y = 0; y < dh; y++) {
      for (let x = 0; x < dw; x++) {
        const px = sx + x
        const py = sy + y
        if (px < 0 || py < 0 || px >= iw || py >= ih) continue
        const si = (py * iw + px) * 4
        const di = ((dy + y) * this.width + (dx + x)) * 4
        this.data[di] = src[si]
        this.data[di + 1] = src[si + 1]
        this.data[di + 2] = src[si + 2]
        this.data[di + 3] = src[si + 3]
      }
    }
  }

  toBuffer() {
    const png = new PNG({ width: this.width, height: this.height })
    png.data = this.data
    return PNG.sync.write(png)
  }
}

// Atlas tiles come from a vertical animation strip: frame 0 lives at
// texture.u/v, frame N at texture.v + N * tileHeight. Tile packing matches
// upstream atlas.js (columns, tallest strip first) so UVs line up with
// getSectionGeometry output.
function loadAtlasAndViewerAssets(version, assetsVersion) {
  const assets = mcAssets(assetsVersion)
  const atlas = buildAtlas(assets)
  const blocksStates = prepareBlocksStates(assets, atlas)
  return {
    atlasImage: atlas.image,
    atlasJson: atlas.json,
    blocksStates,
    assets
  }
}

// Re-implementation of makeTextureAtlas without node-canvas: same tile
// packing (columns, tallest first) and same texturesIndex format.
function buildAtlas(assets) {
  const blocksTexturePath = assets.directory + '/blocks'
  const textureFiles = fs
    .readdirSync(blocksTexturePath)
    .filter(f => f.endsWith('.png'))
  textureFiles.unshift('missing_texture.png')

  const tileSize = 16

  const textures = textureFiles.map(file => {
    let png
    if (file === 'missing_texture.png') {
      png = PNG.sync.read(
        fs.readFileSync(path.join(__dirname, 'assets', 'missing_texture.png'))
      )
    } else {
      png = PNG.sync.read(fs.readFileSync(blocksTexturePath + '/' + file))
    }
    const name = file.split('.')[0]
    const mcmetaPath = blocksTexturePath + '/' + file + '.mcmeta'
    let animation = null
    if (png.height > png.width && fs.existsSync(mcmetaPath)) {
      const { animation: anim } = JSON.parse(
        fs.readFileSync(mcmetaPath, 'utf8')
      )
      if (anim) {
        const frametime = anim.frametime || 1
        const frameCount = Math.floor(png.height / png.width)
        const frames = anim.frames || [...Array(frameCount).keys()]
        animation = {
          frametime,
          frameHeight: png.width,
          frames: frames.flatMap(f =>
            typeof f === 'number'
              ? [f]
              : Array(Math.max(1, Math.round(f.time / frametime))).fill(f.index)
          )
        }
      }
    }
    return {
      name,
      png,
      animation,
      frames: animation ? animation.frames : [0],
      frameHeight: animation ? animation.frameHeight : tileSize
    }
  })

  function nextPowerOfTwo(n) {
    if (n === 0) return 1
    n--
    n |= n >> 1
    n |= n >> 2
    n |= n >> 4
    n |= n >> 8
    n |= n >> 16
    return n + 1
  }

  const tileCount = textures.reduce((n, t) => n + t.frames.length, 0)
  const texSize = nextPowerOfTwo(Math.ceil(Math.sqrt(tileCount)))
  const columns = new Array(texSize).fill(0)
  textures.sort((a, b) => b.frames.length - a.frames.length)
  for (const tex of textures) {
    const col = columns.indexOf(Math.min(...columns))
    tex.x = col * tileSize
    tex.y = columns[col] * tileSize
    columns[col] += tex.frames.length
  }

  const imgWidth = texSize * tileSize
  const imgHeight = nextPowerOfTwo(Math.max(...columns) * tileSize)
  const ctx = new Ctx2DShim(imgWidth, imgHeight)

  const texturesIndex = {}
  for (const tex of textures) {
    texturesIndex[tex.name] = {
      u: tex.x / imgWidth,
      v: tex.y / imgHeight,
      su: tileSize / imgWidth,
      sv: tileSize / imgHeight
    }
    if (tex.animation) {
      texturesIndex[tex.name].frames = tex.frames.length
      texturesIndex[tex.name].frametime = tex.animation.frametime
    }
    tex.frames.forEach((frame, i) => {
      ctx.drawImage(
        tex.png,
        0,
        frame * tex.frameHeight,
        tileSize,
        tileSize,
        tex.x,
        tex.y + i * tileSize,
        tileSize,
        tileSize
      )
    })
  }

  return {
    image: ctx,
    json: {
      tileSize,
      width: imgWidth,
      height: imgHeight,
      textures: texturesIndex
    }
  }
}

module.exports = { loadAtlasAndViewerAssets, buildAtlas }
