// Collects section meshes around the bot by reusing prismarine-viewer's
// getSectionGeometry against the bot's live prismarine-world (WorldSync).
//
// renderWorld() rebuilds every section from scratch. MeshCache keeps section
// geometry between frames in world space: section meshes don't depend on the
// camera, so moving the point of view costs nothing and only sections entering
// or leaving the view box get (re)meshed.
const { Vec3 } = require('vec3')
const { getSectionGeometry } = require('../vendor/prismarine-viewer/models')
const mcData = require('minecraft-data')
const { makeRawSampler, computeLightData } = require('./light')
const { getHeightmap } = require('./heightmap')
const { getDefaultVersion } = require('./config')

// Adapts bot.world (WorldSync) to the shape getSectionGeometry expects.
// Caching is per-call (reset between sections) to bound memory: the meshing
// touches each block several times (self + 6 neighbors + 4x AO corners).
//
// The cache key is the block's offset from the current section origin packed
// into one integer, which avoids the template-literal string keys that showed
// up hot in profiling. getSectionGeometry occasionally queries NaN positions
// (and, rarely, offsets far outside the section), so anything outside the
// packed range falls back to a string key — the packed key must stay injective
// or the mesher silently reads the wrong block.
function makeViewWorld(botWorld, biomes) {
  let cache = null
  let ox = 0
  let oy = 0
  let oz = 0
  return {
    newSection(sx, sy, sz) {
      cache = new Map()
      ox = sx
      oy = sy
      oz = sz
    },
    getBlock(pos) {
      const fx = Math.floor(pos.x)
      const fy = Math.floor(pos.y)
      const fz = Math.floor(pos.z)
      const lx = fx - ox
      const ly = fy - oy
      const lz = fz - oz
      const inRange =
        lx >= -512 &&
        lx < 512 &&
        ly >= -512 &&
        ly < 512 &&
        lz >= -512 &&
        lz < 512
      const fkey = inRange
        ? ((lx + 512) * 1024 + (ly + 512)) * 1024 + (lz + 512)
        : 's,' + fx + ',' + fy + ',' + fz
      if (cache.has(fkey)) {
        const b = cache.get(fkey)
        b.position = new Vec3(fx, fy, fz)
        return b
      }
      const floored = new Vec3(fx, fy, fz)
      const b = botWorld.getBlock(floored)
      if (!b) return null
      // Mirror viewer World.getWorld: isCube is used for face culling
      const shapes = b.shapes
      b.isCube =
        !!shapes &&
        shapes.length === 1 &&
        shapes[0][0] === 0 &&
        shapes[0][1] === 0 &&
        shapes[0][2] === 0 &&
        shapes[0][3] === 1 &&
        shapes[0][4] === 1 &&
        shapes[0][5] === 1
      // biome object needed for tints
      if (!b.biome || b.biome.name === undefined) {
        const biomeId = botWorld.getBiome(floored)
        b.biome = biomes[biomeId] || biomes[1] || { name: 'plains' }
      }
      cache.set(fkey, b)
      b.position = floored
      return b
    }
  }
}

function collectSections(cache, bot, assets, viewDistanceChunks, budgetMs) {
  const meshes = []
  const biomes = mcData(bot.version || getDefaultVersion()).biomes
  const view = makeViewWorld(bot.world, biomes)
  // Raw light per quad is computed at mesh time and cached with the geometry;
  // the heightmap corrects the server's bogus sky-light zeros.
  const rawSample = makeRawSampler(bot.world, getHeightmap(bot))
  const pos = bot.entity.position.floored()
  const centerX = Math.floor(pos.x / 16) * 16
  const centerZ = Math.floor(pos.z / 16) * 16

  const lowestY = Math.floor(pos.y / 16) * 16 - 8 * 16
  const highestY = Math.floor(pos.y / 16) * 16 + 6 * 16

  let columnsFound = 0
  let meshed = 0
  let failed = 0
  const start = budgetMs === Infinity ? 0 : performance.now()

  for (const { chunkX, chunkZ, column } of bot.world.getColumns()) {
    const dx = chunkX * 16 - centerX
    const dz = chunkZ * 16 - centerZ
    if (
      Math.abs(dx) > viewDistanceChunks * 16 ||
      Math.abs(dz) > viewDistanceChunks * 16
    ) {
      continue
    }
    columnsFound++

    const colMinY = column.minY || 0
    const colMaxY = colMinY + (column.worldHeight || 256)
    const yStart = Math.max(lowestY, colMinY)
    const yEnd = Math.min(highestY, colMaxY)

    for (let sy = yStart; sy < yEnd; sy += 16) {
      const key = `${chunkX},${sy},${chunkZ}`
      const entry = cache.sections.get(key)
      if (entry !== undefined) {
        entry.lastSeen = cache.frame
        if (entry.mesh) meshes.push(entry.mesh)
        continue
      }
      if (budgetMs !== Infinity && performance.now() - start > budgetMs) {
        cache.lastMeshed = meshed
        return meshes
      }
      const section = column.sections[Math.floor((sy - colMinY) / 16)]
      if (!section || (section.isLoaded && section.isLoaded() === false)) {
        continue
      }
      view.newSection(chunkX * 16, sy, chunkZ * 16)
      let mesh = null
      try {
        const geom = getSectionGeometry(
          chunkX * 16,
          sy,
          chunkZ * 16,
          view,
          assets.blocksStates
        )
        if (geom.positions.length > 0) {
          geom.lightData = computeLightData(geom, rawSample)
          geom.normals = null // only needed for the light sampling above
          mesh = geom
        }
      } catch (e) {
        failed++
        if (process.env.DEBUG_MESH) {
          console.error('[mesh]', chunkX * 16, sy, chunkZ * 16, e.message)
        }
      }
      meshed++
      cache.sections.set(key, {
        mesh,
        cx: chunkX,
        cz: chunkZ,
        lastSeen: cache.frame
      })
      if (mesh) meshes.push(mesh)
    }
  }

  cache.lastMeshed = meshed
  if (process.env.DEBUG_MESH) {
    const tris = meshes.reduce((n, m) => n + m.indices.length / 3, 0)
    console.error(
      `[mesh] columns=${columnsFound} drawn=${meshes.length} new=${meshed} failed=${failed} tris=${tris} cached=${cache.sections.size}`
    )
  }
  return meshes
}

// Keeps section geometry between frames. Keyed by (chunkX, sectionY, chunkZ).
class MeshCache {
  constructor(opts = {}) {
    this.sections = new Map() // key -> { mesh|null, cx, cz, lastSeen }
    this.frame = 0
    this.lastMeshed = 0
    // Keep this many chunks beyond the view box before evicting, so walking
    // back and forth across a border doesn't re-mesh.
    this.margin = opts.margin !== undefined ? opts.margin : 2
  }

  // A block changed: its own section plus the 26 neighbours can change (face
  // culling and AO sample across section borders). Keys use the section origin
  // (chunk coords + y multiple of 16), matching what collect() stores.
  invalidateBlock(pos) {
    const cx = Math.floor(pos.x / 16)
    const sy = Math.floor(pos.y / 16) * 16
    const cz = Math.floor(pos.z / 16)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          this.sections.delete(`${cx + dx},${sy + dy * 16},${cz + dz}`)
        }
      }
    }
  }

  invalidateColumn(chunkX, chunkZ) {
    for (const [key, entry] of this.sections) {
      if (entry.cx === chunkX && entry.cz === chunkZ) this.sections.delete(key)
    }
  }

  clear() {
    this.sections.clear()
  }

  // Meshes missing sections of the view box and returns all non-empty ones.
  // budgetMs caps how much new meshing one call may do (for incremental
  // warming); capture should pass Infinity so nothing is missing.
  collect(bot, assets, viewDistanceChunks = 6, budgetMs = Infinity) {
    this.frame++
    const meshes = collectSections(
      this,
      bot,
      assets,
      viewDistanceChunks,
      budgetMs
    )
    const pos = bot.entity.position.floored()
    this._evict(
      Math.floor(pos.x / 16),
      Math.floor(pos.z / 16),
      viewDistanceChunks
    )
    return meshes
  }

  // Entries are keyed by section, so `entries()` is a helper for logging.
  entries() {
    return this.sections
  }

  _evict(centerChunkX, centerChunkZ, viewDistanceChunks) {
    const max = viewDistanceChunks + this.margin
    for (const [key, entry] of this.sections) {
      if (
        Math.abs(entry.cx - centerChunkX) > max ||
        Math.abs(entry.cz - centerChunkZ) > max
      ) {
        this.sections.delete(key)
      }
    }
  }
}

// Uncached convenience: fresh meshes for the current view box.
function renderWorld(bot, assets, viewDistanceChunks = 6) {
  return new MeshCache().collect(bot, assets, viewDistanceChunks)
}

module.exports = { renderWorld, MeshCache }
