// Regression: server non-air counts and local edits disagree for cave_air.
// Exercise real prismarine chunks at negative coordinates, including cached
// empty sections becoming visible after invalidation. No server needed.
const assert = require('assert/strict')
const { EventEmitter } = require('events')
const { Vec3 } = require('vec3')
const { getAssets } = require('../src/capture')
const { MeshCache } = require('../src/worldRender')
const { getDefaultVersion } = require('../src/config')

const version = getDefaultVersion()
const World = require('prismarine-world')(version)
const Chunk = require('prismarine-chunk')(version)
const mc = require('minecraft-data')(version)
const world = new World().sync
const bot = Object.assign(new EventEmitter(), {
  version,
  world,
  entity: { position: new Vec3(-8, -8, -8) }
})
for (let x = -2; x <= 0; x++) {
  for (let z = -2; z <= 0; z++) world.setColumn(x, z, new Chunk())
}
const column = world.getColumn(-1, -1)
const section = column.sections[(-16 - column.minY) / 16]
const assets = getAssets(version, version)
const pos = new Vec3(-8, -8, -8)
const local = new Vec3(8, -8, 8)

for (const name of ['air', 'cave_air', 'void_air']) {
  const air = mc.blocksByName[name].defaultState
  for (let y = -16; y < 0; y++) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        column.setBlockStateId(new Vec3(x, y, z), air)
      }
    }
  }
  // This is the wire count Paper sends for a section containing only air,
  // including the nonzero cave_air/void_air state IDs.
  section.solidBlockCount = 0
  const cache = new MeshCache()
  assert.equal(cache.collect(bot, assets, 1).length, 0)
  assert.equal(cache.entries().get('-1,-16,-1').mesh, null)

  column.setBlockStateId(local, mc.blocksByName.stone.defaultState)
  cache.invalidateBlock(pos)
  const meshes = cache.collect(bot, assets, 1)
  assert.equal(meshes.length, 1, `${name}: stone must not be skipped`)
  assert.equal(meshes[0].indices.length / 3, 12)
  assert.deepEqual(meshes[0].aabb, [-8, -8, -8, -7, -7, -7])

  column.setBlockStateId(local, air)
  cache.invalidateBlock(pos)
  assert.equal(cache.collect(bot, assets, 1).length, 0)
}
console.log('empty section edits (air/cave_air/void_air): OK')
