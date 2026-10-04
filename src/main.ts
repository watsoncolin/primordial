import GUI from 'lil-gui'
import { type Steer, newBrain, think } from './ai'
import { WORLD, tuning } from './config'
import { Dust } from './dust'
import { Effects } from './effects'
import { Fluid } from './fluid'
import { Input } from './input'
import { clamp, rand, wrapCoord, wrapDelta } from './math'
import { type Kind, Nutrients } from './nutrients'
import { NUTRIENT_RGB, Protocell, type Species } from './protocell'
import { type Vent, placeVents } from './vents'
import { View } from './view'
import './style.css'

const STEP = 1 / 60
const SUBSTEPS = 3
/** Biomass gained per particle absorbed. Lipids build membrane, so they're what really grows you. */
const NUTRITION: Record<Kind, number> = { organic: 0.004, lipid: 0.05, mineral: 0.01 }
const POPULATION_CHECK = 2
/** Other cells get less out of each particle, so tiny ones stay tiny long enough to be prey. */
const NPC_GROWTH = 0.35

const canvas = document.querySelector<HTMLCanvasElement>('#game')!
const ctx = canvas.getContext('2d')!
const view = new View()
const input = new Input(canvas)

let fluid: Fluid
let player: Protocell
let cells: Protocell[]
let nutrients: Nutrients
let vents: Vent[]
let dust: Dust
let effects: Effects
let eaten: Record<Kind, number>
let cellsEaten = 0
let time = 0
let startTime = 0
let deathTime: number | null = null
let populationTimer = 0
const npcSteer: Steer = { x: 0, y: 0, mag: 0 }

function reset() {
  fluid = new Fluid()
  vents = placeVents()
  player = new Protocell(WORLD / 2, WORLD / 2, 1, 'player')
  cells = [player]
  nutrients = new Nutrients()
  nutrients.seed(player.cx, player.cy, vents)
  dust = new Dust()
  effects = new Effects()
  eaten = { organic: 0, lipid: 0, mineral: 0 }
  cellsEaten = 0
  startTime = time
  deathTime = null
  populationTimer = 0
  for (let i = 0; i < tuning.grazers; i++) spawnCell('grazer', 300)
  for (let i = 0; i < tuning.engulfers; i++) spawnCell('engulfer', 600)
  view.x = player.cx
  view.y = player.cy
  view.zoom = targetZoom()
  hud.death.classList.remove('shown')
  updateHud()
}

/** New cells are sized relative to the player, so the ecosystem keeps pace as you grow. */
function spawnCell(species: Species, minDist: number) {
  const ratio = species === 'engulfer' ? rand(2.8, 4.5) : Math.exp(rand(Math.log(0.12), Math.log(1.3)))
  let x = 0
  let y = 0
  for (let tries = 0; tries < 20; tries++) {
    x = rand(0, WORLD)
    y = rand(0, WORLD)
    const far = Math.hypot(wrapDelta(x - player.cx, WORLD), wrapDelta(y - player.cy, WORLD)) > minDist
    const clear = vents.every(v => Math.hypot(wrapDelta(x - v.x, WORLD), wrapDelta(y - v.y, WORLD)) > v.r * 3)
    if (far && clear) break
  }
  const cell = new Protocell(x, y, player.biomass * ratio, species)
  cell.brain = newBrain()
  cells.push(cell)
}

function maintainPopulation(dt: number) {
  populationTimer -= dt
  if (populationTimer > 0) return
  populationTimer = POPULATION_CHECK
  const alive = (s: Species) => cells.filter(c => c.species === s && !c.engulfedBy).length
  if (alive('grazer') < tuning.grazers) spawnCell('grazer', 450)
  if (alive('engulfer') < tuning.engulfers) spawnCell('engulfer', 600)
}

/** Keep the player a constant size on screen; the world shrinks as it grows. */
function screenRadius() {
  return clamp(Math.min(view.w, view.h) * 0.06, 26, 60)
}

/**
 * Keep the player a constant size on screen, but never zoom out so far that more than ~90% of the
 * wrapping world is visible (you'd see its seam and things popping across it). Past that point the
 * player just gets bigger on screen, until the world itself scales with the player.
 */
function targetZoom() {
  const minZoom = Math.max(view.w, view.h) / (WORLD * 0.9)
  return Math.max(screenRadius() / player.R, minZoom)
}

function simulate(dt: number) {
  time += dt
  const alive = deathTime === null

  for (const cell of cells) {
    if (cell.gone) continue
    let sx = 0
    let sy = 0
    let mag = 0
    if (cell === player) {
      const s = input.read(view.sx(cell.cx), view.sy(cell.cy), cell.R * view.zoom)
      ;({ x: sx, y: sy, mag } = s)
    } else if (!cell.engulfedBy) {
      ;({ x: sx, y: sy, mag } = think(cell, dt, cells, nutrients, npcSteer))
    }
    for (let i = 0; i < SUBSTEPS; i++) cell.step(dt / SUBSTEPS, fluid, sx, sy, mag, time, vents)

    // Each cell drags water along with it, and its thrust shoves water out the back.
    fluid.dragToward(cell.cx, cell.cy, cell.R * 1.05, cell.cvx, cell.cvy, tuning.wake)
    if (cell.thrust > 0) {
      fluid.push(
        cell.cx - cell.steerX * cell.R * 1.3,
        cell.cy - cell.steerY * cell.R * 1.3,
        cell.R * 0.9,
        -cell.steerX * cell.thrust * tuning.jet,
        -cell.steerY * cell.thrust * tuning.jet,
      )
    }
  }

  interact()
  for (const vent of vents) vent.step(dt, fluid, nutrients)
  fluid.step(dt, time)

  nutrients.step(dt, fluid, vents, player.cx, player.cy)
  feed(dt)
  nutrients.sweep()
  dust.step(dt, fluid)
  effects.step(dt)
  if (alive) maintainPopulation(dt)
}

/** Cell-vs-cell: swallow anything small enough, otherwise bump membranes. */
function interact() {
  for (let i = 0; i < cells.length; i++) {
    const a = cells[i]
    if (a.engulfedBy || a.gone) continue
    for (let j = i + 1; j < cells.length; j++) {
      const b = cells[j]
      if (b.engulfedBy || b.gone) continue
      const dx = wrapDelta(b.cx - a.cx, WORLD)
      const dy = wrapDelta(b.cy - a.cy, WORLD)
      const reach = a.R + b.R
      if (dx > reach || dx < -reach || dy > reach || dy < -reach) continue
      const d = Math.hypot(dx, dy)
      if (d > reach) continue
      // Swallowing starts once the prey's centre reaches the membrane; the engulf pulls it the rest of the way.
      if (a.canEat(b)) {
        if (d < a.R) eat(a, b)
      } else if (b.canEat(a)) {
        if (d < b.R) eat(b, a)
      } else {
        a.pushOutOf(b)
        b.pushOutOf(a)
      }
    }
  }

  for (const cell of cells) {
    if (cell.gone && cell.engulfedBy && !cell.engulfedBy.gone) cell.engulfedBy.ingestCell(cell)
  }
  cells = cells.filter(c => !c.gone || c === player)
}

function eat(eater: Protocell, prey: Protocell) {
  if (prey === player) {
    rupture(prey, eater)
    return
  }
  prey.startEngulf(eater)
  effects.ripple(prey.cx, prey.cy, eater.palette.rim, 0.8)
  if (eater === player) {
    cellsEaten++
    updateHud()
  }
}

/** The player's death: the membrane tears and its contents spray into the water for others to eat. */
function rupture(cell: Protocell, eater: Protocell) {
  cell.gone = true
  deathTime = time
  const organics = clamp(Math.round(cell.biomass * 50), 35, 140)
  const lipids = Math.round(cell.biomass * 4) + 2
  for (let i = 0; i < organics + lipids; i++) {
    const p = cell.pts[Math.floor(Math.random() * cell.pts.length)]
    const a = Math.atan2(p.y - cell.cy, p.x - cell.cx) + rand(-0.3, 0.3)
    const speed = rand(60, 170)
    nutrients.spawn(
      i < organics ? 'organic' : 'lipid',
      cell.cx + Math.cos(a) * cell.R * rand(0.2, 1),
      cell.cy + Math.sin(a) * cell.R * rand(0.2, 1),
      cell.cvx + Math.cos(a) * speed,
      cell.cvy + Math.sin(a) * speed,
      rand(0.6, 1),
    )
  }
  for (let i = 0; i < cell.pts.length; i += 2) {
    const p = cell.pts[i]
    const a = Math.atan2(p.y - cell.cy, p.x - cell.cx)
    const speed = rand(40, 100)
    effects.shard(
      p.x,
      p.y,
      cell.cvx + Math.cos(a) * speed,
      cell.cvy + Math.sin(a) * speed,
      a - 0.35 + rand(-0.4, 0.4),
      cell.R * rand(0.25, 0.45),
      cell.palette.rim,
    )
  }
  effects.ripple(cell.cx, cell.cy, cell.palette.rim, 1)

  const seconds = Math.round(time - startTime)
  hud.deathStats.textContent =
    `Survived ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} · ` +
    `peak biomass ×${cell.biomass.toFixed(2)} · ${cellsEaten} cells absorbed`
  hud.deathCause.textContent =
    eater.species === 'engulfer' ? 'Engulfed by a predatory protocell' : 'Absorbed by a larger protocell'
  hud.death.classList.add('shown')
}

/** Particles that brush a membrane get pulled in; anything inside is absorbed. */
function feed(dt: number) {
  for (const cell of cells) {
    if (cell.engulfedBy || cell.gone) continue
    const R = cell.R
    const reach = R + 8
    for (const n of nutrients.items) {
      if (n.dead || n.grace > 0) continue
      const dx = wrapDelta(n.x - cell.cx, WORLD)
      const dy = wrapDelta(n.y - cell.cy, WORLD)
      if (Math.abs(dx) > reach + n.r || Math.abs(dy) > reach + n.r) continue
      const d = Math.hypot(dx, dy) || 0.001
      if (d < R * 0.85) {
        n.dead = true
        cell.ingest(n.kind, cell.cx + dx, cell.cy + dy, n.vx, n.vy)
        cell.grow(NUTRITION[n.kind] * (cell === player ? 1 : NPC_GROWTH))
        if (cell === player) {
          effects.ripple(n.x, n.y, NUTRIENT_RGB[n.kind])
          eaten[n.kind]++
          updateHud()
        }
      } else if (d < reach + n.r) {
        n.vx -= (dx / d) * tuning.capture * dt
        n.vy -= (dy / d) * tuning.capture * dt
      }
    }
  }
}

function updateCamera(dt: number) {
  // Follow with a little lag and look-ahead, so speed reads as the cell drifting off-centre.
  const k = 1 - Math.exp(-4 * dt)
  const lead = deathTime === null ? 0.25 : 0
  view.x = wrapCoord(view.x + wrapDelta(player.cx + player.cvx * lead - view.x, WORLD) * k, WORLD)
  view.y = wrapCoord(view.y + wrapDelta(player.cy + player.cvy * lead - view.y, WORLD) * k, WORLD)
  view.zoom += (targetZoom() - view.zoom) * (1 - Math.exp(-1.5 * dt))
}

let vignette: CanvasGradient

function resize() {
  const dpr = window.devicePixelRatio || 1
  view.w = canvas.clientWidth
  view.h = canvas.clientHeight
  canvas.width = view.w * dpr
  canvas.height = view.h * dpr
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const r = Math.hypot(view.w, view.h) / 2
  vignette = ctx.createRadialGradient(view.w / 2, view.h / 2, r * 0.35, view.w / 2, view.h / 2, r)
  vignette.addColorStop(0, 'rgba(0,0,0,0)')
  vignette.addColorStop(1, 'rgba(0,4,8,0.55)')
}

function render() {
  ctx.fillStyle = '#04141c'
  ctx.fillRect(0, 0, view.w, view.h)
  dust.draw(ctx, view)
  if (tuning.showFlow) fluid.drawFlow(ctx, view)
  for (const vent of vents) vent.draw(ctx, view, time)
  nutrients.draw(ctx, view, time)
  // Cells being swallowed draw on top of whatever is swallowing them; the player draws above its peers.
  for (const cell of cells) if (!cell.engulfedBy && cell !== player) cell.draw(ctx, view)
  if (!player.gone) player.draw(ctx, view)
  for (const cell of cells) if (cell.engulfedBy) cell.draw(ctx, view)
  effects.draw(ctx, view)
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, view.w, view.h)
}

// HUD
const hud = {
  organic: document.querySelector<HTMLElement>('[data-kind="organic"] b')!,
  lipid: document.querySelector<HTMLElement>('[data-kind="lipid"] b')!,
  mineral: document.querySelector<HTMLElement>('[data-kind="mineral"] b')!,
  biomass: document.querySelector<HTMLElement>('#biomass b')!,
  fps: document.querySelector<HTMLElement>('#fps')!,
  hint: document.querySelector<HTMLElement>('#hint')!,
  death: document.querySelector<HTMLElement>('#death')!,
  deathCause: document.querySelector<HTMLElement>('#death .cause')!,
  deathStats: document.querySelector<HTMLElement>('#death .stats')!,
}

function updateHud() {
  hud.organic.textContent = String(eaten.organic)
  hud.lipid.textContent = String(eaten.lipid)
  hud.mineral.textContent = String(eaten.mineral)
  hud.biomass.textContent = `×${player.biomass.toFixed(2)}`
}

/** After dying, any tap or key starts a new protocell (with a short pause so the burst can play). */
function tryRestart() {
  if (deathTime !== null && time - deathTime > 1.2) reset()
}
canvas.addEventListener('pointerdown', tryRestart)
window.addEventListener('keydown', tryRestart)

// Tuning panel
const gui = new GUI({ title: 'Tuning' })
const fluidFolder = gui.addFolder('Fluid')
fluidFolder.add(tuning, 'currentStrength', 0, 60).name('current')
fluidFolder.add(tuning, 'currentRelax', 0, 3).name('current pull')
fluidFolder.add(tuning, 'wake', 0, 20)
fluidFolder.add(tuning, 'jet', 0, 6)
fluidFolder.add(tuning, 'pressureIterations', 1, 40, 1).name('solver iters')
const cellFolder = gui.addFolder('Protocell')
cellFolder.add(tuning, 'thrust', 0, 400)
cellFolder.add(tuning, 'pulse', 0, 1)
cellFolder.add(tuning, 'pulseRate', 0, 5).name('pulse rate')
cellFolder.add(tuning, 'drag', 0, 8)
cellFolder.add(tuning, 'frontDrag', 0, 3).name('front drag')
cellFolder.add(tuning, 'stiffness', 10, 400)
cellFolder.add(tuning, 'wobbleDamping', 0, 15).name('wobble damping')
cellFolder.add(tuning, 'capture', 0, 800)
const ecoFolder = gui.addFolder('Ecosystem')
ecoFolder.add(tuning, 'grazers', 0, 30, 1)
ecoFolder.add(tuning, 'engulfers', 0, 8, 1)
ecoFolder.add(tuning, 'engulferSense', 50, 500).name('engulfer sense')
ecoFolder.add(tuning, 'engulferStamina', 1, 20).name('engulfer stamina')
ecoFolder.add(tuning, 'engulferLunge', 1, 6).name('engulfer lunge')
gui.add(tuning, 'showFlow').name('show flow')
gui.add({ reset }, 'reset')
gui.close()

window.addEventListener('resize', resize)
resize()
reset()

let last = performance.now()
let acc = 0
let fpsFrames = 0
let fpsTime = 0
function frame(now: number) {
  const elapsed = Math.min((now - last) / 1000, 0.1)
  last = now
  acc += elapsed
  let steps = 0
  while (acc >= STEP && steps < 3) {
    simulate(STEP)
    acc -= STEP
    steps++
  }
  if (steps === 3) acc = 0
  updateCamera(elapsed)
  render()

  if (input.used) hud.hint.classList.add('hidden')
  fpsFrames++
  fpsTime += elapsed
  if (fpsTime >= 0.5) {
    hud.fps.textContent = `${Math.round(fpsFrames / fpsTime)} fps`
    fpsFrames = 0
    fpsTime = 0
  }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

// Dev-only handle for poking at the simulation from the console.
if (import.meta.env.DEV) {
  Object.assign(window, {
    game: {
      get player() {
        return player
      },
      get cells() {
        return cells
      },
      /** Spawn a cell `dist` units to the right of the player. */
      spawnNear(species: Species, biomass: number, dist = 120) {
        const cell = new Protocell(player.cx + dist, player.cy, biomass, species)
        cell.brain = newBrain()
        cells.push(cell)
        return cell
      },
    },
  })
}
