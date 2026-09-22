# mineflayer-headless-render

POV frames for mineflayer bots. Software rasterizer. No GPU, no WebGL, no native build.

## Heads up

- Single-person project. Built for me. No guarantees.
- Almost all code is AI-generated. I directed, reviewed, tested.
- Draft. API and layout may change.

## Why

- Wanted frames for an AI agent that plays Minecraft.
- prismarine-viewer's headless mode uses `node-canvas-webgl`: native build, system libs, breaks on new Node. That was the pain.
- This replaces it with a plain-JS rasterizer.
- Don't need vanilla accuracy or high fps. Need recognizable.
- Entities: Bedrock models + textures (self-contained, match 1:1).
- Blocks and dropped items: Java assets.

## Renders

Frames from `examples/arena.js` (superflat test world). Mobs face the camera.

<p>
  <img src="https://raw.githubusercontent.com/NikonP/mineflayer-headless-render/main/docs/images/arena-overview.png" width="49%">
  <img src="https://raw.githubusercontent.com/NikonP/mineflayer-headless-render/main/docs/images/arena-mobs.png" width="49%">
  <img src="https://raw.githubusercontent.com/NikonP/mineflayer-headless-render/main/docs/images/arena-blocks.png" width="49%">
  <img src="https://raw.githubusercontent.com/NikonP/mineflayer-headless-render/main/docs/images/arena-items.png" width="49%">
</p>

Top: overview, mobs. Bottom: block palette, dropped items.

## Requirements

- Node >= 18.
- A Minecraft server. Targets Java **1.21.4**.
- `git`, for the one-time asset fetch below.
- Bedrock asset pack (not bundled, see below).

## Install

```sh
npm install mineflayer-headless-render
```

Assets (Mojang, not MIT, not bundled):

```sh
npx mineflayer-headless-render-setup ./bedrock-samples
```

That sparse-clones `bedrock-samples` into `./bedrock-samples` of the current
directory. The renderer resolves the pack in this order: `configure({ bedrockPath })`
> `BEDROCK_SAMPLES_PATH` > `<package>/bedrock-samples` > `./bedrock-samples`
(relative to the working directory). So running the command in your project root
is enough; no environment variable needed.

## Use

One shot:

```js
const mineflayer = require('mineflayer')
const { captureFrame } = require('mineflayer-headless-render')

const bot = mineflayer.createBot({ host: 'localhost', port: 25565, username: 'POVBot', auth: 'offline' })

bot.once('spawn', async () => {
  const png = await captureFrame(bot, { width: 640, height: 360, viewDistance: 6 })
  require('fs').writeFileSync('frame.png', png)
  bot.quit()
})
```

Moving bot (keeps section meshes between frames):

```js
const { PovRenderer } = require('mineflayer-headless-render')

const pov = new PovRenderer({ viewDistance: 6 })
pov.attach(bot)                            // hooks invalidation, prewarms
bot.on('physicsTick', () => pov.tick(4))   // optional, spreads meshing
const png = pov.capture({ width: 640, height: 360 })
pov.detach()
```

Full API: [docs/api.md](docs/api.md).

## Scripts

Server comes from `MC_HOST` / `MC_PORT` / `MC_USERNAME` / `MC_VERSION`. Nothing hardcoded.

```sh
node examples/capture.js --out out/frame.png     # one shot
node examples/live.js                            # PovRenderer + tick()
node examples/arena.js                           # mob/item/block arena (needs commands)

node test/entity.js                              # offline entity render, no server
node test/cache.js                               # cached vs uncached diff (needs server)

node --expose-gc bench/bench.js --cache          # per-stage frame cost
node bench/bench-move.js                         # cost of moving chunk by chunk
```

From a clone, the asset fetch is `bash scripts/setup-assets.sh` (the npm `bin`
shim is what makes `npx mineflayer-headless-render-setup` work for consumers).

## Limits

- Capture is synchronous. Blocks the event loop. Fine for occasional frames, not a video stream.
- No frustum/occlusion culling. Behind-camera sections still rasterized.
- Entities are static bind pose. No animations.
- Variant-only mobs (tropical fish, horse, cat, ...) render one arbitrary variant.
- Lighting approximate: day/night curve + server block light + heightmap sky fix. No smooth lighting.
- Dropped items are camera-facing sprites, not vanilla spinning cards.
- Bedrock assets are not bundled: without them entities fail with a setup error
  (see [Install](#install)).
- Code is MIT. Rendered pixels contain Mojang textures.

## How

`bot.world` → block mesher → section meshes (cached, world space) → per-face light into scratch → rasterizer → entities/items → PNG/JPEG. Details: [docs/architecture.md](docs/architecture.md).

## Credits

- [prismarine-viewer](https://github.com/PrismarineJS/prismarine-viewer) — block mesher + entity model conversion. MIT. Partly vendored.
- [mineflayer](https://github.com/PrismarineJS/mineflayer) and the PrismarineJS stack.
- [bedrock-samples](https://github.com/Mojang/bedrock-samples) — entity models/textures.

## License

MIT for code. Assets not covered. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
