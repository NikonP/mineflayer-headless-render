// Software rasterizer: maps view-space vertices to clip space and rasterizes
// indexed triangles into an RGBA buffer with a z-buffer. Handles vertex
// colors (tints/AO baked by meshing) and affine texture mapping with alpha.

// Creates a 4x4 view-projection matrix for mineflayer's camera convention
// (see mineflayer/lib/conversions.js): yaw = PI - notchianYaw, so mineflayer
// yaw=0 looks north (-Z); mineflayer pitch is positive UP (opposite of the
// notchian convention). World axes: +X east, +Z south.
function makeViewProjection(
  eyeX,
  eyeY,
  eyeZ,
  yawRad,
  pitchRad,
  fovDeg,
  aspect,
  near,
  far
) {
  const yaw = yawRad
  const pitch = pitchRad

  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)

  // Forward vector in mineflayer convention
  const fx = -sy * cp
  const fy = sp
  const fz = -cy * cp
  // Right vector: right = cross(forward, world-up) = (cos yaw, 0, -sin yaw)
  // Check: yaw=0 (north) -> right = east(+X) ✓
  const rx = cy
  const ry = 0
  const rz = -sy
  // Up = right x forward
  const ux = ry * fz - rz * fy
  const uy = rz * fx - rx * fz
  const uz = rx * fy - ry * fx

  // View matrix rows: [right; up; -forward] with translation
  const r00 = rx
  const r01 = ry
  const r02 = rz
  const r10 = ux
  const r11 = uy
  const r12 = uz
  const r20 = -fx
  const r21 = -fy
  const r22 = -fz

  const t0 = -(r00 * eyeX + r01 * eyeY + r02 * eyeZ)
  const t1 = -(r10 * eyeX + r11 * eyeY + r12 * eyeZ)
  const t2 = -(r20 * eyeX + r21 * eyeY + r22 * eyeZ)

  // Perspective projection
  const f = 1 / Math.tan((fovDeg * Math.PI) / 360)
  const p00 = f / aspect
  const p11 = f
  const p22 = (far + near) / (near - far)
  const p32 = (2 * far * near) / (near - far)
  const p23 = -1

  // Combined VP (projection applied after view). Stored row-major as 16
  // floats m[row*4+col].
  const m = new Float32Array(16)
  // Row 0
  m[0] = p00 * r00
  m[1] = p00 * r01
  m[2] = p00 * r02
  m[3] = p00 * t0
  // Row 1
  m[4] = p11 * r10
  m[5] = p11 * r11
  m[6] = p11 * r12
  m[7] = p11 * t1
  // Row 2
  m[8] = p22 * r20
  m[9] = p22 * r21
  m[10] = p22 * r22
  m[11] = p22 * t2 + p32
  // Row 3
  m[12] = p23 * r20
  m[13] = p23 * r21
  m[14] = p23 * r22
  m[15] = p23 * t2
  return m
}

// Rasterize one indexed triangle mesh into the framebuffer.
// positions: Float32Array xyz, uvs: Float32Array, colors: Float32Array rgb,
// indices: Uint32Array, offset: world-space origin of the mesh.
// atlas: { data: Uint8ClampedArray, width, height } (RGBA).
function renderMesh(frame, vp, mesh, atlas, opts = {}) {
  const { positions, uvs } = mesh
  // The capture pre-splits section indices into opaque/translucent lists.
  const indices = opts.indices || mesh.indices
  // opts.colors overrides the mesh's own colours (used to pass lit copies of
  // cached section meshes without mutating the cache).
  const colors = opts.colors || mesh.colors
  const ox = mesh.sx
  const oy = mesh.sy
  const oz = mesh.sz

  const nVerts = positions.length / 3
  let clip = frame._clip
  if (clip.length < nVerts * 4) {
    frame._clip = clip = new Float32Array(nVerts * 4)
  }

  const width = frame.width
  const height = frame.height
  const cx = width / 2
  const cy = height / 2

  // Transform all vertices
  for (let i = 0; i < nVerts; i++) {
    const x = positions[i * 3] + ox
    const y = positions[i * 3 + 1] + oy
    const z = positions[i * 3 + 2] + oz
    const m = vp
    const cxr = m[0] * x + m[1] * y + m[2] * z + m[3]
    const cyr = m[4] * x + m[5] * y + m[6] * z + m[7]
    const cw = m[12] * x + m[13] * y + m[14] * z + m[15]
    clip[i * 4] = cxr
    clip[i * 4 + 1] = cyr
    // clip z (m[8..11] row) and clip w (m[12..15] row) stored GL-style:
    // slot 2 = clip z, slot 3 = clip w (same layout as renderSolidMesh)
    clip[i * 4 + 2] = m[8] * x + m[9] * y + m[10] * z + m[11]
    clip[i * 4 + 3] = cw
  }

  const zbuf = frame.zbuffer
  const pix = frame.data
  const atlasW = atlas.width
  const atlasH = atlas.height
  const atlasData = atlas.data
  const backfaceCull = opts.backfaceCull !== false
  // Uniform brightness multiplier (used for entity lighting; world lighting is
  // passed in per-vertex via opts.colors).
  const brightness = opts.brightness !== undefined ? opts.brightness : 1
  // Two-pass translucency: `opts.indices` already selects the opaque or
  // blended triangles (see worldRender.splitIndices); `pass` only controls how
  // they are shaded. 'all' is the single transparent-cutout pass used by
  // entity meshes.
  const pass = opts.pass || 'all'

  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t]
    const i1 = indices[t + 1]
    const i2 = indices[t + 2]

    const w0 = clip[i0 * 4 + 3]
    const w1 = clip[i1 * 4 + 3]
    const w2 = clip[i2 * 4 + 3]
    // Behind near plane or degenerate w — skip
    if (w0 < 0.01 || w1 < 0.01 || w2 < 0.01) continue

    const x0 = (clip[i0 * 4] / w0) * cx + cx
    const y0 = (-clip[i0 * 4 + 1] / w0) * cy + cy
    const x1 = (clip[i1 * 4] / w1) * cx + cx
    const y1 = (-clip[i1 * 4 + 1] / w1) * cy + cy
    const x2 = (clip[i2 * 4] / w2) * cx + cx
    const y2 = (-clip[i2 * 4 + 1] / w2) * cy + cy

    // Signed area for culling and early rejection
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
    if (area === 0) continue
    if (backfaceCull && area > 0) continue

    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)))
    const maxX = Math.min(width - 1, Math.ceil(Math.max(x0, x1, x2)))
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)))
    const maxY = Math.min(height - 1, Math.ceil(Math.max(y0, y1, y2)))
    if (minX > maxX || minY > maxY) continue

    const invArea = 1 / area

    // Per-vertex attributes. UVs are stored pre-divided by w (perspective-
    // correct interpolation: linearly interpolate u/w and 1/w in screen space,
    // then divide per pixel — same as GPU rasterizers).
    const invW0 = 1 / w0
    const invW1 = 1 / w1
    const invW2 = 1 / w2
    const u0 = uvs[i0 * 2] * invW0
    const v0 = uvs[i0 * 2 + 1] * invW0
    const u1 = uvs[i1 * 2] * invW1
    const v1 = uvs[i1 * 2 + 1] * invW1
    const u2 = uvs[i2 * 2] * invW2
    const v2 = uvs[i2 * 2 + 1] * invW2
    const c0r = colors[i0 * 3]
    const c0g = colors[i0 * 3 + 1]
    const c0b = colors[i0 * 3 + 2]
    const c1r = colors[i1 * 3]
    const c1g = colors[i1 * 3 + 1]
    const c1b = colors[i1 * 3 + 2]
    const c2r = colors[i2 * 3]
    const c2g = colors[i2 * 3 + 1]
    const c2b = colors[i2 * 3 + 2]
    const z0 = clip[i0 * 4 + 2] / w0
    const z1 = clip[i1 * 4 + 2] / w1
    const z2 = clip[i2 * 4 + 2] / w2

    for (let py = minY; py <= maxY; py++) {
      const py01 = py + 0.5
      for (let px = minX; px <= maxX; px++) {
        const px01 = px + 0.5
        // Barycentric weights — edge(p1,p2) → weight of v0, edge(p2,p0) →
        // weight of v1, edge(p0,p1) → weight of v2
        const l0 = ((x2 - x1) * (py01 - y1) - (px01 - x1) * (y2 - y1)) * invArea
        const l1 = ((x0 - x2) * (py01 - y2) - (px01 - x2) * (y0 - y2)) * invArea
        if (l0 < 0 || l1 < 0) continue
        const l2 = 1 - l0 - l1
        if (l2 < 0) continue

        // Interpolate z
        const z = l0 * z0 + l1 * z1 + l2 * z2
        const zi = py * width + px
        if (z >= zbuf[zi]) continue

        // Perspective-correct UVs
        const f0 = l0 * invW0
        const f1 = l1 * invW1
        const f2 = l2 * invW2
        const invW = f0 + f1 + f2
        const u = ((l0 * u0 + l1 * u1 + l2 * u2) / invW) * atlasW
        const v = ((l0 * v0 + l1 * v1 + l2 * v2) / invW) * atlasH
        let tu = u | 0
        let tv = v | 0
        if (tu < 0) tu = 0
        else if (tu >= atlasW) tu = atlasW - 1
        if (tv < 0) tv = 0
        else if (tv >= atlasH) tv = atlasH - 1
        const ti = (tv * atlasW + tu) * 4
        const a = atlasData[ti + 3] / 255
        // Alpha test BEFORE depth write: fully transparent texels must not
        // occlude geometry behind them (they don't paint, soWriting z here
        // would make later terrain fail the depth test and leave sky color)
        if (a < 0.1) continue

        const cr = (l0 * c0r + l1 * c1r + l2 * c2r) * brightness
        const cg = (l0 * c0g + l1 * c1g + l2 * c2g) * brightness
        const cb = (l0 * c0b + l1 * c1b + l2 * c2b) * brightness

        const di = zi * 4

        // Blended pass: depth-tested against the opaque pass, but deliberately
        // does not write depth, so nearer translucent faces blend over farther
        // ones instead of hiding them.
        if (pass === 'translucent') {
          if (a >= 0.999) {
            pix[di] = atlasData[ti] * cr
            pix[di + 1] = atlasData[ti + 1] * cg
            pix[di + 2] = atlasData[ti + 2] * cb
          } else {
            pix[di] = atlasData[ti] * cr * a + pix[di] * (1 - a)
            pix[di + 1] = atlasData[ti + 1] * cg * a + pix[di + 1] * (1 - a)
            pix[di + 2] = atlasData[ti + 2] * cb * a + pix[di + 2] * (1 - a)
          }
          pix[di + 3] = 255
          continue
        }

        zbuf[zi] = z
        if (a >= 0.999 || !opts.alphaBlend) {
          pix[di] = atlasData[ti] * cr
          pix[di + 1] = atlasData[ti + 1] * cg
          pix[di + 2] = atlasData[ti + 2] * cb
          pix[di + 3] = 255
        } else {
          pix[di] = atlasData[ti] * cr * a + pix[di] * (1 - a)
          pix[di + 1] = atlasData[ti + 1] * cg * a + pix[di + 1] * (1 - a)
          pix[di + 2] = atlasData[ti + 2] * cb * a + pix[di + 2] * (1 - a)
          pix[di + 3] = 255
        }
      }
    }
  }
}

// Solid color triangle list without atlas (used for entities MVP)
function renderSolidMesh(
  frame,
  vp,
  positions,
  indices,
  r,
  g,
  b,
  brightness = 1
) {
  const width = frame.width
  const height = frame.height
  const cx = width / 2
  const cy = height / 2
  const nVerts = positions.length / 3
  const clip = new Float32Array(nVerts * 4)

  for (let i = 0; i < nVerts; i++) {
    const x = positions[i * 3]
    const y = positions[i * 3 + 1]
    const z = positions[i * 3 + 2]
    clip[i * 4] = vp[0] * x + vp[1] * y + vp[2] * z + vp[3]
    clip[i * 4 + 1] = vp[4] * x + vp[5] * y + vp[6] * z + vp[7]
    clip[i * 4 + 2] = vp[8] * x + vp[9] * y + vp[10] * z + vp[11]
    clip[i * 4 + 3] = vp[12] * x + vp[13] * y + vp[14] * z + vp[15]
  }

  const zbuf = frame.zbuffer
  const pix = frame.data

  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t]
    const i1 = indices[t + 1]
    const i2 = indices[t + 2]
    const w0 = clip[i0 * 4 + 3]
    const w1 = clip[i1 * 4 + 3]
    const w2 = clip[i2 * 4 + 3]
    if (w0 < 0.01 || w1 < 0.01 || w2 < 0.01) continue

    const x0 = (clip[i0 * 4] / w0) * cx + cx
    const y0 = (-clip[i0 * 4 + 1] / w0) * cy + cy
    const x1 = (clip[i1 * 4] / w1) * cx + cx
    const y1 = (-clip[i1 * 4 + 1] / w1) * cy + cy
    const x2 = (clip[i2 * 4] / w2) * cx + cx
    const y2 = (-clip[i2 * 4 + 1] / w2) * cy + cy

    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
    if (area >= 0) continue // cull

    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)))
    const maxX = Math.min(width - 1, Math.ceil(Math.max(x0, x1, x2)))
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)))
    const maxY = Math.min(height - 1, Math.ceil(Math.max(y0, y1, y2)))
    if (minX > maxX || minY > maxY) continue
    const invArea = 1 / area

    const z0 = clip[i0 * 4 + 2] / w0
    const z1 = clip[i1 * 4 + 2] / w1
    const z2 = clip[i2 * 4 + 2] / w2

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const px01 = px + 0.5
        const py01 = py + 0.5
        const l0 = ((x1 - x0) * (py01 - y0) - (px01 - x0) * (y1 - y0)) * invArea
        const l1 = ((x2 - x1) * (py01 - y1) - (px01 - x1) * (y2 - y1)) * invArea
        if (l0 < 0 || l1 < 0) continue
        const l2 = 1 - l0 - l1
        if (l2 < 0) continue
        const z = l0 * z0 + l1 * z1 + l2 * z2
        const zi = py * width + px
        if (z >= zbuf[zi]) continue
        zbuf[zi] = z
        const di = zi * 4
        pix[di] = r * brightness
        pix[di + 1] = g * brightness
        pix[di + 2] = b * brightness
        pix[di + 3] = 255
      }
    }
  }
}

// World-space clip planes from a row-major view-projection matrix. A point is
// inside when n·p + d >= 0 for every plane. Mirrors the conditions renderMesh
// actually applies: x/y within ±w (a triangle fully off-screen on one side is
// dropped by the screen-bbox clamp) and w >= 0.01 (behind the near plane is
// skipped). renderMesh has no far-plane test, so none is extracted here.
function frustumPlanes(vp) {
  const r0x = vp[0]
  const r0y = vp[1]
  const r0z = vp[2]
  const r0w = vp[3]
  const r1x = vp[4]
  const r1y = vp[5]
  const r1z = vp[6]
  const r1w = vp[7]
  const r3x = vp[12]
  const r3y = vp[13]
  const r3z = vp[14]
  const r3w = vp[15]
  return [
    [r3x + r0x, r3y + r0y, r3z + r0z, r3w + r0w], // x >= -w
    [r3x - r0x, r3y - r0y, r3z - r0z, r3w - r0w], // x <= w
    [r3x + r1x, r3y + r1y, r3z + r1z, r3w + r1w], // y >= -w
    [r3x - r1x, r3y - r1y, r3z - r1z, r3w - r1w], // y <= w
    [r3x, r3y, r3z, r3w - 0.01] // w >= 0.01
  ]
}

// True when an axis-aligned box is at least partly inside the frustum. The
// p-vertex (the corner farthest along each plane normal) decides: if even that
// corner is behind a plane, the whole box is outside.
function aabbInFrustum(planes, minX, minY, minZ, maxX, maxY, maxZ) {
  for (let i = 0; i < planes.length; i++) {
    const p = planes[i]
    const x = p[0] >= 0 ? maxX : minX
    const y = p[1] >= 0 ? maxY : minY
    const z = p[2] >= 0 ? maxZ : minZ
    if (p[0] * x + p[1] * y + p[2] * z + p[3] < 0) return false
  }
  return true
}

module.exports = {
  makeViewProjection,
  renderMesh,
  renderSolidMesh,
  frustumPlanes,
  aabbInFrustum
}
