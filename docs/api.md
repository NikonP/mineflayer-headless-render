# API

```js
const {
  captureFrame,
  renderFrame,
  frameToPng,
  frameToJpeg,
  PovRenderer,
  configure,
  getAssets,
  DEFAULT_VERSION
} = require('mineflayer-headless-render')
```

The renderer takes a live mineflayer `bot` — it does not own the connection.

## configure(opts)

Overrides asset location / default version. Call it before the first render.

```js
configure({
  bedrockPath: '/opt/minecraft/bedrock-samples', // default: $BEDROCK_SAMPLES_PATH, else the first of <package>/bedrock-samples, ./bedrock-samples that exists
  defaultVersion: '1.21.4'                        // Java version when bot.version is unavailable
})
```

Changing `bedrockPath` clears the cached entity assets.

## captureFrame(bot, opts) → Promise\<Buffer>

Renders one frame and encodes it (PNG by default). Async wrapper around
`renderFrame` + `frameToPng`/`frameToJpeg`.

```js
const png = await captureFrame(bot, { width: 1280, height: 720, format: 'png' })
```

## renderFrame(bot, opts) → Frame

Renders without encoding. **Synchronous** — blocks the event loop.

```js
const frame = renderFrame(bot, { width: 640, height: 360 })
```

If `opts.timing` is an object, it is filled with per-stage milliseconds
(`world`, `light`, `terrain`, `entities`) plus `meshes` and `tris`.

## Frame

```ts
{ width: number, height: number, data: Uint8ClampedArray, zbuffer: Float32Array }
```

`data` is RGBA, `width * height * 4` bytes.

## frameToPng(frame) → Buffer / frameToJpeg(frame, quality?) → Buffer

Encode a raw frame.

## PovRenderer

Keeps section meshes between captures so a moving bot only re-meshes what enters
the view.

```js
const pov = new PovRenderer({ viewDistance: 6 })
pov.attach(bot)                            // hooks invalidation + prewarms
bot.on('physicsTick', () => pov.tick(4))   // optional
const png = pov.capture({ width: 640, height: 360, yaw, pitch })
pov.detach()
```

| Method | Description |
| --- | --- |
| `attach(bot, { prewarm = true })` | Hooks `blockUpdate` / chunk-unload invalidation and, by default, meshes the whole view box (one-off, seconds). |
| `detach()` | Removes the hooks. |
| `prewarm(opts?)` | Meshes the whole current view box; returns a raw frame. |
| `tick(budgetMs = 4)` | Meshes missing sections up to the budget; returns how many were newly meshed. Safe to call after `detach()` (returns 0). |
| `render(opts?)` | Raw `Frame` (no encoding). |
| `capture(opts?)` | Encoded `Buffer` (PNG by default). |
| `sectionCount()` | Number of cached sections (including empty ones). |
| `clear()` | Drops the mesh cache. |

`attach()` and `capture()` are synchronous; `capture()` blocks the event loop for
its duration.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `width`, `height` | 640, 360 | Frame size in pixels. |
| `format` | `'png'` | `'png'` or `'jpeg'` (encoded output only). |
| `quality` | 90 | JPEG quality. |
| `yaw`, `pitch` | bot's | Camera angles in radians (pitch positive = up). |
| `fov` | 70 | Vertical field of view, degrees. |
| `near`, `far` | 0.05, 1000 | Clip planes. |
| `viewDistance` | 6 | View distance in chunks. |
| `timeOfDay` | server clock | World time 0–24000 for sky/light. |
| `assetsVersion` | `bot.version` | Java asset version for blocks/items. |
| `version` | `DEFAULT_VERSION` | Java version fallback when `bot.version` is unset. |
| `noLight` | false | Skip the light bake (debug). |
| `includeSelf` | false | Render the bot's own player model. |
| `evictMargin` | 2 | `PovRenderer` only: chunks kept cached beyond the view box. |

## getAssets(version, assetsVersion) / DEFAULT_VERSION

`getAssets` loads and caches the block atlas and blockstates for a version.
`DEFAULT_VERSION` is the Java version used when the bot does not expose one
(`'1.21.4'`).
