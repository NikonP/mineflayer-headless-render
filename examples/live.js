// Live renderer: keep section meshes between captures while the bot moves.
//
//   node examples/live.js --frames 5 --interval 2000
//
// PovRenderer.attach() hooks block/chunk invalidation and prewarms the view box
// (a one-off cost of a few seconds). Calling tick() from the bot's tick spreads
// the cost of entering new chunks so captures stay smooth.
const fs = require('fs')
const path = require('path')
const { PovRenderer } = require('..')
const { wait, parseArgs, pick, int, createBot } = require('../scripts/dev-bot')

async function main () {
  const args = parseArgs()
  const bot = createBot(args)
  const outDir = pick(args, 'out', 'OUT', path.join(__dirname, 'out'))
  const frames = int(args, 'frames', 'FRAMES', 5)
  const interval = int(args, 'interval', 'INTERVAL', 2000)
  const width = int(args, 'width', 'WIDTH', 640)
  const height = int(args, 'height', 'HEIGHT', 360)
  const timeOfDay = args.time !== undefined ? parseFloat(args.time) : undefined
  const timer = setTimeout(() => { console.error('timed out waiting for spawn'); process.exit(1) }, 60000)

  bot.on('error', (err) => {
    clearTimeout(timer)
    console.error('bot error:', err.message)
    process.exit(1)
  })

  bot.once('spawn', async () => {
    clearTimeout(timer)
    await wait(int(args, 'settle', 'SETTLE', 2500))

    const pov = new PovRenderer({ viewDistance: int(args, 'view-distance', 'VIEW_DISTANCE', 6) })
    const t0 = Date.now()
    pov.attach(bot)
    console.log(`prewarm: ${pov.sectionCount()} sections in ${Date.now() - t0} ms`)

    // Spread meshing between captures; harmless if the bot is idle.
    const onTick = () => pov.tick(4)
    bot.on('physicsTick', onTick)

    fs.mkdirSync(outDir, { recursive: true })
    for (let i = 0; i < frames; i++) {
      const t = Date.now()
      const buf = pov.capture({ width, height, timeOfDay })
      const file = path.join(outDir, `live_${i}.png`)
      fs.writeFileSync(file, buf)
      console.log(`frame ${i}: ${Date.now() - t} ms, ${pov.sectionCount()} cached sections -> ${file}`)
      if (i < frames - 1) await wait(interval)
    }

    bot.off('physicsTick', onTick)
    pov.detach()
    bot.quit()
    setTimeout(() => process.exit(0), 300)
  })
}

main()
