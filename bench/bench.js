// Performance benchmark: render time per frame against a live server, broken
// down by stage, plus PNG encode time, memory and CPU.
//
//   MC_HOST=my.server MC_PORT=25565 node --expose-gc bench/bench.js \
//     --cache --frames 30 --warmup 5 --configs "640x360@6,1280x720@6"
//
// Flags: --cache (reuse section meshes), --scene (summon mobs/items/a wall so
// entity cost shows up), --configs "WxH@view,WxH@view", --frames, --warmup.
const { renderFrame, frameToPng } = require('..')
const { MeshCache } = require('../src/worldRender')
const { wait, parseArgs, int, createBot } = require('../scripts/dev-bot')

function parseConfigs(raw) {
  return raw.split(',').map(s => {
    const [res, view] = s.trim().split('@')
    const [w, h] = res.split('x').map(Number)
    return { w, h, view: parseInt(view, 10) }
  })
}

function stats(arr) {
  const s = [...arr].sort((x, y) => x - y)
  const sum = s.reduce((acc, v) => acc + v, 0)
  const at = p =>
    s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]
  return {
    mean: sum / s.length,
    med: at(0.5),
    p95: at(0.95),
    min: s[0],
    max: s[s.length - 1]
  }
}

const f1 = n => n.toFixed(1)
const mb = n => (n / 1024 / 1024).toFixed(1) + 'MB'
const gcNow = () => {
  if (global.gc) global.gc()
}

async function buildScene(bot) {
  const p = bot.entity.position.floored()
  const cmd = async c => {
    bot.chat(c)
    await wait(120)
  }
  bot.chat('/gamerule doMobSpawning false')
  await wait(300)
  bot.chat('/kill @e[type=!minecraft:player]')
  await wait(500)
  const mobs = [
    'zombie',
    'cow',
    'sheep',
    'pig',
    'chicken',
    'creeper',
    'skeleton',
    'spider'
  ]
  for (let i = 0; i < mobs.length; i++) {
    await cmd(
      `/summon minecraft:${mobs[i]} ${p.x - 4 + i * 1.2} ${p.y} ${p.z + 4.5} {NoAI:1}`
    )
  }
  const items = ['diamond', 'apple', 'stick', 'redstone', 'coal', 'egg']
  for (let i = 0; i < items.length; i++) {
    await cmd(
      `/summon minecraft:item ${p.x - 4 + i * 1.2} ${p.y + 0.1} ${p.z + 7.5} {Item:{id:"minecraft:${items[i]}",count:1}}`
    )
  }
  await cmd(
    `/fill ${p.x - 6} ${p.y} ${p.z + 9} ${p.x + 6} ${p.y + 3} ${p.z + 9} minecraft:stone_bricks`
  )
  await cmd(`/tp ${bot.username} ${p.x} ${p.y + 1.6} ${p.z}`)
  await wait(1000)
}

async function main() {
  const args = parseArgs()
  const frames = int(args, 'frames', 'FRAMES', 40)
  const warmup = int(args, 'warmup', 'WARMUP', 5)
  const scene = !!args.scene
  const useCache = !!args.cache
  const configs = parseConfigs(
    args.configs || process.env.CONFIGS || '640x360@6,1280x720@6,1280x720@12'
  )
  const bot = createBot(args)
  const timer = setTimeout(() => {
    console.error('timed out')
    process.exit(1)
  }, 300000)

  bot.on('error', err => {
    if (err.code === 'EPIPE') return
    clearTimeout(timer)
    console.error('bot error:', err.message)
    process.exit(1)
  })

  bot.once('spawn', async () => {
    await wait(int(args, 'settle', 'SETTLE', 3000))
    const p = bot.entity.position.floored()
    console.log(
      `spawn at ${p} | frames=${frames} warmup=${warmup} scene=${scene} cache=${useCache}`
    )
    if (scene) await buildScene(bot)

    const meshCache = useCache ? new MeshCache() : null

    // Warm the assets once (atlas build is one-off and slow) before measuring.
    renderFrame(bot, {
      width: 320,
      height: 180,
      viewDistance: 2,
      timeOfDay: 6000,
      meshCache
    })
    gcNow()
    const rssStart = process.memoryUsage().rss

    console.log('')
    console.log(
      'config              total(ms)          fps | world light terr ent | encode | rss     | cpu/frame'
    )
    console.log('-'.repeat(112))

    for (const c of configs) {
      for (let i = 0; i < warmup; i++) {
        renderFrame(bot, {
          width: c.w,
          height: c.h,
          viewDistance: c.view,
          timeOfDay: 6000,
          meshCache
        })
      }
      gcNow()

      const total = []
      const world = []
      const light = []
      const terrain = []
      const entities = []
      const encode = []
      const cpu = []
      let meshes = 0
      let tris = 0

      for (let i = 0; i < frames; i++) {
        const timing = {}
        const c0 = process.cpuUsage()
        const t0 = performance.now()
        const frame = renderFrame(bot, {
          width: c.w,
          height: c.h,
          viewDistance: c.view,
          timeOfDay: 6000,
          timing,
          meshCache
        })
        const t1 = performance.now()
        frameToPng(frame)
        const t2 = performance.now()
        const dc = process.cpuUsage(c0)

        total.push(t2 - t0)
        world.push(timing.world)
        light.push(timing.light)
        terrain.push(timing.terrain)
        entities.push(timing.entities)
        encode.push(t2 - t1)
        cpu.push((dc.user + dc.system) / 1000)
        meshes = timing.meshes
        tris = timing.tris
      }

      const tot = stats(total)
      const cpuMs = stats(cpu).mean
      gcNow()
      const rss = process.memoryUsage().rss
      const heap = process.memoryUsage().heapUsed
      const cpuPct = Math.min(999, (cpuMs / tot.mean) * 100)
      const label = `${c.w}x${c.h} view${c.view}`.padEnd(18)
      console.log(
        `${label} ${f1(tot.mean).padStart(8)} (p95 ${f1(tot.p95).padStart(5)}) ${f1(1000 / tot.mean).padStart(5)} | ` +
          `${f1(stats(world).mean).padStart(5)} ${f1(stats(light).mean).padStart(5)} ${f1(stats(terrain).mean).padStart(4)} ${f1(stats(entities).mean).padStart(3)} | ` +
          `${f1(stats(encode).mean).padStart(6)} | ${mb(rss).padStart(7)} | ${f1(cpuMs).padStart(6)}ms ${f1(cpuPct).padStart(4)}%`
      )
      console.log(
        `${''.padEnd(18)} min ${f1(tot.min)} med ${f1(tot.med)} max ${f1(tot.max)} | ` +
          `meshes ${meshes} tris ${tris} | cache ${meshCache ? meshCache.entries().size : '-'} | heap ${mb(heap)} | rss delta ${mb(rss - rssStart)}`
      )
    }

    console.log('')
    console.log(
      'notes: world = meshing (cached or redone every frame), light = per-face light bake,'
    )
    console.log(
      '       terr = terrain raster, ent = entities, encode = PNG encode. cpu% is of one core.'
    )

    if (scene) {
      bot.chat('/kill @e[type=!minecraft:player]')
      await wait(400)
    }
    clearTimeout(timer)
    bot.quit()
    setTimeout(() => process.exit(0), 400)
  })
}

main()
