# Performance

Numbers are from `bench/bench.js` on a single core against the development
server (superflat), Java 1.21.4. Your mileage will vary with the world and the
machine.

## Cached (`PovRenderer` / `MeshCache`), superflat

| Config | Total | fps | world | light | terrain | entities | encode |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 640×360 view6 | **36.6 ms** | 27 | 1.9 | 1.3 | 15.7 | 0.5 | 16.3 |
| 1280×720 view6 | **103.6 ms** | 10 | 1.1 | 1.4 | 41.7 | 0.9 | 56.1 |

All times in milliseconds. `world` is meshing (cached: only new sections),
`light` is the per-face light bake, `terrain` is rasterising the block mesh,
`entities` is mobs/items, `encode` is PNG encoding.

Scene size: 169 meshes / ~173k triangles at view6 on superflat.

## Normal (non-superflat) worlds

A generated world has far more geometry — roughly 1,100 meshes / ~1M triangles at
view6, ~3,700 / ~4M at view12:

| Config | Cached | Uncached |
| --- | --- | --- |
| 640×360 view6 | ~93 ms | ~27 000 ms |
| 1280×720 view6 | ~216 ms | — |
| 1280×720 view12 | ~395 ms | — |

Meshing dominates without a cache; with it, the remaining time is rasterisation
and PNG encoding.

## Cold start

The first frame on a new world is meshing-bound. `bench/bench-cold.js` measures a
fresh process per sample (assets + first frame; connection and imports excluded),
and `--reference <rev>` compares geometry and pixel hashes against that git
revision on the same snapshot.

| Metric (median of 3) | `55540a4` | `593095c` |
| --- | --- | --- |
| First PNG (assets + render + encode) | 15,375 ms | 10,060 ms |
| First-frame meshing | 15,078 ms | 9,738 ms |
| RSS after first capture | 1,094 MiB | 708 MiB |

Both revisions produced identical geometry and frame hashes.

## Changelog

Measured on the local Paper 1.21.4 test server (generated world, view6,
`bench/bench.js --cache`, 30 frames after 5 warmup), before/after each change
(AMD Ryzen 7 8700G, Node v26.8.1):

| Change | Config | Before | After |
| --- | --- | --- | --- |
| Section frustum culling (`dd87aab`) | 640×360 view6 | 118.7 ms | 92.7 ms |
| | 1280×720 view6 | 253.4 ms | 237.3 ms |
| | 1280×720 view12 | 275.2 ms | 249.8 ms |
| Packed block-lookup key (`d1e7370`) | 2366-section meshing pass | 9.1 s | 6.8 s |
| Translucent pass (`bb6a524`) | 640×360 view6 | 79.6 ms | 78.7 ms |
| | 1280×720 view6 | 201.5 ms | 197.8 ms |
| Cold meshing (`593095c`) | first PNG, fresh process | 15.4 s | 10.1 s |

- Culling also cut the per-face light bake from ~8.9 ms to ~2.7 ms at view6
  (culled sections skip it), and was verified pixel-identical (diff = 0) via
  `opts.noCull`.
- The packed block-lookup key is a pure CPU win inside `getSectionGeometry`; it
  has no effect once meshes are cached.
- The translucent pass costs nothing measurable: meshes carry separate
  opaque/translucent index lists split at mesh time, so water-free scenes never
  enter the second pass.
- Cold meshing reuses block lookups and state variants; geometry and pixels
  matched the baseline on the same snapshot.
- A `perf/raster-setup` variant was **not** merged: it changed floating-point
  rounding and produced small pixel differences.

## Moving

`bench/bench-move.js` teleports the bot one chunk at a time:

- A cold capture right after crossing a chunk boundary meshes the newly entering
  sections (~78 sections, a few hundred ms on a normal world).
- After warming with `PovRenderer.tick(4)` from the bot tick, the capture itself
  stays cheap (tens of ms).

## What is cached, and what isn't

- **Cached:** section geometry (positions, UVs, colours, indices, per-face light)
  in world space. Camera movement is free.
- **Not cached:** light values (baked per frame into a scratch buffer, so
  day/night keeps working) and the rasterised output.

## Known costs / limits

- Rasterisation and PNG encoding are the floor once meshing is cached.
- Section meshes are frustum-culled by their world-space AABB (light bake
  included). There is no occlusion culling yet.
- `capture()` is synchronous and blocks the event loop. A continuous stream
  would need meshing/rasterising moved off-thread.

## Possible next steps

- Cheaper block materialisation: the current world lookup also fetches block
  entities and light the mesher does not consume.
- Precomputed model transforms.
- Pre-mesh camera culling, which would change cache population/prewarming and
  needs a design decision.

All of these need their own profiling and geometry/pixel equivalence checks
(`bench/bench-cold.js --reference`).
