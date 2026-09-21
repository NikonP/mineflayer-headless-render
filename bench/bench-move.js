// Movement benchmark: attach PovRenderer, then teleport the bot one chunk at a
// time and capture. Shows that only newly entering sections are meshed and that
// pre-warming with tick() removes the spike.
//
//   MC_HOST=my.server MC_PORT=25565 node bench/bench-move.js
// Needs a creative server with commands enabled (uses /tp).
const { PovRenderer, frameToPng } = require('..')
const { wait, parseArgs, int, createBot } = require('../scripts/dev-bot')

const f1 = n => n.toFixed(1)

async function main() {
  const args = parseArgs()
  const steps = int(args, 'steps', 'STEPS', 8)
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
    await wait(int(args, 'settle', 'SETTLE', 3000))
    const p = bot.entity.position.floored()
    console.log(`spawn at ${p}, ${steps} steps of 16 blocks`)

    const pov = new PovRenderer({
      viewDistance: int(args, 'view-distance', 'VIEW_DISTANCE', 6)
    })
    console.log('prewarm...')
    pov.attach(bot, { prewarm: true })
    console.log(`cache after prewarm: ${pov.sectionCount()} sections`)
    console.log('')
    console.log(
      'step  cold x  cold total/world | warm x  tick: wall/meshed/calls | warm total/world | cache'
    )
    console.log('-'.repeat(104))

    const measure = () => {
      const timing = {}
      const t0 = performance.now()
      const frame = pov.render({
        width: 640,
        height: 360,
        timeOfDay: 6000,
        timing
      })
      const total = performance.now() - t0
      frameToPng(frame)
      return { total, timing }
    }
    const tp = async x => {
      bot.chat(`/tp ${bot.username} ${x} ${p.y} ${p.z}`)
      await wait(200)
    }

    for (let step = 1; step <= steps; step++) {
      // cold: capture immediately after moving a chunk
      const coldX = p.x + (2 * step - 1) * 16
      await tp(coldX)
      const cold = measure()

      // warm: move another chunk, mesh in the background with tick(), then capture
      const warmX = p.x + 2 * step * 16
      await tp(warmX)
      let meshed = 0
      let calls = 0
      const tw0 = performance.now()
      while (true) {
        const n = pov.tick(4)
        if (n <= 0) break
        meshed += n
        if (++calls > 300) break
      }
      const tickWall = performance.now() - tw0
      const warm = measure()

      console.log(
        `${String(step).padStart(4)}  ${String(coldX).padStart(5)} ${f1(cold.total).padStart(10)}/${f1(cold.timing.world).padStart(5)} | ` +
          `${String(warmX).padStart(6)} ${f1(tickWall).padStart(11)}/${String(meshed).padStart(4)}/${String(calls).padStart(4)} | ` +
          `${f1(warm.total).padStart(10)}/${f1(warm.timing.world).padStart(5)} | ${pov.sectionCount()}`
      )
    }

    pov.detach()
    clearTimeout(timer)
    bot.quit()
    setTimeout(() => process.exit(0), 400)
  })
}

main()
