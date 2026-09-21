// Time-of-day and block-light helpers for the software renderer.
//
// Light levels are read straight from prismarine-world's WorldSync
// (getSkyLight / getBlockLight), i.e. what the server actually sends. Sky light
// is scaled by the time of day, so the open world darkens at night while
// torch-lit spots keep their brightness. This is a cheap approximation: no
// sun disc, no soft shadows, no coloured light.

const DAY = 24000

// Piecewise-linear control points (tick -> brightness factor). Wraps cleanly:
// t=0 and t=24000 share a value. Noon (6000) is full brightness, midnight
// (18000) is dim moonlight.
const DAY_FACTOR = [
  [0, 0.30], [1500, 1.0], [10500, 1.0], [13500, 0.30],
  [18000, 0.22], [22500, 0.30], [24000, 0.30]
]

const SKY_DAY = [0x78, 0xa7, 0xff]
const SKY_NIGHT = [0x0a, 0x0a, 0x28]
const SKY_DUSK = [0xd8, 0x8a, 0x4a]

// Brightness floor so nothing is pure black (keeps dark scenes readable).
const AMBIENT = 0.08

function lerp (a, b, t) { return a + (b - a) * t }

function normalize (t) {
  t = Number(t) % DAY
  if (t < 0) t += DAY
  return t
}

function piecewise (points, t) {
  for (let i = 0; i < points.length - 1; i++) {
    const [t0, v0] = points[i]
    const [t1, v1] = points[i + 1]
    if (t >= t0 && t <= t1) return lerp(v0, v1, (t1 - t0) === 0 ? 0 : (t - t0) / (t1 - t0))
  }
  return points[points.length - 1][1]
}

// Sky-light scale for a time of day (0.22 night .. 1.0 noon).
function dayFactor (timeOfDay) {
  return piecewise(DAY_FACTOR, normalize(timeOfDay))
}

// Triangular bump peaking at `center`, zero beyond halfWidth, wrapping at 24000.
function bump (t, center, halfWidth) {
  let d = Math.abs(normalize(t) - center)
  if (d > DAY / 2) d = DAY - d
  return Math.max(0, 1 - d / halfWidth)
}

function skyColor (timeOfDay) {
  const t = normalize(timeOfDay)
  const d = dayFactor(t)
  const dn = (d - 0.22) / (1 - 0.22)
  let r = lerp(SKY_NIGHT[0], SKY_DAY[0], dn)
  let g = lerp(SKY_NIGHT[1], SKY_DAY[1], dn)
  let b = lerp(SKY_NIGHT[2], SKY_DAY[2], dn)
  // warm tint around sunrise/sunset
  const dusk = Math.max(bump(t, 12000, 2200), bump(t, 0, 2200), bump(t, 24000, 2200))
  if (dusk > 0) {
    r = lerp(r, SKY_DUSK[0], dusk)
    g = lerp(g, SKY_DUSK[1], dusk)
    b = lerp(b, SKY_DUSK[2], dusk)
  }
  return [r | 0, g | 0, b | 0]
}

// Combined light level 0..15: block light wins, sky light is scaled by daylight.
function combineLight (sky, block, factor) {
  return Math.max(block, Math.min(15, sky * factor))
}

// Light level -> display brightness (0..1), with an ambient floor.
function brightness (level) {
  const l = Math.max(0, Math.min(15, level)) / 15
  return AMBIENT + (1 - AMBIENT) * Math.pow(l, 1.5)
}

// Resolve the time of day: explicit opts.timeOfDay, then env TIME_OF_DAY, then
// the live server clock.
function resolveTime (bot, opts = {}) {
  let t
  if (opts.timeOfDay !== undefined && opts.timeOfDay !== null) t = Number(opts.timeOfDay)
  else if (process.env.TIME_OF_DAY !== undefined && process.env.TIME_OF_DAY !== '') t = Number(process.env.TIME_OF_DAY)
  else if (bot && bot.time && bot.time.timeOfDay !== null && bot.time.timeOfDay !== undefined) t = Number(bot.time.timeOfDay)
  else t = 6000
  return normalize(t)
}

// Packs block coords into one exact double (x,z within +-2^19, y within
// -64..320), avoiding string keys in the per-vertex hot loop.
function blockKey (x, y, z) {
  return ((x + 0x80000) * 0x100000 + (z + 0x80000)) * 0x1000 + (y + 0x40)
}

// Raw packed light (sky<<4 | block) at a world block, with the server's sky
// light corrected against the heightmap: sky 0 above the column's highest solid
// block means open sky, not darkness. Unloaded columns fall back to open sky so
// world edges don't turn black. Pass a Map to reuse across calls (cleared here).
function makeRawSampler (world, heightmap, cache) {
  const c = cache || new Map()
  c.clear()
  return function sample (x, y, z) {
    const key = blockKey(x, y, z)
    let v = c.get(key)
    if (v !== undefined) return v
    const pos = { x, y, z }
    let sky = 15
    let block = 0
    if (world && world.getColumnAt && world.getColumnAt(pos)) {
      sky = world.getSkyLight(pos)
      block = world.getBlockLight(pos)
      if (sky === 0 && heightmap && y > heightmap.top(x, z)) sky = 15
    }
    v = (sky << 4) | block
    c.set(key, v)
    return v
  }
}

// Per-quad packed light, computed once when a section is meshed and stored on
// the mesh, so per-frame shading is just a table lookup.
function computeLightData (mesh, sample) {
  const { positions, normals } = mesh
  const ox = mesh.sx
  const oy = mesh.sy
  const oz = mesh.sz
  const verts = positions.length / 3
  const quads = Math.ceil(verts / 4)
  const data = new Uint8Array(quads)
  // Step off the face into the neighbouring air block: light inside a solid
  // block is 0 and would otherwise render everything black.
  const sampleVertex = (i) => {
    const wx = positions[i * 3] + ox + normals[i * 3] * 0.5
    const wy = positions[i * 3 + 1] + oy + normals[i * 3 + 1] * 0.5
    const wz = positions[i * 3 + 2] + oz + normals[i * 3 + 2] * 0.5
    return sample(Math.floor(wx), Math.floor(wy), Math.floor(wz))
  }
  let qi = 0
  let i = 0
  for (; i + 4 <= verts; i += 4) data[qi++] = sampleVertex(i)
  for (; i < verts; i++) data[qi++] = sampleVertex(i)
  return data
}

// brightness() sampled at 1/64 light steps, indexed by round(level*64).
const BRIGHT_LUT = (() => {
  const max = 15 * 64
  const lut = new Float32Array(max + 1)
  for (let i = 0; i <= max; i++) lut[i] = brightness(i / 64)
  return lut
})()

// Fills scratch.buf with the mesh's base vertex colours scaled by light and
// returns a view of it. Cached meshes keep their unlit colours, so light is
// never mutated into them — it is recomputed into scratch each frame instead.
function bakeLight (mesh, factor, scratch) {
  const base = mesh.colors
  const n = base.length
  if (!scratch.buf || scratch.buf.length < n) scratch.buf = new Float32Array(n)
  const out = scratch.buf
  const data = mesh.lightData
  const verts = n / 3
  const shade = (packed) => {
    const sky = (packed >> 4) & 15
    const block = packed & 15
    let level = sky * factor
    if (block > level) level = block
    let idx = (level * 64 + 0.5) | 0
    if (idx < 0) idx = 0
    else if (idx > 960) idx = 960
    return BRIGHT_LUT[idx]
  }
  let qi = 0
  let i = 0
  for (; i + 4 <= verts; i += 4) {
    const b = shade(data[qi++])
    for (let k = 0; k < 4; k++) {
      const j = i + k
      out[j * 3] = base[j * 3] * b
      out[j * 3 + 1] = base[j * 3 + 1] * b
      out[j * 3 + 2] = base[j * 3 + 2] * b
    }
  }
  for (; i < verts; i++) {
    const b = shade(data[qi++])
    out[i * 3] = base[i * 3] * b
    out[i * 3 + 1] = base[i * 3 + 1] * b
    out[i * 3 + 2] = base[i * 3 + 2] * b
  }
  return out.subarray(0, n)
}

// Brightness at an entity's body, sampled from the world.
function entityBrightness (world, entity, factor, heightmap) {
  const p = entity.position
  const h = (entity.height || 1.8) * 0.75
  const x = Math.floor(p.x)
  const y = Math.floor(p.y + h)
  const z = Math.floor(p.z)
  const pos = { x, y, z }
  let sky = 15
  let block = 0
  if (world && world.getColumnAt && world.getColumnAt(pos)) {
    sky = world.getSkyLight(pos)
    block = world.getBlockLight(pos)
    if (sky === 0 && heightmap && y > heightmap.top(x, z)) sky = 15
  }
  return brightness(combineLight(sky, block, factor))
}

module.exports = {
  DAY,
  dayFactor,
  skyColor,
  combineLight,
  brightness,
  resolveTime,
  makeRawSampler,
  computeLightData,
  bakeLight,
  entityBrightness
}
