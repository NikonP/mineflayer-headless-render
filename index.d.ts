import type { Bot } from 'mineflayer'

/** Raw RGBA frame with a z-buffer, as returned by renderFrame()/render(). */
export interface Frame {
  width: number
  height: number
  data: Uint8ClampedArray
  zbuffer: Float32Array
}

export type Format = 'png' | 'jpeg'

export interface CaptureOptions {
  /** Frame width in pixels. Default 640. */
  width?: number
  /** Frame height in pixels. Default 360. */
  height?: number
  /** Encoded format for captureFrame()/PovRenderer.capture(). Default 'png'. */
  format?: Format
  /** JPEG quality, 1-100. Default 90. */
  quality?: number
  /** Camera yaw in radians (0 looks north / -Z). Defaults to bot.entity.yaw. */
  yaw?: number
  /** Camera pitch in radians (positive is up). Defaults to bot.entity.pitch. */
  pitch?: number
  /** Vertical field of view in degrees. Default 70. */
  fov?: number
  /** Near clipping plane. Default 0.05. */
  near?: number
  /** Far clipping plane. Default 1000. */
  far?: number
  /** View distance in chunks. Default 6. */
  viewDistance?: number
  /** Override the world time (0-24000) used for sky/light. Defaults to the server clock. */
  timeOfDay?: number
  /** Java asset version for blocks/items. Defaults to bot.version. */
  assetsVersion?: string
  /** Java version to assume when bot.version is unavailable. Default '1.21.4'. */
  version?: string
  /** Skip the light bake (debug: shows unlit geometry). */
  noLight?: boolean
  /** Render the bot's own player model. Default false. */
  includeSelf?: boolean
  /** Filled with per-stage milliseconds when passed to renderFrame(). */
  timing?: Record<string, number>
  /** @internal Section mesh cache used by PovRenderer. */
  meshCache?: unknown
  /** @internal Reused lit-colour buffer. */
  lightScratch?: { buf: Float32Array | null }
}

export interface RendererOptions extends CaptureOptions {
  /** Chunks kept cached beyond the view box before eviction. Default 2. */
  evictMargin?: number
}

/**
 * Keeps section meshes between captures so a moving bot only re-meshes what
 * enters the view. Capture is synchronous and blocks the event loop.
 */
export class PovRenderer {
  constructor(opts?: RendererOptions)
  readonly viewDistance: number
  /** Hooks block/chunk invalidation and (by default) prewarms the view box. */
  attach(bot: Bot, opts?: { prewarm?: boolean }): this
  detach(): void
  /** Meshes the whole current view box. */
  prewarm(opts?: CaptureOptions): Frame
  /** Meshes missing sections up to budgetMs; returns how many were newly meshed. */
  tick(budgetMs?: number): number
  /** Raw RGBA frame (no encoding). */
  render(opts?: CaptureOptions): Frame
  /** Encoded frame (PNG by default), ready to write or send. */
  capture(opts?: CaptureOptions): Buffer
  /** Number of cached sections (including empty ones). */
  sectionCount(): number
  clear(): void
}

export interface ConfigureOptions {
  /** Path to a bedrock-samples checkout. Default: $BEDROCK_SAMPLES_PATH or ./bedrock-samples. */
  bedrockPath?: string
  /** Java version assumed when bot.version is unavailable. Default '1.21.4'. */
  defaultVersion?: string
}

/** Overrides asset location / default version. Call before the first render. */
export function configure(opts?: ConfigureOptions): void

/** Renders a frame without encoding. Synchronous. */
export function renderFrame(bot: Bot, opts?: CaptureOptions): Frame
/** Renders and encodes a frame. */
export function captureFrame(bot: Bot, opts?: CaptureOptions): Promise<Buffer>
export function frameToPng(frame: Frame): Buffer
export function frameToJpeg(frame: Frame, quality?: number): Buffer
/** Loads (and caches) the block atlas and blockstates for a version. */
export function getAssets(version: string, assetsVersion?: string): unknown

/** Java version the renderer targets when the bot does not expose one. */
export const DEFAULT_VERSION: string
