# AGENTS.md

Working notes for agents/contributors. This is a draft project; the layout and
API may still change.

## What this is

Headless POV frame capture for a mineflayer bot, using a hand-written software
rasterizer (`src/`). No GPU/canvas. Frames are meant for an AI agent that needs
to recognise what the bot sees, so **recognisability beats vanilla parity**.
Entities come from Bedrock assets, blocks/items from Java assets. Targets Java
**1.21.4**.

## Layout

- `src/` — the renderer. See the module table in `docs/architecture.md`.
- `vendor/prismarine-viewer/` — vendored MIT code (`models.js`,
  `modelsBuilder.js`). `models.js` carries a local patch (see its header).
- `examples/` — runnable demos; `test/` — correctness checks; `bench/` —
  benchmarks; `scripts/` — dev helpers and asset setup.
- `bedrock-samples/` — git submodule (Mojang, **not** MIT, not redistributed).
  Its content is fetched sparsely; `scripts/setup-assets.sh` configures it.
- `docs/` — architecture, assets, API, performance.
- Scripts write to their own `out/` (gitignored).

## Commands

The scripts read the server from the environment; nothing is hardcoded:

```sh
MC_HOST=localhost MC_PORT=25565 MC_USERNAME=POVBot MC_VERSION=1.21.4

node examples/capture.js --out out/frame.png --width 1280 --height 720
node examples/live.js
node examples/arena.js                 # needs creative + commands

node test/entity.js                    # offline, no server
node test/cache.js                     # needs a server; expect max=0

node --expose-gc bench/bench.js --cache --frames 30 --warmup 5 \
  --configs "640x360@6,1280x720@6"
node bench/bench-move.js
```

`npm test` runs `test/cache.js` (needs a server).

## Conventions

- Style: JavaScript Standard Style. ESLint (neostandard) handles correctness,
  Prettier handles formatting (`eslint-config-prettier` disables the conflicting
  stylistic rules). Run `npm run lint` / `npm run format`; don't hand-format.
- Configs: `eslint.config.js`, `prettier.config.js`, `.prettierignore`,
  `.editorconfig`, `jsconfig.json` (language server). `vendor/` and
  `bedrock-samples/` are never linted or formatted.
- Comments explain *why*, not *what*.
- `performance` is used as a global (Node).
- Prefer extending the existing modules over adding parallel paths.
- Public API changes must be reflected in `index.d.ts` and `docs/api.md`.

## Things that will bite you

- **Assets split.** Entities (models + textures) come from `bedrock-samples`;
  blocks and dropped items come from `minecraft-assets` (Java). Don't mix them.
- **Vendored viewer code.** `vendor/prismarine-viewer/models.js` is upstream
  v1.33.0 plus a local patch ("remove negative-Y face culling"). Don't "update"
  it blindly; keep the patch and record provenance in
  `THIRD_PARTY_NOTICES.md`.
- **Never bake light into cached mesh colours.** Meshes are reused across frames,
  so `colors *= light` would compound and freeze day/night. Light lives per quad
  in `mesh.lightData` and is applied into a reusable scratch buffer each frame.
- **Mesh vertex layout is quads of 4.** The block mesher emits four vertices per
  face that share a normal and neighbouring air block; the light code relies on
  this. Don't reorder vertices without revisiting `light.computeLightData`.
- **Cache key format.** `MeshCache` keys sections as
  `` `${chunkX},${sectionY},${chunkZ}` `` where `sectionY` is the section
  **origin** (multiple of 16, can be negative). Invalidation must build the same
  key. Block changes invalidate the section plus its 26 neighbours.
- **`renderWorld`/`captureFrame` are deliberately uncached.** They rebuild every
  section so stands that mutate the world always see fresh geometry. Use
  `PovRenderer` when you want the cache; it hooks invalidation.
- **Server light is unreliable.** Many servers never send `update_light` and
  report sky light `0` for open-sky blocks. `Heightmap` corrects the obvious
  lies; don't assume the numbers are vanilla-correct.
- **`capture()`/`renderFrame()` are synchronous** and block the event loop.
  Keep captures off hot paths; `PovRenderer.tick()` spreads meshing out.
- **`opts.noLight`** skips the light bake — handy for telling light artifacts
  apart from meshing/texture bugs.
- **`bedrock-samples` is Mojang's, not MIT.** Never commit its content. `out/` is
  gitignored; don't commit frames.

## Workflow expectations

- Before committing: `npm run lint` and `npm run format:check` must pass.
- After any change touching meshing, caching or lighting: run `node test/cache.js`
  (expect `max=0` for cached vs uncached) **and** a `bench/bench.js --cache` run.
- After changing entity math/models: run `node test/entity.js` and eyeball the
  output.
- Perf work should be measured before/after, not assumed.
- For anything that changes behaviour or design (not a small fix), ask first and
  keep the diff focused.
