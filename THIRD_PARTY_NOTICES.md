# Third-party notices

This project is MIT licensed (see [LICENSE](LICENSE)). It depends on, and in one
case vendors, third-party code, and it uses Minecraft assets that are **not**
covered by this project's licence and are **not** redistributed here.

## Vendored code

### prismarine-viewer — MIT

- Files: `vendor/prismarine-viewer/models.js`, `vendor/prismarine-viewer/modelsBuilder.js`,
  and the upstream licence at `vendor/prismarine-viewer/LICENSE`.
- Upstream: <https://github.com/PrismarineJS/prismarine-viewer> (v1.33.0).
- Copyright (c) 2020 PrismarineJS.
- `models.js` is vendored with a local patch ("remove negative-Y face culling")
  and with an `AO_DEBUG` debug leftover stripped. `modelsBuilder.js` is
  unmodified. See the header comments in those files for details.
- `src/entityModels.js` (Bedrock model conversion) and `src/atlas.js`
  (canvas-free block atlas) are re-implementations of the corresponding
  prismarine-viewer files (`viewer/lib/entity/Entity.js`, `viewer/lib/atlas.js`),
  written for this project and based on their logic.

## Runtime dependencies

| Package | Licence | Notes |
| --- | --- | --- |
| [mineflayer](https://github.com/PrismarineJS/mineflayer) | MIT | Peer dependency; the host bot provides it. |
| [prismarine-viewer](https://github.com/PrismarineJS/prismarine-viewer) | MIT | Only `models.js`/`modelsBuilder.js` are vendored (see above). |
| [minecraft-data](https://github.com/PrismarineJS/minecraft-data) | MIT | Block/item/biome/tint data. |
| [minecraft-assets](https://github.com/PrismarineJS/minecraft-assets) | MIT | Block/item textures. The bundled textures are Mojang assets (see below). |
| [vec3](https://github.com/PrismarineJS/node-vec3) | MIT | Vector math. |
| [pngjs](https://github.com/pngjs/pngjs) | MIT | PNG decode/encode. |
| [jpeg-js](https://github.com/jpeg-js/jpeg-js) | MIT | JPEG encode. |

Transitive dependencies pulled in by mineflayer (prismarine-world,
prismarine-chunk, prismarine-nbt, …) are MIT licensed by the PrismarineJS
project.

## Asset packs (not redistributed)

### bedrock-samples — Mojang

- <https://github.com/Mojang/bedrock-samples>
- "(c) Mojang AB. All rights reserved." — subject to the
  [Minecraft End User License Agreement](https://www.minecraft.net/en-us/eula).
- Used for entity models and textures. **Not** included in this repository;
  `scripts/setup-assets.sh` downloads it to your machine.

### Minecraft block/item textures

- Delivered through the `minecraft-assets` npm package, which itself contains
  Mojang-owned textures. This repository does not redistribute them.

If you redistribute frames rendered by this project, remember that they contain
Mojang's textures and are subject to Mojang's terms.
