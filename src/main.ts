import GUI from 'lil-gui'
import { PROTOCELL_RADIUS, WORLD, tuning } from './config'
import { Dust } from './dust'
import { Effects } from './effects'
import { Fluid } from './fluid'
import { Input } from './input'
import { clamp, wrapCoord, wrapDelta } from './math'
import { type Kind, Nutrients } from './nutrients'
import { NUTRIENT_RGB, Protocell } from './protocell'
import { placeVents } from './vents'
import { View } from './view'
import './style.css'

const STEP = 1 / 60
const SUBSTEPS = 3

const canvas = document.querySelector<HTMLCanvasElement>('#game')!
const ctx = canvas.getContext('2d')!
const view = new View()
const input = new Input(canvas)

let fluid: Fluid
let cell: Protocell
let nutrients: Nutrients
let vents: ReturnType<typeof placeVents>
let dust: Dust
let effects: Effects
let eaten: Record<Kind, number>
let time = 0

function reset() {
  fluid = new Fluid()
  vents = placeVents()
  cell = new Protocell(WORLD / 2, WORLD / 2, PROTOCELL_RADIUS)
  nutrients = new Nutrients()
  nutrients.seed(cell.cx, cell.cy, vents)
  dust = new Dust()
  effects = new Effects()
  eaten = { organic: 0, lipid: 0, mineral: 0 }
  view.x = cell.cx
  view.y = cell.cy
  view.zoom = targetZoom()
  updateHud()
}

/** Keep the cell a constant size on screen; the world shrinks as it grows. */
function screenRadius() {
  return clamp(Math.min(view.w, view.h) * 0.06, 26, 60)
}

function targetZoom() {
  return screenRadius() / cell.R
}

function simulate(dt: number) {
  time += dt
  const steer = input.read(view.sx(cell.cx), view.sy(cell.cy), cell.R * view.zoom)

  for (let i = 0; i < SUBSTEPS; i++) cell.step(dt / SUBSTEPS, fluid, steer.x, steer.y, steer.mag, time, vents)

  // The cell drags water along with it, and its thrust shoves water out the back.
  fluid.dragToward(cell.cx, cell.cy, cell.R * 1.05, cell.cvx, cell.cvy, tuning.wake)
  if (cell.thrust > 0) {
    fluid.push(
      cell.cx - steer.x * cell.R * 1.3,
      cell.cy - steer.y * cell.R * 1.3,
      cell.R * 0.9,
      -steer.x * cell.thrust * tuning.jet,
      -steer.y * cell.thrust * tuning.jet,
    )
  }
  for (const vent of vents) vent.step(dt, fluid, nutrients)
  fluid.step(dt, time)

  nutrients.step(dt, fluid, vents, cell.cx, cell.cy)
  feed(dt)
  nutrients.sweep()
  dust.step(dt, fluid)
  effects.step(dt)
}

/** Particles that brush the membrane get pulled in; anything inside is absorbed. */
function feed(dt: number) {
  const R = cell.R
  const reach = R + 8
  let changed = false
  for (const n of nutrients.items) {
    const dx = wrapDelta(n.x - cell.cx, WORLD)
    const dy = wrapDelta(n.y - cell.cy, WORLD)
    if (Math.abs(dx) > reach + n.r || Math.abs(dy) > reach + n.r) continue
    const d = Math.hypot(dx, dy) || 0.001
    if (d < R * 0.85) {
      n.dead = true
      cell.ingest(n.kind, cell.cx + dx, cell.cy + dy, n.vx, n.vy)
      effects.ripple(n.x, n.y, NUTRIENT_RGB[n.kind])
      eaten[n.kind]++
      changed = true
    } else if (d < reach + n.r) {
      n.vx -= (dx / d) * tuning.capture * dt
      n.vy -= (dy / d) * tuning.capture * dt
    }
  }
  if (changed) {
    // Lipids build membrane, so they're what grows you; organics and minerals help a little.
    cell.targetR = PROTOCELL_RADIUS * Math.sqrt(1 + eaten.lipid * 0.05 + eaten.organic * 0.004 + eaten.mineral * 0.01)
    updateHud()
  }
}

function updateCamera(dt: number) {
  // Follow with a little lag and look-ahead, so speed reads as the cell drifting off-centre.
  const k = 1 - Math.exp(-4 * dt)
  view.x = wrapCoord(view.x + wrapDelta(cell.cx + cell.cvx * 0.25 - view.x, WORLD) * k, WORLD)
  view.y = wrapCoord(view.y + wrapDelta(cell.cy + cell.cvy * 0.25 - view.y, WORLD) * k, WORLD)
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
  cell.draw(ctx, view)
  effects.draw(ctx, view)
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, view.w, view.h)
}

// HUD
const hud = {
  organic: document.querySelector<HTMLElement>('[data-kind="organic"] b')!,
  lipid: document.querySelector<HTMLElement>('[data-kind="lipid"] b')!,
  mineral: document.querySelector<HTMLElement>('[data-kind="mineral"] b')!,
  fps: document.querySelector<HTMLElement>('#fps')!,
  hint: document.querySelector<HTMLElement>('#hint')!,
}

function updateHud() {
  hud.organic.textContent = String(eaten.organic)
  hud.lipid.textContent = String(eaten.lipid)
  hud.mineral.textContent = String(eaten.mineral)
}

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
gui.add(tuning, 'capture', 0, 800)
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
