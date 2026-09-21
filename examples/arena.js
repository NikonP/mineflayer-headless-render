// Arena scene: a palette of blocks (floor + wall + 3D shapes) with rows of mobs
// and dropped items in front, plus a second bot as the player entity. Captures
// a few angles, then cleans up. Mobs are summoned facing the camera.
//
// Needs a creative server with commands enabled (uses /fill, /summon, /tp).
//   MC_HOST=my.server MC_PORT=25565 node examples/arena.js
const fs = require('fs')
const path = require('path')
const { captureFrame } = require('..')
const {
  wait,
  parseArgs,
  serverConfig,
  createBot
} = require('../scripts/dev-bot')

const FLOOR = [
  'grass_block',
  'dirt',
  'stone',
  'cobblestone',
  'oak_planks',
  'spruce_planks',
  'sandstone',
  'bricks',
  'stone_bricks',
  'sand',
  'gravel',
  'red_wool',
  'blue_wool',
  'lime_wool',
  'glass',
  'bookshelf',
  'mossy_cobblestone',
  'white_concrete',
  'terracotta',
  'netherrack',
  'andesite',
  'diorite',
  'deepslate',
  'glowstone'
]

const WALL = [
  'oak_log',
  'birch_log',
  'acacia_planks',
  'jungle_planks',
  'dark_oak_planks',
  'cobblestone',
  'mossy_stone_bricks',
  'cracked_stone_bricks',
  'chiseled_stone_bricks',
  'bricks',
  'sandstone',
  'red_sandstone',
  'prismarine',
  'dark_prismarine',
  'nether_bricks',
  'red_nether_bricks',
  'quartz_block',
  'purpur_block',
  'end_stone_bricks',
  'blackstone',
  'basalt',
  'smooth_stone',
  'iron_block',
  'sea_lantern'
]

const SHAPES = [
  'oak_stairs',
  'oak_slab',
  'oak_fence',
  'glass_pane',
  'torch',
  'cobblestone_wall',
  'iron_bars',
  'oak_trapdoor'
]

const ROW_A = [
  'zombie',
  'skeleton',
  'creeper',
  'cow',
  'sheep',
  'pig',
  'chicken',
  'spider',
  'enderman',
  'wolf',
  'villager',
  'iron_golem'
]
const ROW_B = [
  'cat',
  'fox',
  'rabbit',
  'parrot',
  'horse',
  'axolotl',
  'frog',
  'shulker',
  'goat',
  'camel',
  'armadillo',
  'mooshroom'
]

const ITEMS = [
  'diamond',
  'emerald',
  'gold_ingot',
  'iron_ingot',
  'redstone',
  'coal',
  'apple',
  'bread',
  'stick',
  'torch',
  'oak_planks',
  'cobblestone'
]

// The camera sits at -Z looking +Z, so mobs face -Z (Minecraft yaw 180).
const FACE_CAMERA = 'Rotation:[180f,0f]'

async function main() {
  const args = parseArgs()
  const cfg = serverConfig(args)
  const bot = createBot(args)
  const player = createBot(args, { username: cfg.username + 'Guest' })
  const outDir = path.join(__dirname, 'out')
  const timer = setTimeout(() => {
    console.error('timed out')
    process.exit(1)
  }, 240000)

  bot.on('error', err => {
    clearTimeout(timer)
    console.error('bot error:', err.message)
    process.exit(1)
  })

  bot.once('spawn', async () => {
    await wait(2500)
    const p = bot.entity.position.floored()
    console.log('spawn at', p.toString())
    const x0 = p.x - 11
    const by = p.y
    const z0 = p.z + 1

    const cmd = async c => {
      bot.chat(c)
      await wait(120)
    }
    const set = c => cmd('/setblock ' + c)
    const fill = c => cmd('/fill ' + c)

    // Stop natural spawns so the frame only shows our test subjects.
    bot.chat('/gamerule doMobSpawning false')
    await wait(300)
    bot.chat('/kill @e[type=!minecraft:player]')
    await wait(600)

    for (let i = 0; i < FLOOR.length; i++) {
      const x = x0 + i
      await fill(
        `${x} ${by - 1} ${z0} ${x} ${by - 1} ${z0 + 7} minecraft:${FLOOR[i]}`
      )
    }
    for (let i = 0; i < WALL.length; i++) {
      const x = x0 + i
      await fill(
        `${x} ${by} ${z0 + 9} ${x} ${by + 2} ${z0 + 9} minecraft:${WALL[i]}`
      )
    }
    for (let i = 0; i < SHAPES.length; i++) {
      await set(`${x0 + 2 + i * 3} ${by + 3} ${z0 + 9} minecraft:${SHAPES[i]}`)
    }

    bot.chat('/kill @e[type=!minecraft:player]')
    await wait(800)

    fs.mkdirSync(outDir, { recursive: true })
    const shoot = async s => {
      await cmd(`/tp ${cfg.username} ${s.x} ${s.y} ${s.z}`)
      await wait(900)
      const buf = await captureFrame(bot, {
        width: 1280,
        height: 720,
        yaw: s.yaw,
        pitch: (s.pitch * Math.PI) / 180,
        viewDistance: 6
      })
      fs.writeFileSync(path.join(outDir, 'arena_' + s.name + '.png'), buf)
      console.log('saved', s.name)
    }

    // Clean block-palette shot, before any mobs are summoned.
    await shoot({
      name: 'blocks',
      x: x0 + 11,
      y: by + 3,
      z: z0 - 6,
      yaw: Math.PI,
      pitch: 3
    })

    // Mobs: front row closer, back row staggered, both facing the camera.
    for (let i = 0; i < ROW_A.length; i++) {
      await cmd(
        `/summon minecraft:${ROW_A[i]} ${x0 + i * 2 + 0.5} ${by} ${z0 + 4.5} {NoAI:1,${FACE_CAMERA}}`
      )
    }
    for (let i = 0; i < ROW_B.length; i++) {
      await cmd(
        `/summon minecraft:${ROW_B[i]} ${x0 + i * 2 + 1.5} ${by} ${z0 + 6.5} {NoAI:1,${FACE_CAMERA}}`
      )
    }
    // Dropped items on the floor in front of the mobs.
    for (let i = 0; i < ITEMS.length; i++) {
      await cmd(
        `/summon minecraft:item ${x0 + i * 2 + 0.5} ${by + 0.1} ${z0 + 2} {Item:{id:"minecraft:${ITEMS[i]}",count:1},${FACE_CAMERA}}`
      )
    }
    // two fully hidden behind the wall (occlusion check)
    await cmd(
      `/summon minecraft:zombie ${x0 + 5.5} ${by} ${z0 + 11.5} {NoAI:1,${FACE_CAMERA}}`
    )
    await cmd(
      `/summon minecraft:cow ${x0 + 15.5} ${by} ${z0 + 11.5} {NoAI:1,${FACE_CAMERA}}`
    )

    // Player bot into the scene, facing the camera too.
    await cmd(`/tp ${cfg.username + 'Guest'} ${x0 - 2} ${by} ${z0 + 4.5}`)
    player.look(0, 0)
    await wait(800)

    console.log(
      'entities seen:',
      Object.values(bot.entities)
        .map(e => e.name)
        .join(', ')
    )

    await shoot({
      name: 'overview',
      x: x0 + 20,
      y: by + 5,
      z: z0 - 4,
      yaw: Math.PI * 0.75,
      pitch: -12
    })
    await shoot({
      name: 'mobs',
      x: x0 + 11,
      y: by + 2,
      z: z0 - 1,
      yaw: Math.PI,
      pitch: -4
    })
    await shoot({
      name: 'items',
      x: x0 + 11,
      y: by + 2.4,
      z: z0 - 3,
      yaw: Math.PI,
      pitch: -24
    })

    // cleanup
    bot.chat('/kill @e[type=!minecraft:player]')
    await wait(500)
    for (let i = 0; i < WALL.length; i++)
      await fill(
        `${x0 + i} ${by} ${z0 + 9} ${x0 + i} ${by + 2} ${z0 + 9} minecraft:air`
      )
    for (let i = 0; i < SHAPES.length; i++)
      await set(`${x0 + 2 + i * 3} ${by + 3} ${z0 + 9} minecraft:air`)
    for (let i = 0; i < FLOOR.length; i++)
      await fill(
        `${x0 + i} ${by - 1} ${z0} ${x0 + i} ${by - 1} ${z0 + 7} minecraft:grass_block`
      )
    console.log('cleaned')

    player.quit()
    bot.quit()
    setTimeout(() => process.exit(0), 500)
  })
}

main()
