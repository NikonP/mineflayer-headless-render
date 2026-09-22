// Runtime configuration.
//
// The Bedrock asset pack (bedrock-samples) is Mojang's, not ours, so it is never
// bundled: point the renderer at a checkout with BEDROCK_SAMPLES_PATH, via
// configure({ bedrockPath }), or drop it next to the package as `bedrock-samples`
// (the git submodule used in development).
const fs = require('fs')
const path = require('path')

// Java version the renderer is built and tested against. Used as the fallback
// when bot.version is not available yet.
const DEFAULT_VERSION = '1.21.4'

function defaultBedrockPath() {
  if (process.env.BEDROCK_SAMPLES_PATH) {
    return path.resolve(process.env.BEDROCK_SAMPLES_PATH)
  }
  // Prefer the checkout next to the package (the dev submodule); otherwise look
  // in the consumer's project root, which is where the setup command drops it.
  const beside = path.join(__dirname, '..', 'bedrock-samples')
  if (fs.existsSync(beside)) return beside
  const cwd = path.join(process.cwd(), 'bedrock-samples')
  return fs.existsSync(cwd) ? cwd : beside
}

let bedrockPath = defaultBedrockPath()
let defaultVersion = DEFAULT_VERSION

function getBedrockPath() {
  return bedrockPath
}

function getDefaultVersion() {
  return defaultVersion
}

// The pack is not shipped (see the file header), so a fresh npm install has no
// assets until they are fetched. Report that once, clearly: the model indexer
// swallows unreadable directories on purpose, so without this check a missing
// pack degrades into "mobs silently render as nothing".
let bedrockChecked = null

function assertBedrockReady() {
  const root = getBedrockPath()
  if (bedrockChecked === root) return
  const pack = path.join(root, 'resource_pack')
  if (
    !fs.existsSync(path.join(pack, 'models')) ||
    !fs.existsSync(path.join(pack, 'entity'))
  ) {
    const err = new Error(
      `bedrock-samples not found at ${root}.\n` +
        'Fetch it with:  npx mineflayer-headless-render-setup ./bedrock-samples\n' +
        'Or point the renderer at an existing checkout: BEDROCK_SAMPLES_PATH=/abs/path ' +
        'or configure({ bedrockPath }).'
    )
    err.code = 'BEDROCK_ASSETS_MISSING'
    throw err
  }
  bedrockChecked = root
}

// configure({ bedrockPath, defaultVersion })
function configure(opts = {}) {
  if (opts.bedrockPath !== undefined) {
    bedrockPath = opts.bedrockPath
      ? path.resolve(opts.bedrockPath)
      : defaultBedrockPath()
    // Models were resolved against the previous root; drop them.
    bedrockChecked = null
    require('./entityModels').clearAssetCaches()
  }
  if (opts.defaultVersion) defaultVersion = opts.defaultVersion
  return module.exports
}

module.exports = {
  configure,
  getBedrockPath,
  getDefaultVersion,
  assertBedrockReady,
  DEFAULT_VERSION
}
