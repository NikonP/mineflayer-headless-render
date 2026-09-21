// Shared helper for the example/bench/test scripts: builds a mineflayer bot
// from CLI flags with environment fallbacks. Not part of the public API.
const mineflayer = require('mineflayer')

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

// Minimal `--flag value` / `--flag` parser.
function parseArgs(argv = process.argv.slice(2)) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue
    const key = argv[i].slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) args[key] = true
    else {
      args[key] = next
      i++
    }
  }
  return args
}

// CLI flag > environment variable > default.
function pick(args, flag, env, fallback) {
  if (args[flag] !== undefined && args[flag] !== true) return args[flag]
  if (env && process.env[env] !== undefined && process.env[env] !== '') {
    return process.env[env]
  }
  return fallback
}

function int(args, flag, env, fallback) {
  return parseInt(pick(args, flag, env, String(fallback)), 10)
}

// Connection details. Defaults are placeholders — point them at your server.
function serverConfig(args) {
  return {
    host: pick(args, 'host', 'MC_HOST', 'localhost'),
    port: int(args, 'port', 'MC_PORT', 25565),
    username: pick(args, 'username', 'MC_USERNAME', 'POVBot'),
    version: pick(args, 'version', 'MC_VERSION', '1.21.4'),
    auth: pick(args, 'auth', 'MC_AUTH', 'offline')
  }
}

function createBot(args = parseArgs(), extra = {}) {
  return mineflayer.createBot({ ...serverConfig(args), ...extra })
}

module.exports = { wait, parseArgs, pick, int, serverConfig, createBot }
