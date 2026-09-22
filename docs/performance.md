# Performance

Numbers are from `bench/bench.js` on a single core, against the development
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
view6, ~3,700 / ~4M at view12. Measured on the same renderer:

| Config | Cached | Uncached |
| --- | --- | --- |
| 640×360 view6 | ~93 ms | ~27 000 ms |
| 1280×720 view6 | ~216 ms | — |
| 1280×720 view12 | ~395 ms | — |

Meshing is the dominant cost without a cache; with the cache it drops to almost
nothing, and the remaining time is rasterisation and PNG encoding.

## Moving

`bench/bench-move.js` teleports the bot one chunk at a time:

- A cold capture right after crossing a chunk boundary meshes the newly entering
  sections (~78 sections, a few hundred ms on a normal world).
- After warming with `PovRenderer.tick(4)` from the bot tick, the capture itself
  stays cheap (tens of ms); the meshing happened between captures.

## What is cached, and what isn't

- **Cached:** section geometry (positions, UVs, colours, indices, per-face light)
  in world space. Camera movement is free.
- **Not cached:** light values themselves (baked per frame into a scratch buffer,
  so day/night keeps working) and the rasterised output.

## Known costs

- Rasterisation and PNG encoding are the floor once meshing is cached.
- Section meshes are frustum-culled by their world-space AABB, so sections
  entirely outside the view are skipped (light bake included). There is no
  occlusion culling yet, only the frustum test.
- `capture()` is synchronous and blocks the event loop. For a continuous stream,
  meshing/rasterising would need to move off-thread.
