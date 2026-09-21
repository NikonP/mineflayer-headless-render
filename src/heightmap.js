// Per-column topmost solid block. Used to correct the server's sky light: some
// servers report sky light 0 for blocks that are plainly under open sky, and
// knowing the highest solid block in a column tells a real roof from a bad
// value. Computed lazily per column, cached, invalidated on block changes and
// chunk unloads.
const mcData = require('minecraft-data')

const heightmaps = new WeakMap()

// One heightmap per bot, with its own invalidation listeners.
function getHeightmap (bot) {
  let h = heightmaps.get(bot)
  if (!h) {
    h = new Heightmap(bot)
    heightmaps.set(bot, h)
  }
  return h
}

// stateId -> 1 if the block is solid (has a collision box), else 0.
function solidTable (version) {
  const data = mcData(version)
  const blocks = data.blocksArray
  let max = 0
  for (const b of blocks) if (b.maxStateId > max) max = b.maxStateId
  const solid = new Uint8Array(max + 1)
  for (const b of blocks) {
    // Leaves only partially block light in vanilla, so they don't count as a
    // roof here — otherwise the ground under every tree goes pitch black.
    const v = (b.boundingBox && b.boundingBox !== 'empty' && !/leaves/.test(b.name)) ? 1 : 0
    for (let s = b.minStateId; s <= b.maxStateId; s++) solid[s] = v
  }
  return solid
}

// Exact key for (x, z) within +-2^19.
function colKey (x, z) {
  return (x + 0x80000) * 0x100000 + (z + 0x80000)
}

class Heightmap {
  constructor (bot) {
    this.bot = bot
    this.solid = solidTable(bot.version)
    this.cache = new Map() // key -> { y, cx, cz }
    const g = bot.game || {}
    this.minY = g.minY !== undefined ? g.minY : -64
    const height = g.height !== undefined ? g.height : 384
    this.worldTop = this.minY + height - 1

    this._onBlock = (oldBlock, newBlock) => {
      const p = (newBlock && newBlock.position) || (oldBlock && oldBlock.position)
      if (p) this.cache.delete(colKey(Math.floor(p.x), Math.floor(p.z)))
    }
    this._onUnload = (corner) => this.invalidateChunk(Math.floor(corner.x / 16), Math.floor(corner.z / 16))
    bot.on('blockUpdate', this._onBlock)
    if (bot.world && bot.world.on) bot.world.on('chunkColumnUnload', this._onUnload)
  }

  invalidateChunk (chunkX, chunkZ) {
    for (const [key, entry] of this.cache) {
      if (entry.cx === chunkX && entry.cz === chunkZ) this.cache.delete(key)
    }
  }

  // Highest y with a solid block in the column, or minY - 1 if none.
  top (x, z) {
    const key = colKey(x, z)
    const hit = this.cache.get(key)
    if (hit !== undefined) return hit.y
    const world = this.bot.world
    const pos = { x, y: 0, z }
    let y = this.minY - 1
    for (let ty = this.worldTop; ty >= this.minY; ty--) {
      pos.y = ty
      if (this.solid[world.getBlockStateId(pos)]) { y = ty; break }
    }
    this.cache.set(key, { y, cx: Math.floor(x / 16), cz: Math.floor(z / 16) })
    return y
  }
}

module.exports = { getHeightmap, Heightmap }
