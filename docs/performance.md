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

## Cold-meshing follow-up (2026-09-23)

The earlier `perf/frustum-cull` and `perf/mesh-getblock` branches are already in
`main` (`55540a4`). `perf/raster-setup` is not: its commit reports small pixel
differences from changed floating-point rounding, so it was not incorporated
into this pixel-identical meshing experiment.

Environment: AMD Ryzen 7 8700G, Node v26.8.1, local Paper 1.21.4 build 232,
generated jungle world. Final comparisons froze `randomTickSpeed` at 0 and used
the same camera and geometry counts; the server rule was restored afterwards.

`bench/bench.js` warms assets and some geometry before timing. For the first
frame, use `bench/bench-cold.js` in a **new Node process for each sample**:

```sh
MC_HOST=localhost MC_PORT=25565 MC_USERNAME=POVBot MC_VERSION=1.21.4 \
  node bench/bench-cold.js --view 6 --out bench/out/cold.json

# Compare the world adapter against a git revision on the exact same snapshot.
# Dependencies, assets and raster must be identical between revisions.
node bench/bench-cold.js --reference 55540a4 --out bench/out/checked.json

# Optional first-frame CPU profile, or repeated empty-mesh-cache captures.
node bench/bench-cold.js --profile --out bench/out/profile.json
node bench/bench-cold.js --runs 3 --out bench/out/repeated.json
```

The script waits for chunks and a settling interval (`--settle`, default 10 s),
then reports asset loading, render stages, PNG encoding, RSS and SHA-256 hashes
of geometry and pixels. Connection/chunk loading and module imports are excluded;
this is process-cold renderer state, not a flushed OS disk cache. Only the first
run has cold JIT/heightmap state. Repeated runs are synchronous to keep the world
snapshot fixed; long runs can exceed the server's keepalive timeout. Reference
comparisons fail on any geometry/pixel hash mismatch.

The first CPU profile put ~14.5 s into meshing, ~0.1 s into rendering, and less
than 0.4 s into assets (including profiler overhead). Hotspots included block
lookup/allocation, model property matching, block-entity lookup and GC.

The focused changes in `perf/cold-meshing` are:

- A dense 18³ block lookup table plus exact-key overflow, replacing the per-hit
  Map hashing and position allocation. Initial same-snapshot comparison:
  ~14.3 s → ~12.2 s for a full meshing pass.
- Reuse of model variant selection for the same Java state ID, scoped to one
  collection. Geometry, tint, AO and lighting are still evaluated at each block.
- Verified empty-section skipping. Combined with the above, the same-snapshot
  meshing comparison was ~14.36 s → ~9.24–9.32 s, with identical geometry/pixels.

Final fresh-process comparison: three runs per revision, alternating optimised
and baseline; 640×360, view6, camera `(12.5, 63, -22.5)`, yaw π, pitch −0.15.
After 10 s settling, every run had 2,197 section entries, 1,473 non-empty meshes
and 2,428,912 triangles. All six frame hashes matched.

| Metric (median of 3) | `main` (`55540a4`) | `perf/cold-meshing` | Change |
| --- | --- | --- | --- |
| First PNG, assets + render + encode | 15,375 ms | 10,060 ms | **−34.6% (1.53×)** |
| First-frame meshing | 15,078 ms | 9,738 ms | −35.4% |
| RSS sampled after first capture/hash | 1,094 MiB | 708 MiB | −35.3% |

First-PNG ranges were 15,368–15,861 ms versus 10,029–10,095 ms. Raw records:
`bench/out/settled-{main,optimized}-{1,2,3}.json`. Baseline runs used the original
world adapter loaded from `55540a4`, with the same current dependencies, assets
and raster. Separate same-snapshot `--reference` checks establish geometry
equivalence; snapshots from different connections can differ in light packets
and chunk arrival order even with equal geometry counts.

Cached checks used 30 frames after 5 warmup, at the same location with 10 s
settling. Two batches (opposite revision order) gave these **batch mean** ranges:

| Cached PNG | Baseline | Optimised |
| --- | --- | --- |
| 640×360 view6 | 86.8 ms | 85.8–89.3 ms |
| 1280×720 view6 | 210.7–211.3 ms | 208.4–223.3 ms |

There is no consistent warmed-frame speedup: rasterisation and encoding are
unchanged, and the slower 720p batch did not repeat when revision order was
reversed. These changes target cold/new-section meshing. Warm reports are
`bench/out/{final,settled}-{main,optimized}-warm.txt`.

Validation includes `node test/cache.js` on Paper (day, repeat, night and live
block edit all `max=0`), `node test/empty-section.js` for negative coordinates and
air/cave_air/void_air edits, and a temporary server scene with 31 repeated block
configurations (rotated/multipart models, waterlogged blocks, liquids, cutouts
and blended blocks). That scene matched baseline geometry and all eight frames
(four camera directions × day/night) exactly. PNGs and raw reports are in
gitignored `bench/out/` and `test/out/`.

The cache test now yields between comparison groups and fails on a server kick:
otherwise a long sequence of synchronous cold renders could disconnect before
the edit command while still printing misleading successful comparisons.

Further candidates are cheaper block materialisation (the current world lookup
also fetches block entities and light that the mesher does not consume) and
precomputed model transforms. Both need separate profiling and equivalence
checks. Pre-mesh camera culling would affect cache population/prewarming and
needs a design decision; reducing view distance or visual detail was not used.

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
