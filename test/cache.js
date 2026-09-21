// Cache correctness test: renders the same scene with and without MeshCache and
// pixel-diffs the results. Also checks that repeated cached frames don't darken
// (light must not be baked into the cache) and that block edits invalidate.
//
// Needs a creative server with commands enabled.
//   MC_HOST=my.server MC_PORT=25565 node test/cache.js
// Writes PNGs to test/out/ and prints diffs (cached vs uncached should be max=0).
const fs = require('fs')
const path = require('path')
const { PNG } = require('pngjs')
const { captureFrame } = require('..')
const { PovRenderer } = require('..')
const { wait, parseArgs, int, createBot } = require('../scripts/dev-bot')

const outDir = path.join(__dirname, 'out')

function diff(bufA, bufB) {
  const a = PNG.sync.read(bufA)
  const b = PNG.sync.read(bufB)
  if (a.width !== b.width || a.height !== b.height) {
    return { note: 'size mismatch' }
  }
  let max = 0
  let sum = 0
  let n = 0
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.data[i + c] - b.data[i + c])
      if (d > max) max = d
      sum += d
      n++
    }
  }
  return { max, mean: sum / n }
}

async function main() {
  const args = parseArgs()
  const bot = createBot(args)
  const timer = setTimeout(() => {
    console.error('timed out')
    process.exit(1)
  }, 180000)
  bot.on('error', err => {
    if (err.code === 'EPIPE') return
    clearTimeout(timer)
    console.error('bot error:', err.message)
    process.exit(1)
  })

  bot.once('spawn', async () => {
    await wait(int(args, 'settle', 'SETTLE', 2500))
    const p = bot.entity.position.floored()
    const x0 = p.x
    const by = p.y
    const z0 = p.z
    const cmd = async c => {
      bot.chat(c)
      await wait(110)
    }

    bot.chat('/gamerule doMobSpawning false')
    await wait(300)
    bot.chat('/kill @e[type=!minecraft:player]')
    await wait(500)

    const floor = [
      'grass_block',
      'stone',
      'cobblestone',
      'oak_planks',
      'sandstone',
      'bricks',
      'red_wool',
      'blue_wool'
    ]
    for (let i = 0; i < floor.length; i++) {
      await cmd(
        `/fill ${x0 + i} ${by - 1} ${z0 + 1} ${x0 + i} ${by - 1} ${z0 + 6} minecraft:${floor[i]}`
      )
    }
    const wall = [
      'oak_log',
      'birch_log',
      'prismarine',
      'nether_bricks',
      'quartz_block',
      'purpur_block',
      'blackstone',
      'iron_block'
    ]
    for (let i = 0; i < wall.length; i++) {
      await cmd(
        `/fill ${x0 + i} ${by} ${z0 + 8} ${x0 + i} ${by + 2} ${z0 + 8} minecraft:${wall[i]}`
      )
    }
    const mobs = ['zombie', 'cow', 'sheep', 'pig', 'chicken', 'creeper']
    for (let i = 0; i < mobs.length; i++) {
      await cmd(
        `/summon minecraft:${mobs[i]} ${x0 + i * 1.4 + 0.3} ${by} ${z0 + 4.5} {NoAI:1}`
      )
    }
    const items = ['diamond', 'apple', 'stick', 'redstone']
    for (let i = 0; i < items.length; i++) {
      await cmd(
        `/summon minecraft:item ${x0 + i * 1.4 + 0.3} ${by + 0.1} ${z0 + 6.5} {Item:{id:"minecraft:${items[i]}",count:1}}`
      )
    }
    await wait(800)

    const camera = {
      width: 1280,
      height: 720,
      yaw: Math.PI,
      pitch: (-6 * Math.PI) / 180,
      viewDistance: 6
    }
    await cmd(`/tp ${bot.username} ${x0 + 4} ${by + 1.6} ${z0 - 4}`)
    await wait(900)

    fs.mkdirSync(outDir, { recursive: true })
    const save = (name, buf) => {
      fs.writeFileSync(path.join(outDir, name + '.png'), buf)
      return buf
    }

    // 1) uncached vs cached on the same static scene
    const offDay = save(
      'cache_off_day',
      await captureFrame(bot, { ...camera, timeOfDay: 6000 })
    )
    const pov = new PovRenderer({ viewDistance: 6 })
    pov.attach(bot, { prewarm: true })
    const onDay = save(
      'cache_on_day',
      pov.capture({ ...camera, timeOfDay: 6000 })
    )
    const onDay2 = save(
      'cache_on_day2',
      pov.capture({ ...camera, timeOfDay: 6000 })
    )

    // 2) cached at a different time of day (light must still update)
    const offNight = save(
      'cache_off_night',
      await captureFrame(bot, { ...camera, timeOfDay: 18000 })
    )
    const onNight = save(
      'cache_on_night',
      pov.capture({ ...camera, timeOfDay: 18000 })
    )

    // 3) edit the world after attach: cache must invalidate
    await cmd(
      `/fill ${x0 + 9} ${by} ${z0 + 3} ${x0 + 9} ${by + 3} ${z0 + 5} minecraft:redstone_block`
    )
    await wait(600)
    const offEdit = save(
      'cache_off_edit',
      await captureFrame(bot, { ...camera, timeOfDay: 6000 })
    )
    const onEdit = save(
      'cache_on_edit',
      pov.capture({ ...camera, timeOfDay: 6000 })
    )

    const fmt = d => d.note || `max=${d.max} mean=${d.mean.toFixed(3)}`
    console.log('uncached vs cached (day)     :', fmt(diff(offDay, onDay)))
    console.log('cached vs cached (day, x2)   :', fmt(diff(onDay, onDay2)))
    console.log('uncached vs cached (night)   :', fmt(diff(offNight, onNight)))
    console.log('uncached vs cached (edit)    :', fmt(diff(offEdit, onEdit)))
    console.log(
      'day vs night (cached)        :',
      fmt(diff(onDay, onNight)),
      '(should be large)'
    )
    console.log(
      'before vs after edit (cached):',
      fmt(diff(onDay, onEdit)),
      '(should be > 0)'
    )

    pov.detach()
    bot.chat('/kill @e[type=!minecraft:player]')
    await wait(400)
    await cmd(
      `/fill ${x0 + 9} ${by} ${z0 + 3} ${x0 + 9} ${by + 3} ${z0 + 5} minecraft:air`
    )
    for (let i = 0; i < floor.length; i++) {
      await cmd(
        `/fill ${x0 + i} ${by - 1} ${z0 + 1} ${x0 + i} ${by - 1} ${z0 + 6} minecraft:grass_block`
      )
    }
    for (let i = 0; i < wall.length; i++) {
      await cmd(
        `/fill ${x0 + i} ${by} ${z0 + 8} ${x0 + i} ${by + 2} ${z0 + 8} minecraft:air`
      )
    }
    console.log('cleaned')

    clearTimeout(timer)
    bot.quit()
    setTimeout(() => process.exit(0), 400)
  })
}

main()
