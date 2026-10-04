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
import {
  EVOLUTION_COST,
  SPIKE_BITE,
  SPIKE_FULL_SPEED,
  SPIKE_MIN_SPEED,
  SPIKE_RECOVERY,
  TENDRIL_PULL,
  TENDRIL_RANGE,
  TRAITS,
  type TraitId,
  type TraitInfo,
  availableTraits,
} from './traits'
import { needsRescale, rescaleWorld } from './rescale'
import { scale } from './scale'
import { Senses } from './senses'
import { View } from './view'

const STEP = 1 / 60
const SUBSTEPS = 3
const POPULATION_CHECK = 2
/** Time runs at this fraction of normal speed while you choose an evolution. */
const CHOICE_TIME_SCALE = 0.12
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
let senses: Senses
let eaten: Record<Kind, number>
let cellsEaten = 0
let time = 0
let startTime = 0
let deathTime: number | null = null
let populationTimer = 0
let evolutions = 0
let choosing = false
const npcSteer: Steer = { x: 0, y: 0, mag: 0 }

function reset() {
  scale.biomass = 1
  fluid = new Fluid()
  vents = placeVents()
  player = new Protocell(WORLD / 2, WORLD / 2, 1, 'player')
  cells = [player]
  nutrients = new Nutrients()
  nutrients.seed(player.cx, player.cy, vents)
  dust = new Dust()
  effects = new Effects()
  senses = new Senses()
  eaten = { organic: 0, lipid: 0, mineral: 0 }
  cellsEaten = 0
  startTime = time
  deathTime = null
  populationTimer = 0
  evolutions = 0
  closeChoice()
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
  if (alive) aimPseudopod(player, dt)
  if (input.takeDash() && alive && !choosing && player.dash()) {
    // The tail's snap throws a slug of water backwards.
    fluid.push(player.jetX, player.jetY, player.R * 1.3, -player.facingX * 2500, -player.facingY * 2500)
    effects.ripple(player.jetX, player.jetY, player.palette.rim, 0.6)
  }

  for (const cell of cells) {
    if (cell.gone) continue
    let sx = 0
    let sy = 0
    let mag = 0
    if (cell === player) {
      if (!choosing) ({ x: sx, y: sy, mag } = input.read(view.sx(cell.cx), view.sy(cell.cy), cell.R * view.zoom))
    } else if (!cell.engulfedBy) {
      ;({ x: sx, y: sy, mag } = think(cell, dt, cells, nutrients, npcSteer))
    }
    for (let i = 0; i < SUBSTEPS; i++) cell.step(dt / SUBSTEPS, fluid, sx, sy, mag, time, vents)

    // Each cell drags water along with it, and its thrust shoves water out the back.
    fluid.dragToward(cell.cx, cell.cy, cell.R * 1.05, cell.cvx, cell.cvy, tuning.wake)
    if (cell.thrust > 0) {
      fluid.push(
        cell.jetX,
        cell.jetY,
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
  if (alive && player.traits.has('chemoreception')) senses.update(dt, player.cx, player.cy, nutrients, vents)
  if (alive) checkEvolution()
  if (alive && needsRescale(player)) {
    const k = rescaleWorld(player, cells, nutrients, vents, fluid, effects)
    // Everything just shrank by k around the player; zoom in by the same amount so the screen doesn't change.
    view.zoom /= k
    view.x = wrapCoord(player.cx + wrapDelta(view.x - player.cx, WORLD) * k, WORLD)
    view.y = wrapCoord(player.cy + wrapDelta(view.y - player.cy, WORLD) * k, WORLD)
  }
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
      const reach = Math.max(a.grabRadius, a.R) + Math.max(b.grabRadius, b.R)
      if (dx > reach || dx < -reach || dy > reach || dy < -reach) continue
      const d = Math.hypot(dx, dy)
      if (d > reach) continue
      // Swallowing starts once the prey's centre reaches the membrane (or a pseudopod); the engulf
      // pulls it the rest of the way. A freshly cracked thick membrane just bounces.
      if (a.canEat(b) && b.shielded <= 0) {
        if (d < a.grabRadius) eat(a, b)
      } else if (b.canEat(a) && a.shielded <= 0) {
        if (d < b.grabRadius) eat(b, a)
      } else if (d < a.R + b.R) {
        a.pushOutOf(b)
        b.pushOutOf(a)
        // Spikes tear whatever they ram (or get rammed by) hard enough.
        const nx = dx / (d || 1)
        const ny = dy / (d || 1)
        const closing = (a.cvx - b.cvx) * nx + (a.cvy - b.cvy) * ny
        if (a.traits.has('spikes')) tear(b, a, closing)
        if (b.traits.has('spikes')) tear(a, b, closing)
      }
    }
  }

  for (const cell of cells) {
    if (cell.gone && cell.engulfedBy && !cell.engulfedBy.gone) cell.engulfedBy.ingestCell(cell)
  }
  cells = cells.filter(c => !c.gone || c === player)
}

function eat(eater: Protocell, prey: Protocell) {
  // Grabbing something spiky costs you, whether or not you get it down.
  if (prey.traits.has('spikes')) tear(eater, prey, SPIKE_FULL_SPEED)
  if (prey.armor >= 1) {
    repel(eater, prey)
    return
  }
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

/** Spikes: knock a chunk of biomass off `victim`; it sprays out as food. */
function tear(victim: Protocell, spiky: Protocell, speed: number) {
  if (speed < SPIKE_MIN_SPEED || victim.spikeImmune > 0 || victim.engulfedBy) return
  victim.spikeImmune = SPIKE_RECOVERY
  const lost = victim.biomass * SPIKE_BITE * Math.min(1, speed / SPIKE_FULL_SPEED)
  victim.grow(-lost)
  // Spray from the side that was hit.
  const dx = wrapDelta(spiky.cx - victim.cx, WORLD)
  const dy = wrapDelta(spiky.cy - victim.cy, WORLD)
  const d = Math.hypot(dx, dy) || 1
  const hitX = victim.cx + (dx / d) * victim.R
  const hitY = victim.cy + (dy / d) * victim.R
  const count = 6 + Math.round(Math.min(1, speed / SPIKE_FULL_SPEED) * 8)
  const base = Math.atan2(-dy, -dx)
  for (let i = 0; i < count; i++) {
    const a = base + Math.PI / 2 + rand(-1.2, 1.2) * (Math.random() < 0.5 ? 1 : -1)
    const v = rand(30, 90)
    nutrients.spawn(
      i % 4 === 0 ? 'lipid' : 'organic',
      hitX,
      hitY,
      victim.cvx + Math.cos(a) * v,
      victim.cvy + Math.sin(a) * v,
      0.25,
      (lost * 0.9) / count,
    )
  }
  for (let i = 0; i < 4; i++) {
    const a = base + rand(-1, 1)
    effects.shard(hitX, hitY, Math.cos(a) * 50, Math.sin(a) * 50, a, victim.R * 0.25, victim.palette.rim)
  }
  effects.ripple(hitX, hitY, victim.palette.rim, 0.5)
  // Getting torn makes a predator back off for a moment.
  if (victim.brain) {
    victim.brain.lunge = 0
    victim.brain.rest = Math.max(victim.brain.rest, 1.5)
  }
  if (victim === player) updateHud()
}

/** A thick membrane holds: the attacker is thrown back and the membrane cracks. */
function repel(eater: Protocell, prey: Protocell) {
  prey.armor = 0
  prey.shielded = 1.2
  const dx = wrapDelta(prey.cx - eater.cx, WORLD)
  const dy = wrapDelta(prey.cy - eater.cy, WORLD)
  const d = Math.hypot(dx, dy) || 1
  const nx = dx / d
  const ny = dy / d
  for (const p of prey.pts) {
    p.vx += nx * 160
    p.vy += ny * 160
  }
  for (const p of eater.pts) {
    p.vx -= nx * 60
    p.vy -= ny * 60
  }
  if (eater.brain) {
    eater.brain.lunge = 0
    eater.brain.prey = null
    eater.brain.rest = 2.5
  }
  const hitX = prey.cx - nx * prey.R
  const hitY = prey.cy - ny * prey.R
  effects.ripple(hitX, hitY, prey.palette.rim, 0.9)
  for (let i = 0; i < 6; i++) {
    const a = Math.atan2(-ny, -nx) + rand(-0.9, 0.9)
    effects.shard(hitX, hitY, Math.cos(a) * rand(30, 70), Math.sin(a) * rand(30, 70), a, prey.R * 0.3, prey.palette.rim)
  }
}

/** Engulfing: point the pseudopod at the nearest cell the player could swallow. */
let tendrilTarget: Protocell | null = null

function aimPseudopod(cell: Protocell, dt: number) {
  tendrilTarget = null
  if (!cell.traits.has('engulfing')) return
  const tendril = cell.traits.has('tendril')
  let best: Protocell | null = null
  let bestGap = cell.R * (tendril ? TENDRIL_RANGE : 2)
  for (const other of cells) {
    if (other === cell || other.gone || other.engulfedBy || !cell.canEat(other)) continue
    const gap = Math.hypot(wrapDelta(other.cx - cell.cx, WORLD), wrapDelta(other.cy - cell.cy, WORLD)) - cell.R
    if (gap < bestGap) {
      best = other
      bestGap = gap
    }
  }
  cell.reachWant = best ? 1 : 0
  if (best) {
    const dx = wrapDelta(best.cx - cell.cx, WORLD)
    const dy = wrapDelta(best.cy - cell.cy, WORLD)
    const d = Math.hypot(dx, dy) || 1
    cell.reachDirX = dx / d
    cell.reachDirY = dy / d
    if (tendril && cell.reach > 0.5) {
      // Reel the prey in. It still swims against the pull, so a strong cell can break free.
      tendrilTarget = best
      for (const p of best.pts) {
        p.vx -= (dx / d) * TENDRIL_PULL * dt
        p.vy -= (dy / d) * TENDRIL_PULL * dt
      }
    }
  }
}

/** The tendril: a wavering strand from the membrane to whatever it's holding. */
function drawTendril() {
  const prey = tendrilTarget
  if (!prey || player.gone) return
  const z = view.zoom
  const px = view.sx(player.cx)
  const py = view.sy(player.cy)
  const dx = wrapDelta(prey.cx - player.cx, WORLD) * z
  const dy = wrapDelta(prey.cy - player.cy, WORLD) * z
  const d = Math.hypot(dx, dy) || 1
  const ux = dx / d
  const uy = dy / d
  const start = player.grabRadius * z * 0.95
  const end = d - prey.R * z * 0.8
  if (end <= start) return
  const sway = Math.sin(time * 6) * (end - start) * 0.12
  const mx = px + ux * (start + end) * 0.5 - uy * sway
  const my = py + uy * (start + end) * 0.5 + ux * sway
  ctx.beginPath()
  ctx.moveTo(px + ux * start, py + uy * start)
  ctx.quadraticCurveTo(mx, my, px + ux * end, py + uy * end)
  ctx.lineCap = 'round'
  ctx.lineWidth = Math.max(1.5, player.R * z * 0.09)
  ctx.strokeStyle = `rgba(${player.palette.rim},0.55)`
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(px + ux * end, py + uy * end, Math.max(2, player.R * z * 0.1), 0, Math.PI * 2)
  ctx.fillStyle = `rgba(${player.palette.rim},0.7)`
  ctx.fill()
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
      if (n.dead || n.grace > 0 || n.fading) continue
      const dx = wrapDelta(n.x - cell.cx, WORLD)
      const dy = wrapDelta(n.y - cell.cy, WORLD)
      if (Math.abs(dx) > reach + n.r || Math.abs(dy) > reach + n.r) continue
      const d = Math.hypot(dx, dy) || 0.001
      if (d < R * 0.85) {
        n.dead = true
        cell.ingest(n.kind, cell.cx + dx, cell.cy + dy, n.vx, n.vy)
        cell.grow(n.value * (cell === player ? 1 : NPC_GROWTH))
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

function nextEvolutionCost() {
  return EVOLUTION_COST[Math.min(evolutions, EVOLUTION_COST.length - 1)]
}

/** Traits the player could still evolve, in random order, at most three. */
function evolutionOptions(): TraitInfo[] {
  const open = availableTraits(player.traits)
  for (let i = open.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[open[i], open[j]] = [open[j], open[i]]
  }
  return open.slice(0, 3)
}

/** Debug: skip the mineral requirement. */
function checkEvolutionNow() {
  const options = evolutionOptions()
  if (options.length && !choosing && deathTime === null) openChoice(options)
}

function checkEvolution() {
  if (choosing || eaten.mineral < nextEvolutionCost()) return
  const options = evolutionOptions()
  if (options.length) openChoice(options)
}

/** Slow time and offer the evolution cards. */
function openChoice(options: TraitInfo[]) {
  choosing = true
  input.release()
  hud.cards.replaceChildren(
    ...options.map((trait, i) => {
      const card = document.createElement('button')
      card.className = 'card'
      card.innerHTML =
        `<span class="icon">${TRAIT_ICONS[trait.id]}</span>` +
        `<span class="name">${trait.name}</span>` +
        (trait.requires ? `<span class="lineage">evolves from ${TRAITS[trait.requires].name}</span>` : '') +
        `<span class="tagline">${trait.tagline}</span>` +
        `<span class="detail">${trait.detail}</span>` +
        `<span class="key">${i + 1}</span>`
      card.addEventListener('click', () => choose(trait.id))
      return card
    }),
  )
  hud.evolve.classList.add('shown')
}

function closeChoice() {
  choosing = false
  hud.evolve.classList.remove('shown')
}

function choose(id: TraitId) {
  if (!choosing) return
  player.addTrait(id)
  evolutions++
  closeChoice()
  input.release()
  effects.ripple(player.cx, player.cy, player.palette.rim, 1.2)
  updateHud()
}

const svg = (body: string) =>
  `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">${body}</svg>`

const TRAIT_ICONS: Record<TraitId, string> = {
  chemoreception: svg(
    '<circle cx="26" cy="32" r="12"/><path d="M42 24c4 2 4 14 0 16M48 19c7 4 7 22 0 26M54 14c9 6 9 30 0 36" stroke-width="2"/>',
  ),
  burst: svg(
    '<circle cx="42" cy="32" r="11"/><path d="M30 32c-3-5-6-5-8 0s-5 5-7 0"/><path d="M14 22l-6-4M12 32H4M14 42l-6 4" stroke-width="2"/>',
  ),
  spikes: svg(
    '<circle cx="32" cy="32" r="13"/>' +
      [0, 45, 90, 135, 180, 225, 270, 315]
        .map(a => {
          const r = (a * Math.PI) / 180
          const p = (d: number) => `${(32 + Math.cos(r) * d).toFixed(1)} ${(32 + Math.sin(r) * d).toFixed(1)}`
          return `<path d="M${p(13)}L${p(22)}"/>`
        })
        .join(''),
  ),
  tendril: svg(
    '<circle cx="20" cy="32" r="11"/><path d="M31 30c8-6 12 6 20 0 3-2 5-3 7-1"/><circle cx="56" cy="27" r="3"/>',
  ),
  lure: svg(
    '<circle cx="32" cy="32" r="10"/><circle cx="32" cy="32" r="17" stroke-width="1.2" stroke-dasharray="2 4"/>' +
      '<circle cx="54" cy="18" r="3"/><circle cx="10" cy="46" r="2.5"/><path d="M50 21l-6 4M13 44l6-3" stroke-width="1.5"/>',
  ),
  membrane: svg('<circle cx="32" cy="32" r="18"/><circle cx="32" cy="32" r="13" stroke-width="1.5"/>'),
  engulfing: svg(
    '<path d="M22 20c8-6 18-4 20 4 2 5 9 4 12 8s-3 9-10 8c-4 9-17 10-23 3s-8-17 1-23z"/><circle cx="54" cy="31" r="3"/>',
  ),
  photosynthesis: svg(
    '<circle cx="32" cy="34" r="14"/><circle cx="28" cy="31" r="2.5"/><circle cx="36" cy="36" r="2.5"/><circle cx="31" cy="40" r="2"/>' +
      '<path d="M32 8v6M14 16l4 4M50 16l-4 4M8 34h6M50 34h6"/>',
  ),
  flagellum:
    '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">' +
    '<circle cx="40" cy="32" r="13"/><path d="M27 32c-4-6-7-6-10 0s-6 6-9 0-5-5-6-2"/></svg>',
}

window.addEventListener('keydown', e => {
  if (!choosing) return
  const card = hud.cards.children[Number(e.key) - 1] as HTMLButtonElement | undefined
  card?.click()
})

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
  drawTendril()
  effects.draw(ctx, view)
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, view.w, view.h)
  if (deathTime === null && player.traits.has('chemoreception')) senses.draw(ctx, view, time)
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
  evolve: document.querySelector<HTMLElement>('#evolve')!,
  cards: document.querySelector<HTMLElement>('#evolve .cards')!,
}

function updateHud() {
  hud.organic.textContent = String(eaten.organic)
  hud.lipid.textContent = String(eaten.lipid)
  const more = availableTraits(player.traits).length > 0
  hud.mineral.textContent = more ? `${eaten.mineral} / ${nextEvolutionCost()}` : String(eaten.mineral)
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
const flagFolder = gui.addFolder('Flagellum')
flagFolder.add(tuning, 'flagellumPower', 0, 5).name('power')
flagFolder.add(tuning, 'flagellumTurn', 0, 800).name('turn')
gui.add({ evolve: () => checkEvolutionNow() }, 'evolve').name('evolve now')
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
  acc += elapsed * (choosing ? CHOICE_TIME_SCALE : 1)
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
      offerEvolution: checkEvolutionNow,
      evolve(id: TraitId) {
        player.addTrait(id)
        updateHud()
      },
      spawnNear(species: Species, biomass: number, dist = 120) {
        const cell = new Protocell(player.cx + dist, player.cy, biomass, species)
        cell.brain = newBrain()
        cells.push(cell)
        return cell
      },
    },
  })
}
