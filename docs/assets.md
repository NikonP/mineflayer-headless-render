# Assets

The renderer mixes two asset sources on purpose.

| Content | Source | Why |
| --- | --- | --- |
| Mobs, player | `bedrock-samples` (Bedrock) | Self-contained geometry + textures; UVs match 1:1. |
| Blocks | `minecraft-assets` (Java) | The meshing pipeline is Java-native (`blockstates` + `.mcmeta`). |
| Dropped items | `minecraft-assets` (Java) | `items/*.png`, or `blocks/*.png` for block items. |
| Item ids → names | `minecraft-data` | Read from the entity metadata stack. |
| Block/item/biome/tint data | `minecraft-data` | Shared with the rest of the PrismarineJS stack. |

Bedrock is used for entities because those models and textures are complete and
match each other. Java is used for blocks and items because the mesher already
is Java, and Bedrock diverges (names, animations) for no benefit here.

## bedrock-samples

- Upstream: <https://github.com/Mojang/bedrock-samples>, pinned to tag
  `v1.21.50.7` (the closest Bedrock release to the targeted Java 1.21.4).
- Only these paths are needed: `resource_pack/entity`, `resource_pack/materials`,
  `resource_pack/models`, `resource_pack/render_controllers`,
  `resource_pack/textures/entity`. `models` as a whole (not just `models/entity`)
  because `models/mobs.json` holds the shared geometries the entity defs point at
  (player, iron golem, skull, agent, bed).
- The pack is **not** redistributed with this project (Mojang EULA). Fetch it
  with `scripts/setup-assets.sh`, which does a partial + sparse clone.
- The renderer resolves the pack from, in order:
  1. `configure({ bedrockPath })`
  2. the `BEDROCK_SAMPLES_PATH` environment variable
  3. `./bedrock-samples` relative to the package

Changing the path after models were built clears the asset caches.

## minecraft-assets

Block and item textures come from the `minecraft-assets` npm package, requested
per Java version (`1.21.4`). The package's code is MIT, but the textures inside
it are Mojang's — this project does not redistribute them either.

## Licensing

The code is MIT (see [LICENSE](../LICENSE)). Assets are not covered by that
licence. See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) for the full
list, including the vendored prismarine-viewer files.

## Versioning

- **Java 1.21.4** is the targeted and tested version. Other versions may work
  where `minecraft-assets` / `minecraft-data` have data, but are untested.
- **Bedrock `v1.21.50.7`** is pinned. Bedrock entity assets change slowly, so no
  per-version mapping is applied.
