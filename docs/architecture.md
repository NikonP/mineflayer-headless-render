# Architecture

```
bot.world (prismarine-world / WorldSync)
        │
        │  getSectionGeometry()  (vendored prismarine-viewer)
        ▼
   section meshes ──► MeshCache            world space, camera-independent,
        │            (invalidated on       reused between frames
        │             block/chunk change)
        │
        │  per-quad (sky, block) computed at mesh time
        ▼
   Heightmap ──► repairs bogus sky-light zeros
        │
        ▼
   renderFrame(): bake light into scratch → rasterise terrain
                  → entities / item billboards → frame (RGBA + z-buffer)
        │
        ▼
   frameToPng() / frameToJpeg()
```

## Modules (`src/`)

| File | Role |
| --- | --- |
| `capture.js` | `renderFrame` / `captureFrame`, asset loading, per-stage timing. |
| `renderer.js` | `PovRenderer` — on-demand capture for a live bot. |
| `worldRender.js` | `MeshCache` + `renderWorld`; meshes sections around the bot. |
| `heightmap.js` | Topmost solid block per column, used to correct sky light. |
| `light.js` | Day/night curves, sky colour, light sampling/baking, brightness. |
| `raster.js` | `makeViewProjection`, `renderMesh`, `renderSolidMesh`, frustum planes / AABB test. |
| `frame.js` | Framebuffer, z-buffer and sky background. |
| `camera.js` | First-person camera derived from bot state. |
| `entities.js` | Entity dispatch: Bedrock model, item billboard, or fallback box. |
| `entityModels.js` | Bedrock geometry/entity/texture loader → indexed meshes. |
| `items.js` | Dropped-item sprite lookup and billboard mesh. |
| `atlas.js` | Java block texture atlas (canvas-free reimplementation). |
| `tga.js` | TGA decoder for Bedrock entity textures. |
| `config.js` | Asset path and default Java version. |
| `vendor/prismarine-viewer/` | Vendored `getSectionGeometry` and `prepareBlocksStates`. |

## Meshing

Sections are meshed with prismarine-viewer's `getSectionGeometry` (vendored).
`makeViewWorld()` adapts `bot.world` (a mineflayer `WorldSync`) to the interface
that mesher expects: it floors block positions, computes `isCube` (used for face
culling) and attaches a biome object (used for grass/foliage tints). The mesher
queries each block several times, so `makeViewWorld()` memoises lookups for the
duration of one section; the key is the block's offset from the section origin
packed into a single integer (with a string fallback for the rare out-of-range
query), which is cheaper than the string keys it replaced.

`renderWorld()` rebuilds every section from scratch — deliberately uncached, so
test stands that build a scene and then capture always see fresh geometry.

`MeshCache` keeps section geometry between frames. Keys are
`` `${chunkX},${sectionY},${chunkZ}` `` where `sectionY` is the section **origin**
(a multiple of 16, can be negative). Geometry is in world space, so moving the
camera costs nothing; only sections entering/leaving the view box are meshed or
evicted. A block change invalidates the section plus its 26 neighbours, because
face culling and ambient occlusion read across section borders. Each mesh also
carries the world-space AABB computed at mesh time, which `renderFrame()` uses to
frustum-cull whole sections before the light bake.

## Light

Light is data-driven: `WorldSync.getSkyLight` / `getBlockLight`, shaped by a
day/night curve from the world time.

- The per-quad light is sampled **at mesh time** and stored on the mesh as one
  packed byte per quad (`sky << 4 | block`). Per-frame shading is therefore just
  a brightness table lookup, not world sampling.
- Light is never multiplied into the cached vertex colours. It is baked into a
  reusable scratch buffer each frame, otherwise repeated frames would compound
  the darkening and freeze day/night.
- Mesh geometry is emitted as **quads of four vertices** that share a normal and
  a neighbouring air block, so one sample covers a face.

### Heightmap correction

Some servers report sky light `0` for blocks that are plainly under open sky
(the local test server does this for a large share of the surface). A per-column
heightmap (highest solid block) distinguishes a real roof from a bad value: if
the server says `sky = 0` but the sample sits above the column's highest solid
block, it is treated as open sky. Leaves do not count as a roof, since vanilla
only partially blocks light through them. The heightmap is computed lazily,
cached, and invalidated on block changes and chunk unloads.

## Entities

- Mobs and the player use original **Bedrock** geometry, entity definitions and
  textures from `bedrock-samples`. Only the static bind pose is applied. Two
  rotation fields mean two things: `bind_pose_rotation` reorients a bone's own
  cubes only (a quadruped's body carries `[90,0,0]` and its head/legs are
  authored already placed for it), while `rotation` is a rest orientation whose
  descendants are authored relative to it, so it propagates down the chain (the
  horse's neck tilts 30° and its head/muzzle follow). A couple of models are
  only valid after an always-on base-pose animation that this renderer does not
  run; `staticPoseOffset` nudges those bones (the enderman's head). Derived
  geometries (`geometry.child:geometry.parent`) inherit the parent's bones, so a
  model that only lists its additions (the witch hat on top of the villager)
  renders with a body. Variant-only models (tropical fish, horse, cat, …) get
  one deterministic variant.
- Dropped items have no Bedrock model; they render as a camera-facing sprite of
  the item texture from `minecraft-assets`.
- Anything without a model/texture pair falls back to a deterministic coloured
  box, so the frame never has invisible entities.

## Rasteriser

`createFrame()` allocates an RGBA buffer, a z-buffer and a sky background.
`makeViewProjection()` builds the camera matrix; `renderMesh()` draws textured,
z-buffered, perspective-correct triangles with alpha cutout. `renderSolidMesh()`
draws untextured triangles for the fallback boxes.

## Capture is synchronous

`renderFrame()` and `PovRenderer.capture()` block the event loop. Keep them off
hot paths. `PovRenderer.tick(ms)` exists to spread meshing across bot ticks so a
capture after moving into new chunks doesn't pay for everything at once.
