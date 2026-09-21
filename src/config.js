// Runtime configuration.
//
// The Bedrock asset pack (bedrock-samples) is Mojang's, not ours, so it is never
// bundled: point the renderer at a checkout with BEDROCK_SAMPLES_PATH, via
// configure({ bedrockPath }), or drop it next to the package as `bedrock-samples`
// (the git submodule used in development).
const path = require('path')

// Java version the renderer is built and tested against. Used as the fallback
// when bot.version is not available yet.
const DEFAULT_VERSION = '1.21.4'

function defaultBedrockPath () {
  if (process.env.BEDROCK_SAMPLES_PATH) return path.resolve(process.env.BEDROCK_SAMPLES_PATH)
  return path.join(__dirname, '..', 'bedrock-samples')
}

let bedrockPath = defaultBedrockPath()
let defaultVersion = DEFAULT_VERSION

function getBedrockPath () {
  return bedrockPath
}

function getDefaultVersion () {
  return defaultVersion
}

// configure({ bedrockPath, defaultVersion })
function configure (opts = {}) {
  if (opts.bedrockPath !== undefined) {
    bedrockPath = opts.bedrockPath ? path.resolve(opts.bedrockPath) : defaultBedrockPath()
    // Models were resolved against the previous root; drop them.
    require('./entityModels').clearAssetCaches()
  }
  if (opts.defaultVersion) defaultVersion = opts.defaultVersion
  return module.exports
}

module.exports = { configure, getBedrockPath, getDefaultVersion, DEFAULT_VERSION }
