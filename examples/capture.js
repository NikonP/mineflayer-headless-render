// One-shot capture: join a server, render a single POV frame, save it, quit.
//
//   MC_HOST=my.server MC_PORT=25565 node examples/capture.js --out out/frame.png
//   node examples/capture.js --width 1280 --height 720 --time 6000 --pitch -10
//
// Flags (env fallback in brackets): --host [MC_HOST], --port [MC_PORT],
// --username [MC_USERNAME], --version [MC_VERSION], --auth [MC_AUTH],
// --out [OUT], --width [WIDTH], --height [HEIGHT], --format [FORMAT],
// --view-distance [VIEW_DISTANCE], --time, --yaw, --pitch (degrees), --settle.
const fs = require('fs')
const path = require('path')
const { captureFrame } = require('..')
const { wait, parseArgs, pick, int, createBot } = require('../scripts/dev-bot')

async function main() {
  const args = parseArgs()
  const bot = createBot(args)
  const out = pick(args, 'out', 'OUT', 'out/frame.png')
  const timer = setTimeout(() => {
    console.error('timed out waiting for spawn')
    process.exit(1)
  }, 60000)

  bot.on('error', err => {
    clearTimeout(timer)
    console.error('bot error:', err.message)
    process.exit(1)
  })

  bot.once('spawn', async () => {
    clearTimeout(timer)
    await wait(int(args, 'settle', 'SETTLE', 2000))

    const yaw = args.yaw !== undefined ? parseFloat(args.yaw) : undefined
    const pitch =
      args.pitch !== undefined
        ? (parseFloat(args.pitch) * Math.PI) / 180
        : undefined
    const t0 = Date.now()
    const buf = await captureFrame(bot, {
      width: int(args, 'width', 'WIDTH', 640),
      height: int(args, 'height', 'HEIGHT', 360),
      format: pick(args, 'format', 'FORMAT', 'png'),
      viewDistance: int(args, 'view-distance', 'VIEW_DISTANCE', 6),
      yaw,
      pitch,
      timeOfDay: args.time !== undefined ? parseFloat(args.time) : undefined
    })

    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, buf)
    console.log(`saved ${out} (${buf.length} bytes) in ${Date.now() - t0} ms`)

    bot.quit()
    setTimeout(() => process.exit(0), 300)
  })
}

main()
