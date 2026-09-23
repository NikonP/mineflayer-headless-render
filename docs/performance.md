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

## Optimisation results

Measured on the local Paper 1.21.4 test server (a generated world, view6,
`bench/bench.js --cache`, 30 frames after 5 warmup), before/after each change
integrated on `perf/integration`:

| Change | Config | Before | After |
| --- | --- | --- | --- |
| Section frustum culling | 640×360 view6 | 118.7 ms | 92.7 ms |
| | 1280×720 view6 | 253.4 ms | 237.3 ms |
| | 1280×720 view12 | 275.2 ms | 249.8 ms |
| Packed block-lookup key | 2366-section meshing pass | 9.1 s | 6.8 s |
| Translucent pass (opaque + blended) | 640×360 view6 | 79.6 ms | 78.7 ms |
| | 1280×720 view6 | 201.5 ms | 197.8 ms |

The translucent pass costs nothing measurable: section meshes carry separate
opaque/translucent index lists (split at mesh time), so a water-free scene never
enters the second pass, and a scene with water only re-visits the affected
sections. Light is baked once per mesh and kept for both passes in a per-mesh
scratch buffer.

Culling also cuts the per-face light bake from ~8.9 ms to ~2.7 ms at view6,
because culled sections skip it too. It was verified pixel-identical to the
unculled path (diff = 0) across several camera angles via `opts.noCull`.

The packed block-lookup key is a pure CPU win inside `getSectionGeometry`; it has
no effect on frame time once the section meshes are cached.

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
