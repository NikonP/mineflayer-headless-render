// Fresh-process assets + first frame, followed by empty-cache captures of the
// same live-world snapshot. Run each revision in a new process at the same spot.
//   node bench/bench-cold.js --view 6 --out bench/out/cold.json
// --profile writes a CPU profile of assets and the first frame beside the JSON.
// --runs N repeats meshing with empty caches (only run 0 has cold JIT/heightmap).
// --reference REF checks geometry and pixels against that git revision's world
// adapter on the same snapshot. Dependencies and raster must be unchanged.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const inspector = require('inspector')
const { promisify } = require('util')
const { once } = require('events')
const assert = require('assert/strict')
const { execFileSync } = require('child_process')
const Module = require('module')
const { getAssets, renderFrame, frameToPng } = require('../src/capture')
const { MeshCache } = require('../src/worldRender')
const { createBot, parseArgs, int, wait } = require('../scripts/dev-bot')

function meshHash(cache) {
  const hash = crypto.createHash('sha256')
  for (const [key, { mesh }] of cache.entries()) {
    hash.update(key)
    if (!mesh) continue
    for (const field of [
      'positions',
      'uvs',
      'colors',
      'indices',
      'lightData',
      'opaqueIndices',
      'translucentIndices',
      'aabb'
    ]) {
      const values = mesh[field]
      if (!values) continue
      hash.update(field)
      const data = ArrayBuffer.isView(values)
        ? values
        : Float64Array.from(values)
      hash.update(Buffer.from(data.buffer, data.byteOffset, data.byteLength))
    }
  }
  return hash.digest('hex')
}

// Only the world adapter is under comparison; its dependencies and the raster
// stay identical. Compile at its real path so relative imports resolve normally.
function referenceCache(ref) {
  const filename = require.resolve('../src/worldRender')
  const source = execFileSync('git', ['show', `${ref}:src/worldRender.js`], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8'
  })
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = module.paths
  mod._compile(source, filename)
  return new mod.exports.MeshCache()
}

async function main() {
  const args = parseArgs()
  const out = args.out || 'bench/out/cold.json'
  fs.mkdirSync(path.dirname(out), { recursive: true })
  const bot = createBot(args)
  const timer = setTimeout(() => {
    console.error('timed out')
    process.exit(1)
  }, 300000)
  let session
  try {
    await once(bot, 'spawn')
    await bot.waitForChunksToLoad()
    await wait(int(args, 'settle', 'SETTLE', 10000))
    // All captures below are synchronous: network updates cannot change the
    // world between the first frame and the empty-cache repeats.
    const options = {
      width: int(args, 'width', 'WIDTH', 640),
      height: int(args, 'height', 'HEIGHT', 360),
      viewDistance: int(args, 'view', 'VIEW', 6),
      yaw: Math.PI,
      pitch: -0.15,
      timeOfDay: 6000
    }
    const report = {
      node: process.version,
      position: bot.entity.position.clone(),
      columns: bot.world.getColumns().length,
      options,
      runs: []
    }
    let post
    if (args.profile) {
      session = new inspector.Session()
      session.connect()
      post = promisify(session.post.bind(session))
      await post('Profiler.enable')
      await post('Profiler.start')
    }
    const start = performance.now()
    getAssets(bot.version, bot.version)
    report.assetsMs = performance.now() - start
    for (let i = 0; i < int(args, 'runs', 'RUNS', 1); i++) {
      const cache = new MeshCache()
      const timing = {}
      const t0 = performance.now()
      const frame = renderFrame(bot, { ...options, meshCache: cache, timing })
      const t1 = performance.now()
      const png = frameToPng(frame)
      const t2 = performance.now()
      if (i === 0 && post) {
        const { profile } = await post('Profiler.stop')
        fs.writeFileSync(out + '.cpuprofile', JSON.stringify(profile))
        session.disconnect()
        session = null
      }
      const run = {
        renderMs: t1 - t0,
        encodeMs: t2 - t1,
        ...timing,
        sections: cache.entries().size,
        meshHash: meshHash(cache),
        frameHash: crypto.createHash('sha256').update(frame.data).digest('hex'),
        rssMB: process.memoryUsage().rss / 1024 / 1024
      }
      report.runs.push(run)
      console.log(JSON.stringify(run))
      if (i === 0) fs.writeFileSync(out + '.png', png)
    }
    if (args.reference) {
      const cache = referenceCache(args.reference)
      const timing = {}
      const frame = renderFrame(bot, { ...options, meshCache: cache, timing })
      const geometry = meshHash(cache)
      const pixels = crypto
        .createHash('sha256')
        .update(frame.data)
        .digest('hex')
      for (const run of report.runs) {
        assert.equal(run.meshHash, geometry, 'geometry differs from reference')
        assert.equal(run.frameHash, pixels, 'pixels differ from reference')
      }
      report.reference = {
        ref: args.reference,
        ...timing,
        meshHash: geometry,
        frameHash: pixels
      }
      console.log(`reference ${args.reference}: geometry and pixels identical`)
    }
    report.firstPngMs =
      report.assetsMs + report.runs[0].renderMs + report.runs[0].encodeMs
    fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n')
    console.log(
      `assets=${report.assetsMs.toFixed(1)}ms first PNG=${report.firstPngMs.toFixed(1)}ms -> ${out}`
    )
  } finally {
    if (session) session.disconnect()
    clearTimeout(timer)
    bot.quit()
  }
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
