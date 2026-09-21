// On-demand POV renderer for a live, moving bot.
//
// Wraps MeshCache so repeated captures only mesh the sections that aren't
// cached yet; the cache is invalidated on block changes and chunk unloads, and
// evicted by distance. Section geometry is in world space, so moving the camera
// costs nothing.
//
//   const pov = new PovRenderer({ viewDistance: 6 })
//   pov.attach(bot)                          // hooks events + prewarms
//   bot.on('physicsTick', () => pov.tick())  // optional: smooth the spikes
//   const png = pov.capture({ width: 640, height: 360, yaw, pitch })
//   pov.detach()
const { MeshCache } = require('./worldRender')
const { renderFrame, frameToPng, frameToJpeg, getAssets } = require('./capture')

class PovRenderer {
  constructor (opts = {}) {
    this.opts = opts
    this.viewDistance = opts.viewDistance !== undefined ? opts.viewDistance : 6
    this.cache = new MeshCache({ margin: opts.evictMargin })
    this.bot = null
    this._onBlock = null
    this._onUnload = null
  }

  // Hooks block-change / chunk-unload events so the cache stays valid.
  attach (bot, { prewarm = true } = {}) {
    this.detach()
    this.bot = bot
    this._onBlock = (oldBlock, newBlock) => {
      const p = (newBlock && newBlock.position) || (oldBlock && oldBlock.position)
      if (p) this.cache.invalidateBlock(p)
    }
    this._onUnload = (corner) => {
      this.cache.invalidateColumn(Math.floor(corner.x / 16), Math.floor(corner.z / 16))
    }
    bot.on('blockUpdate', this._onBlock)
    if (bot.world && bot.world.on) bot.world.on('chunkColumnUnload', this._onUnload)
    if (prewarm) this.prewarm()
    return this
  }

  detach () {
    if (!this.bot) return
    this.bot.off('blockUpdate', this._onBlock)
    if (this.bot.world && this.bot.world.off) this.bot.world.off('chunkColumnUnload', this._onUnload)
    this.bot = null
  }

  // Meshes the whole current view box (one-off; first capture after a teleport
  // is the other expensive moment). Returns the raw frame.
  prewarm (opts = {}) {
    return this.render(opts)
  }

  // Incremental warming: meshes missing sections up to budgetMs and returns how
  // many sections were newly meshed. Call from a bot tick so captures stay
  // spike-free.
  tick (budgetMs = 4) {
    if (!this.bot) return 0
    const assets = getAssets(this.bot.version, this.opts.assetsVersion || this.bot.version)
    this.cache.collect(this.bot, assets, this.viewDistance, budgetMs)
    return this.cache.lastMeshed
  }

  // Raw RGBA frame (no encoding).
  render (opts = {}) {
    return renderFrame(this.bot, {
      ...this.opts,
      ...opts,
      viewDistance: opts.viewDistance || this.viewDistance,
      meshCache: this.cache
    })
  }

  // Encoded frame (PNG by default), ready to write/send.
  capture (opts = {}) {
    const frame = this.render(opts)
    const format = opts.format || this.opts.format || 'png'
    return format === 'jpeg' ? frameToJpeg(frame, opts.quality) : frameToPng(frame)
  }

  sectionCount () { return this.cache.entries().size }

  clear () { this.cache.clear() }
}

module.exports = { PovRenderer, MeshCache }
