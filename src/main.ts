import GUI from 'lil-gui'
import { type Steer, newBrain, think } from './ai'
import { Sound, haptic } from './audio'
import {
  UV_MUTAGEN,
  ZONES,
  type Zone,
  applyHazards,
  drawDarkness,
  drawZoneLabels,
  drawZones,
  hostileAhead,
  placeZones,
  rescaleZones,
} from './biomes'
import { WORLD, tuning } from './config'
import { Dust } from './dust'
import { Effects } from './effects'
import { Fluid } from './fluid'
import { Input } from './input'
import { TAU, clamp, rand, wrapCoord, wrapDelta } from './math'
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
  VENOM_TIME,
  type TraitId,
  type TraitInfo,
  availableTraits,
} from './traits'
import { needsRescale, rescaleWorld } from './rescale'
import { scale } from './scale'
import {
  MITOSIS_SHARE,
  MUTAGEN_CELL,
  MUTAGEN_FIRST,
  MUTAGEN_HURT,
  MUTAGEN_MINERAL,
  MUTAGEN_STEP,
  MUTATIONS,
  type MutationId,
  type MutationInfo,
  HOLLOW_SPIKE_BITE,
  POROUS_INTERVAL,
  POROUS_LEAK,
  STICKY_REACH,
  rollMutation,
} from './mutations'
import { type DnaLine, type RunRecord, dnaFor, loadSave, writeSave } from './save'
import { Senses } from './senses'
import { TreeOfLife } from './tree'
import {
  ASSEMBLY_TIME,
  COLONY_CELLS,
  COLONY_SHARE,
  type Lineage,
  MIN_SURVIVORS,
  TRANSITION_BIOMASS,
  TRANSITION_EVOLUTIONS,
  TRANSITION_TIME,
  formationOffsets,
  lineageFor,
  recordLineage,
} from './transition'
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
const sound = new Sound()
/** Progress that outlives a run: DNA, generations, unlocks and the Tree of Life's records. */
const save = loadSave()

/** Sticky test mode: a clicked world target the player keeps swimming toward. */
let stickyTarget: { x: number; y: number } | null = null
const stickySteer: Steer = { x: 0, y: 0, mag: 0 }

/** The player's steering from input, at world (x, y) with radius r; handles sticky test mode. */
function playerSteer(x: number, y: number, r: number): Steer {
  if (!input.sticky) return input.read(view.sx(x), view.sy(y), r * view.zoom)
  if (input.stickyCleared) {
    stickyTarget = null
    input.stickyCleared = false
  }
  const click = input.takeClick()
  if (click) {
    stickyTarget = {
      x: wrapCoord(view.x + (click.x - view.w / 2) / view.zoom, WORLD),
      y: wrapCoord(view.y + (click.y - view.h / 2) / view.zoom, WORLD),
    }
  }
  stickySteer.mag = 0
  if (stickyTarget) {
    const dx = wrapDelta(stickyTarget.x - x, WORLD)
    const dy = wrapDelta(stickyTarget.y - y, WORLD)
    const d = Math.hypot(dx, dy)
    if (d < r * 0.8) {
      stickyTarget = null // reached: stop thrusting, keep drifting
    } else {
      stickySteer.x = dx / d
      stickySteer.y = dy / d
      stickySteer.mag = 1
    }
  } else if (input.stickyDir) {
    const len = Math.hypot(input.stickyDir.x, input.stickyDir.y) || 1
    stickySteer.x = input.stickyDir.x / len
    stickySteer.y = input.stickyDir.y / len
    stickySteer.mag = 1
  }
  return stickySteer
}

/** Sticky test mode: an arrow showing the held direction, and a crosshair on a click target. */
function drawStickyIndicator() {
  if (!input.sticky || deathTime !== null) return
  const px = view.sx(focus.x)
  const py = view.sy(focus.y)
  const ring = focus.r * view.zoom + 10
  ctx.lineCap = 'round'
  ctx.lineWidth = 2
  ctx.strokeStyle = 'rgba(255,255,255,0.75)'
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  let dx = 0
  let dy = 0
  if (stickyTarget) {
    const tx = view.sx(stickyTarget.x)
    const ty = view.sy(stickyTarget.y)
    ctx.beginPath()
    ctx.arc(tx, ty, 7, 0, TAU)
    ctx.moveTo(tx - 12, ty)
    ctx.lineTo(tx + 12, ty)
    ctx.moveTo(tx, ty - 12)
    ctx.lineTo(tx, ty + 12)
    ctx.stroke()
    const d = Math.hypot(tx - px, ty - py) || 1
    dx = (tx - px) / d
    dy = (ty - py) / d
  } else if (input.stickyDir) {
    const len = Math.hypot(input.stickyDir.x, input.stickyDir.y) || 1
    dx = input.stickyDir.x / len
    dy = input.stickyDir.y / len
  }
  if (!dx && !dy) {
    // Mode on, thrust released: a small hollow dot.
    ctx.beginPath()
    ctx.arc(px, py - ring, 3, 0, TAU)
    ctx.stroke()
    return
  }
  const sx = px + dx * ring
  const sy = py + dy * ring
  const ex = sx + dx * 22
  const ey = sy + dy * 22
  ctx.beginPath()
  ctx.moveTo(sx, sy)
  ctx.lineTo(ex, ey)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(ex + dx * 6, ey + dy * 6)
  ctx.lineTo(ex - dy * 5, ey + dx * 5)
  ctx.lineTo(ex + dy * 5, ey - dx * 5)
  ctx.closePath()
  ctx.fill()
}

/** Stereo position for something at world x, from where it is on screen. */
function panAt(x: number) {
  return clamp((view.sx(x) / view.w) * 2 - 1, -1, 1) * 0.7
}

let fluid: Fluid
let player: Protocell
let cells: Protocell[]
let nutrients: Nutrients
let vents: Vent[]
let zones: Zone[]
let zoneFoodTimer = 0
let dust: Dust
let effects: Effects
let senses: Senses
let eaten: Record<Kind, number>
let cellsEaten = 0
let peakBiomass = 1
/** Evolutions granted for free (Genetic Memory); they don't push up the mineral cost of the next one. */
let freeEvolutions = 0
/** Hidden mutagen meter: fills from minerals, meals and injuries; a mutation hits when it's full. */
let mutagen = 0
let mutagenNeeded = MUTAGEN_FIRST
let leakTimer = 0
/** Real seconds of slow motion left after a mutation hits. */
let mutationSlow = 0
let time = 0
let startTime = 0
let deathTime: number | null = null
let populationTimer = 0
let evolutions = 0
let choosing = false
/**
 * Run phase. 'living' is the normal game; 'colony' is the Great Transition's survival minute;
 * 'assembling' pulls the survivors into formation; 'complete' shows the new lineage.
 */
type Phase = 'living' | 'colony' | 'assembling' | 'complete'
let phase: Phase = 'living'
let confirming = false
let colony: Protocell[] = []
let phaseTime = 0
let lineage: Lineage | null = null
/** Formation slot (in cell radii) for each colony cell once assembling. */
const slots = new Map<Protocell, [number, number]>()
let formationAngle = 0
/** Where the camera last focused, so it can rest there if everything dies. */
const focus = { x: 0, y: 0, vx: 0, vy: 0, r: 0, spread: 0 }

/** What the camera follows: the player, or the centre of the colony. */
function updateFocus() {
  if (phase === 'living') {
    focus.x = player.cx
    focus.y = player.cy
    focus.vx = player.cvx
    focus.vy = player.cvy
    focus.r = player.R
    focus.spread = player.R
    return
  }
  if (!colony.length) return
  // Average positions relative to the first cell so the centre is right across the world's seam.
  const ref = colony[0]
  let x = 0
  let y = 0
  let vx = 0
  let vy = 0
  let r = 0
  for (const c of colony) {
    x += wrapDelta(c.cx - ref.cx, WORLD)
    y += wrapDelta(c.cy - ref.cy, WORLD)
    vx += c.cvx
    vy += c.cvy
    r += c.R
  }
  const n = colony.length
  focus.x = wrapCoord(ref.cx + x / n, WORLD)
  focus.y = wrapCoord(ref.cy + y / n, WORLD)
  focus.vx = vx / n
  focus.vy = vy / n
  focus.r = r / n
  let spread = 0
  for (const c of colony) {
    spread = Math.max(spread, Math.hypot(wrapDelta(c.cx - focus.x, WORLD), wrapDelta(c.cy - focus.y, WORLD)) + c.R)
  }
  focus.spread = spread
}
const npcSteer: Steer = { x: 0, y: 0, mag: 0 }

function reset() {
  scale.biomass = 1
  fluid = new Fluid()
  vents = placeVents()
  player = new Protocell(WORLD / 2, WORLD / 2, 1, 'player')
  zones = placeZones(vents, player.cx, player.cy)
  zoneFoodTimer = 0
  cells = [player]
  nutrients = new Nutrients()
  nutrients.seed(player.cx, player.cy, vents)
  dust = new Dust()
  effects = new Effects()
  senses = new Senses()
  eaten = { organic: 0, lipid: 0, mineral: 0 }
  cellsEaten = 0
  peakBiomass = 1
  freeEvolutions = 0
  mutagen = 0
  mutagenNeeded = MUTAGEN_FIRST
  leakTimer = 0
  mutationSlow = 0
  hud.mutation.classList.remove('shown')
  startTime = time
  deathTime = null
  populationTimer = 0
  evolutions = 0
  closeChoice()
  phase = 'living'
  confirming = false
  stickyTarget = null
  colony = []
  slots.clear()
  lineage = null
  hud.prompt.classList.remove('shown')
  hud.lineage.classList.remove('shown')
  hud.banner.classList.remove('shown')
  hud.deathTitle.textContent = 'Membrane ruptured'
  for (let i = 0; i < tuning.grazers; i++) spawnCell('grazer', 300)
  for (let i = 0; i < tuning.engulfers; i++) spawnCell('engulfer', 600)
  updateFocus()
  view.x = player.cx
  view.y = player.cy
  view.zoom = targetZoom()
  hud.death.classList.remove('shown')
  // Prestige unlocks shape the start of every run.
  if (save.unlocks.includes('heritableMutation') && save.inherited) player.addMutation(save.inherited)
  updateHud()
  if (save.unlocks.includes('geneticMemory')) {
    freeEvolutions = 1
    openChoice(evolutionOptions(), 'Genetic Memory', 'Your ancestors remember. Choose where to begin.')
  }
}

/** New cells are sized relative to the player, so the ecosystem keeps pace as you grow. */
function spawnCell(species: Species, minDist: number) {
  const ratio = species === 'engulfer' ? rand(2.8, 4.5) : Math.exp(rand(Math.log(0.12), Math.log(1.3)))
  let x = 0
  let y = 0
  for (let tries = 0; tries < 20; tries++) {
    x = rand(0, WORLD)
    y = rand(0, WORLD)
    const far = Math.hypot(wrapDelta(x - focus.x, WORLD), wrapDelta(y - focus.y, WORLD)) > minDist
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
  // Dividing draws a crowd: extra predators while the colony is vulnerable.
  const engulfers = tuning.engulfers + (phase === 'colony' ? 2 : 0)
  if (alive('engulfer') < engulfers) spawnCell('engulfer', phase === 'colony' ? 450 : 600)
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
  if (phase === 'living') return Math.max(screenRadius() / player.R, minZoom)
  // The colony: small cells shown at a readable size, but always the whole group in frame.
  const cellZoom = (screenRadius() * 0.45) / Math.max(1, focus.r)
  const fitZoom = (Math.min(view.w, view.h) * 0.36) / Math.max(1, focus.spread)
  const z = Math.min(cellZoom, fitZoom)
  return Math.max(phase === 'complete' ? z * 0.8 : z, minZoom)
}

function simulate(dt: number) {
  time += dt
  const alive = deathTime === null
  const living = alive && phase === 'living'
  if (!living) hazardWarning = null
  if (living) aimPseudopod(player, dt)
  if (input.takeDash() && alive && !choosing && !confirming) {
    for (const c of phase === 'living' ? [player] : phase === 'colony' ? colony : []) {
      // The tail's snap throws a slug of water backwards.
      if (!c.dash()) continue
      fluid.push(c.jetX, c.jetY, c.R * 1.3, -c.facingX * 2500, -c.facingY * 2500)
      effects.ripple(c.jetX, c.jetY, c.palette.rim, 0.6)
      sound.whoosh(panAt(c.cx))
      haptic(12)
    }
  }
  updateFocus()
  const colonySteer =
    phase === 'colony' && !confirming ? playerSteer(focus.x, focus.y, focus.r * 2) : { x: 0, y: 0, mag: 0 }
  if (phase === 'assembling' || phase === 'complete') holdFormation(dt)

  for (const cell of cells) {
    if (cell.gone) continue
    let sx = 0
    let sy = 0
    let mag = 0
    if (cell === player) {
      if (!choosing && !confirming) ({ x: sx, y: sy, mag } = playerSteer(cell.cx, cell.cy, cell.R))
    } else if (cell.colony) {
      if (phase === 'colony' && !cell.engulfedBy) ({ x: sx, y: sy, mag } = flock(cell, colonySteer))
    } else if (!cell.engulfedBy) {
      ;({ x: sx, y: sy, mag } = think(cell, dt, cells, nutrients, npcSteer))
      // Other cells steer clear of zones that would hurt them.
      const away = hostileAhead(cell, zones, sx, sy)
      if (away) {
        const ax = sx * mag * 0.25 + away[0]
        const ay = sy * mag * 0.25 + away[1]
        const len = Math.hypot(ax, ay) || 1
        sx = ax / len
        sy = ay / len
        mag = Math.max(mag, 0.75)
      }
    }
    if (!cell.engulfedBy) {
      const exposure = applyHazards(cell, zones, dt)
      if (cell === player && phase === 'living') {
        if (exposure.light > 0) addMutagen(UV_MUTAGEN * exposure.light * dt)
        if (exposure.burn > 0) sound.sizzle(exposure.burn * 20)
        hazardWarning = exposure.worst
      }
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

  nutrients.step(dt, fluid, vents, focus.x, focus.y)
  feed(dt)
  nutrients.sweep()
  if (alive && player.traits.has('chemoreception')) senses.update(dt, focus.x, focus.y, nutrients, vents)
  if (living) checkEvolution()
  if (alive) advanceTransition(dt)
  if (living) mutationEffects(dt)
  if (living) peakBiomass = Math.max(peakBiomass, player.biomass)
  stockZones(dt)
  if (living && needsRescale(player)) {
    const k = rescaleWorld(player, cells, nutrients, vents, fluid, effects)
    rescaleZones(zones, player.cx, player.cy, k)
    // Everything just shrank by k around the player; zoom in by the same amount so the screen doesn't change.
    view.zoom /= k
    view.x = wrapCoord(player.cx + wrapDelta(view.x - player.cx, WORLD) * k, WORLD)
    view.y = wrapCoord(player.cy + wrapDelta(view.y - player.cy, WORLD) * k, WORLD)
  }
  dust.step(dt, fluid)
  effects.step(dt)
  if (alive) maintainPopulation(dt)
}

/** Each hostile zone keeps a stock of the food that makes it worth braving. */
function stockZones(dt: number) {
  zoneFoodTimer -= dt
  if (zoneFoodTimer > 0) return
  zoneFoodTimer = 2.5
  const inside = (z: Zone): [number, number] => {
    const a = rand(0, TAU)
    const d = Math.sqrt(Math.random()) * z.r * 0.75
    return [z.x + Math.cos(a) * d, z.y + Math.sin(a) * d]
  }
  for (const z of zones) {
    if (z.type === 'thermal') {
      if (nutrients.near(z.x, z.y, z.r, 'mineral') < 12)
        for (let i = 0; i < 3; i++) nutrients.spawn('mineral', ...inside(z))
      if (nutrients.near(z.x, z.y, z.r, 'lipid') < 10)
        for (let i = 0; i < 2; i++) nutrients.spawn('lipid', ...inside(z))
    } else if (z.type === 'acid') {
      if (nutrients.near(z.x, z.y, z.r, 'organic') < 60) nutrients.cloud(...inside(z))
    } else if (z.type === 'dark') {
      if (nutrients.near(z.x, z.y, z.r, 'lipid') < 12) nutrients.lipidCluster(...inside(z))
    }
  }
}

/** Cell-vs-cell: swallow anything small enough, otherwise bump membranes. */
function interact() {
  for (let i = 0; i < cells.length; i++) {
    const a = cells[i]
    if (a.engulfedBy || a.gone) continue
    for (let j = i + 1; j < cells.length; j++) {
      const b = cells[j]
      if (b.engulfedBy || b.gone) continue
      // The colony's own cells never eat each other, and once it binds, nothing eats them.
      const safe =
        (a.colony && b.colony) || ((a.colony || b.colony) && (phase === 'assembling' || phase === 'complete'))
      const dx = wrapDelta(b.cx - a.cx, WORLD)
      const dy = wrapDelta(b.cy - a.cy, WORLD)
      const reach = Math.max(a.grabRadius, a.R) + Math.max(b.grabRadius, b.R)
      if (dx > reach || dx < -reach || dy > reach || dy < -reach) continue
      const d = Math.hypot(dx, dy)
      if (d > reach) continue
      // Swallowing starts once the prey's centre reaches the membrane (or a pseudopod); the engulf
      // pulls it the rest of the way. A freshly cracked thick membrane just bounces.
      if (!safe && a.canEat(b) && b.shielded <= 0) {
        if (d < a.grabRadius) eat(a, b)
      } else if (!safe && b.canEat(a) && a.shielded <= 0) {
        if (d < b.grabRadius) eat(b, a)
      } else if (d < a.R + b.R) {
        a.pushOutOf(b)
        b.pushOutOf(a)
        // Spikes tear whatever they ram (or get rammed by) hard enough.
        const nx = dx / (d || 1)
        const ny = dy / (d || 1)
        const closing = (a.cvx - b.cvx) * nx + (a.cvy - b.cvy) * ny
        if ((a === player || b === player || a.colony || b.colony) && closing > 25) {
          sound.thud(closing / 120, panAt(a.cx))
          if (closing > 60) haptic(8)
        }
        if (a.traits.has('spikes')) tear(b, a, closing)
        if (b.traits.has('spikes')) tear(a, b, closing)
      }
    }
  }

  for (const cell of cells) {
    if (cell.gone && cell.engulfedBy && !cell.engulfedBy.gone) cell.engulfedBy.ingestCell(cell)
  }
  cells = cells.filter(c => !c.gone || c === player)
  colony = colony.filter(c => !c.gone && !c.engulfedBy)
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
  if (prey.colony) {
    effects.ripple(prey.cx, prey.cy, prey.palette.rim, 1.2)
    sound.colonyLost(panAt(prey.cx))
    haptic(40)
  }
  if (eater === player) {
    sound.gulp(panAt(prey.cx))
    haptic(25)
    addMutagen(MUTAGEN_CELL)
    cellsEaten++
    updateHud()
  }
}

/** Spikes: knock a chunk of biomass off `victim`; it sprays out as food. */
function tear(victim: Protocell, spiky: Protocell, speed: number) {
  if (speed < SPIKE_MIN_SPEED || victim.spikeImmune > 0 || victim.engulfedBy) return
  victim.spikeImmune = SPIKE_RECOVERY
  const bite = SPIKE_BITE * (spiky.mutations.has('hollowSpines') ? HOLLOW_SPIKE_BITE : 1)
  const lost = victim.biomass * bite * Math.min(1, speed / SPIKE_FULL_SPEED)
  if (spiky.traits.has('venom')) victim.poison = VENOM_TIME
  if (victim === player) addMutagen(MUTAGEN_HURT)
  if (victim === player || spiky === player || victim.colony || spiky.colony) {
    sound.tear(panAt(victim.cx))
    haptic(15)
  }
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
  if (prey === player) addMutagen(MUTAGEN_HURT)
  if (prey === player || prey.colony) {
    sound.clang(panAt(prey.cx))
    haptic([30, 30, 30])
  }
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
/** The hazard currently hurting the player, for the warning line. */
let hazardWarning: Zone['type'] | null = null

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
  recordRun('extinct', [])
  sound.rupture(panAt(cell.cx))
  haptic([60, 40, 140])
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
    const sticky = cell.mutations.has('sticky')
    const reach = R + (sticky ? STICKY_REACH : 8)
    for (const n of nutrients.items) {
      if (n.dead || n.grace > 0 || n.fading || (n.toxic && cell === player)) continue
      const dx = wrapDelta(n.x - cell.cx, WORLD)
      const dy = wrapDelta(n.y - cell.cy, WORLD)
      if (Math.abs(dx) > reach + n.r || Math.abs(dy) > reach + n.r) continue
      const d = Math.hypot(dx, dy) || 0.001
      if (d < R * 0.85) {
        n.dead = true
        cell.ingest(n.kind, cell.cx + dx, cell.cy + dy, n.vx, n.vy)
        if (n.toxic) {
          // Toxic Seep: the leak poisons whatever eats it.
          cell.grow(-n.value * 3)
          cell.poison = Math.max(cell.poison, 1.5)
        } else {
          cell.grow(n.value * (cell === player ? 1 : NPC_GROWTH))
        }
        if (cell === player && n.kind === 'mineral') addMutagen(MUTAGEN_MINERAL)
        if (cell === player) {
          sound.absorb(n.kind, panAt(n.x))
          effects.ripple(n.x, n.y, NUTRIENT_RGB[n.kind])
          eaten[n.kind]++
          updateHud()
        }
      } else if (d < reach + n.r) {
        n.vx -= (dx / d) * tuning.capture * (sticky ? 1.5 : 1) * dt
        n.vy -= (dy / d) * tuning.capture * (sticky ? 1.5 : 1) * dt
      }
    }
  }
}

// ── Mutations ────────────────────────────────────────────────────────────────

function addMutagen(amount: number) {
  if (phase !== 'living' || deathTime !== null) return
  mutagen += amount
  if (mutagen >= mutagenNeeded) mutate()
}

/** Something changes, whether you like it or not (or, with Directed Mutation, which of two ways). */
function mutate(forced?: MutationInfo) {
  const m = forced ?? rollMutation(player.mutations, player.traits)
  if (!m) return
  mutagen = Math.max(0, mutagen - mutagenNeeded)
  mutagenNeeded += MUTAGEN_STEP
  if (!forced && save.unlocks.includes('directedMutation') && !choosing) {
    const other = rollMutation(new Set([...player.mutations, m.id]), player.traits)
    if (other) {
      sound.mutation()
      haptic([20, 60, 20])
      openCards(
        'Mutation',
        'Something in you is changing. You can steer which way.',
        [m, other].map(option => ({
          icon: MUTATION_ICON,
          name: option.name,
          tagline: `+ ${option.good}`,
          detail: `− ${option.bad}`,
          pick: () => {
            closeChoice()
            applyMutation(option)
          },
        })),
        true,
      )
      return
    }
  }
  applyMutation(m)
}

const MUTATION_ICON =
  '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">' +
  '<circle cx="32" cy="32" r="15"/><path d="M24 22c6 4 10 16 16 20M40 22c-6 4-10 16-16 20" stroke-width="2"/></svg>'

function applyMutation(m: MutationInfo) {
  player.addMutation(m.id)
  mutationSlow = 0.8
  sound.mutation()
  haptic([20, 60, 20])
  effects.ripple(player.cx, player.cy, '200,140,255', 1.2)
  hud.mutationName.textContent = m.name
  hud.mutationGood.textContent = m.good
  hud.mutationBad.textContent = m.bad
  hud.mutation.classList.remove('shown')
  void hud.mutation.offsetWidth // restart the fade if one is already showing
  hud.mutation.classList.add('shown')
  clearTimeout(mutationToast)
  mutationToast = setTimeout(() => hud.mutation.classList.remove('shown'), 5000)
  updateHud()
}
let mutationToast: ReturnType<typeof setTimeout> | undefined

/** Ongoing mutation effects that need the world: leaking, and buds popping off. */
function mutationEffects(dt: number) {
  if (player.mutations.has('porous')) {
    leakTimer -= dt
    if (leakTimer <= 0) {
      leakTimer = POROUS_INTERVAL
      const amount = scale.biomass * POROUS_LEAK * POROUS_INTERVAL
      player.grow(-amount)
      // Seeps out of the trailing side.
      const v = Math.hypot(player.cvx, player.cvy)
      const bx = v > 5 ? -player.cvx / v : rand(-1, 1)
      const by = v > 5 ? -player.cvy / v : rand(-1, 1)
      const n = nutrients.spawn(
        'organic',
        player.cx + bx * player.R,
        player.cy + by * player.R,
        player.cvx * 0.3 + bx * 20,
        player.cvy * 0.3 + by * 20,
        1.5,
        amount,
      )
      n.toxic = player.traits.has('toxic')
    }
  }
  if (player.mutations.has('mitosis') && player.budTimer <= 0) popBud(player)
}

/** Unstable Mitosis: the bud pinches off as a daughter cell with a fifth of the parent. */
function popBud(cell: Protocell) {
  const share = cell.biomass * MITOSIS_SHARE
  cell.grow(-share)
  const [bx, by] = cell.budDir
  const daughter = new Protocell(cell.cx + bx * cell.R * 1.15, cell.cy + by * cell.R * 1.15, share, 'offspring')
  daughter.brain = newBrain()
  for (const p of daughter.pts) {
    p.vx = cell.cvx + bx * 70
    p.vy = cell.cvy + by * 70
  }
  daughter.spikeImmune = 1
  cells.push(daughter)
  cell.resetBud()
  effects.ripple(daughter.cx, daughter.cy, cell.palette.rim, 0.8)
  updateHud()
}

// ── The Great Transition ─────────────────────────────────────────────────────

function transitionReady() {
  return (
    phase === 'living' &&
    deathTime === null &&
    !choosing &&
    evolutions >= TRANSITION_EVOLUTIONS &&
    player.biomass >= TRANSITION_BIOMASS
  )
}

function openConfirm() {
  if (!transitionReady() || confirming) return
  confirming = true
  input.release()
  hud.prompt.classList.add('shown')
}

function closeConfirm() {
  confirming = false
  hud.prompt.classList.remove('shown')
}

/** Divide the body into a colony of small cells that inherit every adaptation. */
function beginTransition() {
  closeConfirm()
  if (phase !== 'living' || deathTime !== null) return
  phase = 'colony'
  phaseTime = 0
  input.release()
  sound.transitionBegin()
  haptic(80)
  const traits = [...player.traits]
  const each = (player.biomass * COLONY_SHARE) / COLONY_CELLS
  for (let i = 0; i < COLONY_CELLS; i++) {
    const a = (i / COLONY_CELLS) * TAU
    const c = new Protocell(
      player.cx + Math.cos(a) * player.R * 0.45,
      player.cy + Math.sin(a) * player.R * 0.45,
      each,
      'player',
    )
    c.colony = true
    for (const t of traits) c.addTrait(t)
    for (const p of c.pts) {
      p.vx = player.cvx + Math.cos(a) * 45
      p.vy = player.cvy + Math.sin(a) * 45
    }
    cells.push(c)
    colony.push(c)
  }
  // The old membrane splits apart.
  player.gone = true
  for (let i = 0; i < player.pts.length; i += 2) {
    const p = player.pts[i]
    const a = Math.atan2(p.y - player.cy, p.x - player.cx)
    effects.shard(
      p.x,
      p.y,
      player.cvx + Math.cos(a) * 60,
      player.cvy + Math.sin(a) * 60,
      a,
      player.R * 0.3,
      player.palette.rim,
    )
  }
  effects.ripple(player.cx, player.cy, player.palette.rim, 1.4)
  // Everything nearby notices: predators drop what they were doing.
  for (const c of cells) if (c.brain) c.brain.rest = 0
  updateFocus()
  updateBanner()
  hud.banner.classList.add('shown')
}

const flockSteer: Steer = { x: 0, y: 0, mag: 0 }

/** Colony steering: your input, plus staying together and not piling on top of each other. */
function flock(cell: Protocell, steer: Steer) {
  let x = steer.x * steer.mag
  let y = steer.y * steer.mag
  const dx = wrapDelta(focus.x - cell.cx, WORLD)
  const dy = wrapDelta(focus.y - cell.cy, WORLD)
  const d = Math.hypot(dx, dy) || 1
  const pull = clamp((d - cell.R * 2.5) / (cell.R * 4), 0, 1)
  x += (dx / d) * pull * 0.9
  y += (dy / d) * pull * 0.9
  for (const other of colony) {
    if (other === cell) continue
    const ox = wrapDelta(cell.cx - other.cx, WORLD)
    const oy = wrapDelta(cell.cy - other.cy, WORLD)
    const od = Math.hypot(ox, oy) || 1
    const room = (cell.R + other.R) * 1.25
    if (od >= room) continue
    const push = 1 - od / room
    x += (ox / od) * push * 0.8
    y += (oy / od) * push * 0.8
  }
  const len = Math.hypot(x, y)
  flockSteer.x = len > 0 ? x / len : 0
  flockSteer.y = len > 0 ? y / len : 0
  flockSteer.mag = len < 0.05 ? 0 : Math.min(1, len)
  return flockSteer
}

function advanceTransition(dt: number) {
  if (phase === 'colony') {
    phaseTime += dt
    if (colony.length < MIN_SURVIVORS) failTransition()
    else if (phaseTime >= TRANSITION_TIME) beginAssembly()
    else updateBanner()
  } else if (phase === 'assembling') {
    phaseTime += dt
    if (phaseTime >= ASSEMBLY_TIME) completeTransition()
  }
}

let bannerText = ''
function updateBanner() {
  const left = Math.max(0, Math.ceil(TRANSITION_TIME - phaseTime))
  const text =
    phase === 'colony'
      ? `Hold together · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} · ${colony.length} cells`
      : 'Binding…'
  if (text !== bannerText) hud.banner.textContent = bannerText = text
}

/** The minute is up: survivors pull into the shape of the organism they're becoming. */
function beginAssembly() {
  phase = 'assembling'
  phaseTime = 0
  lineage = lineageFor([...player.traits])
  const offsets = formationOffsets(lineage.formation, colony.length)
  formationAngle = Math.hypot(focus.vx, focus.vy) > 5 ? Math.atan2(focus.vy, focus.vx) : 0
  // Greedy: each slot takes the nearest cell not yet placed.
  slots.clear()
  const free = new Set(colony)
  const cos = Math.cos(formationAngle)
  const sin = Math.sin(formationAngle)
  for (const [ox, oy] of offsets) {
    const tx = (ox * cos - oy * sin) * focus.r
    const ty = (ox * sin + oy * cos) * focus.r
    let best: Protocell | null = null
    let bestD = Infinity
    for (const c of free) {
      const d = Math.hypot(wrapDelta(c.cx - focus.x, WORLD) - tx, wrapDelta(c.cy - focus.y, WORLD) - ty)
      if (d < bestD) {
        best = c
        bestD = d
      }
    }
    if (best) {
      slots.set(best, [ox, oy])
      free.delete(best)
    }
  }
  // Predators lose interest in something this large and coordinated.
  for (const c of cells) {
    if (!c.brain) continue
    c.brain.prey = null
    c.brain.rest = 30
  }
  updateBanner()
}

/** Spring each colony cell toward its slot; strength ramps up over the assembly. */
function holdFormation(dt: number) {
  const k = phase === 'complete' ? 1 : Math.min(1, phaseTime / ASSEMBLY_TIME)
  const cos = Math.cos(formationAngle)
  const sin = Math.sin(formationAngle)
  for (const c of colony) {
    const slot = slots.get(c)
    if (!slot) continue
    const tx = focus.x + (slot[0] * cos - slot[1] * sin) * focus.r
    const ty = focus.y + (slot[0] * sin + slot[1] * cos) * focus.r
    const ax = (wrapDelta(tx - c.cx, WORLD) * 6 - (c.cvx - focus.vx) * 3) * k
    const ay = (wrapDelta(ty - c.cy, WORLD) * 6 - (c.cvy - focus.vy) * 3) * k
    for (const p of c.pts) {
      p.vx += ax * dt
      p.vy += ay * dt
    }
  }
}

/** Remember a finished run on the Tree of Life (and bank its DNA). */
function recordRun(outcome: RunRecord['outcome'], dna: DnaLine[], name = '', form = '') {
  peakBiomass = Math.max(peakBiomass, player.biomass)
  const total = dna.reduce((sum, l) => sum + l.amount, 0)
  save.runs.push({
    outcome,
    generation: save.generation,
    name,
    form,
    traits: [...player.traits],
    mutations: [...player.mutations],
    seconds: Math.round(time - startTime),
    peakBiomass,
    cellsEaten,
    dna: total,
    date: Date.now(),
  })
  save.dna += total
  if (outcome === 'lineage') save.generation++
  writeSave(save)
  updateHud()
  return total
}

function mutationList() {
  const names = [...player.mutations].map(id => MUTATIONS[id].name)
  return names.length ? `Mutations: ${names.join(', ')}` : ''
}

function completeTransition() {
  phase = 'complete'
  sound.transitionComplete()
  haptic([30, 50, 30, 50, 90])
  hud.banner.classList.remove('shown')
  const result = lineage ?? lineageFor([...player.traits])
  const discovered = recordLineage(result.name)
  const seconds = Math.round(time - startTime)
  hud.lineageName.textContent = result.name
  hud.lineageForm.textContent = `It became ${result.form}.`
  hud.lineageMutations.textContent = mutationList()
  hud.lineageStats.textContent =
    `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} · peak biomass ×${peakBiomass.toFixed(1)} · ` +
    `${cellsEaten} cells absorbed · ${evolutions} evolutions · ${colony.length} of ${COLONY_CELLS} cells survived`
  hud.lineageDiscovered.textContent =
    discovered === null ? '' : `${discovered} ${discovered === 1 ? 'lineage' : 'lineages'} discovered`
  peakBiomass = Math.max(peakBiomass, player.biomass)
  const dna = dnaFor({
    cellsEaten,
    evolutions,
    mutations: player.mutations.size,
    survivors: colony.length,
    peakBiomass,
  })
  const total = recordRun('lineage', dna, result.name, result.form)
  hud.lineageDna.textContent = `+${total} DNA  (${dna.map(l => `${l.label.toLowerCase()} ${l.amount}`).join(' · ')})`
  hud.lineage.classList.add('shown')
  effects.ripple(focus.x, focus.y, player.palette.rim, 2)
}

function failTransition() {
  deathTime = time
  recordRun('extinct', [])
  sound.rupture(0)
  hud.banner.classList.remove('shown')
  const seconds = Math.round(time - startTime)
  hud.deathTitle.textContent = 'The colony was devoured'
  hud.deathCause.textContent = `Only ${colony.length} of ${COLONY_CELLS} cells were left; it takes ${MIN_SURVIVORS} to bind.`
  hud.deathStats.textContent =
    `Survived ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} · ` +
    `peak biomass ×${player.biomass.toFixed(2)} · ${cellsEaten} cells absorbed`
  hud.death.classList.add('shown')
}

/** Membrane bridges between neighbouring colony cells as they bind. */
function drawBridges() {
  if (phase !== 'assembling' && phase !== 'complete') return
  const k = phase === 'complete' ? 1 : Math.min(1, phaseTime / ASSEMBLY_TIME)
  const z = view.zoom
  ctx.lineCap = 'round'
  for (let i = 0; i < colony.length; i++) {
    const a = colony[i]
    const ax = view.sx(a.cx)
    const ay = view.sy(a.cy)
    for (let j = i + 1; j < colony.length; j++) {
      const b = colony[j]
      const dx = wrapDelta(b.cx - a.cx, WORLD)
      const dy = wrapDelta(b.cy - a.cy, WORLD)
      if (Math.hypot(dx, dy) > (a.R + b.R) * 1.35) continue
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.lineTo(ax + dx * z, ay + dy * z)
      ctx.lineWidth = Math.min(a.R, b.R) * z * 1.1 * k
      ctx.strokeStyle = `rgba(${a.palette.body},${0.28 * k})`
      ctx.stroke()
      ctx.lineWidth = Math.max(1, Math.min(a.R, b.R) * z * 0.12)
      ctx.strokeStyle = `rgba(${a.palette.rim},${0.5 * k})`
      ctx.stroke()
    }
  }
}

function nextEvolutionCost() {
  return EVOLUTION_COST[clamp(evolutions - freeEvolutions, 0, EVOLUTION_COST.length - 1)]
}

/** Traits the player could still evolve, in random order: three, or four with Wider Options. */
function evolutionOptions(): TraitInfo[] {
  const open = availableTraits(player.traits, player.mutations)
  for (let i = open.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[open[i], open[j]] = [open[j], open[i]]
  }
  return open.slice(0, save.unlocks.includes('widerOptions') ? 4 : 3)
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

interface CardSpec {
  icon: string
  name: string
  /** Small caps line under the name, e.g. what it evolves from. */
  note?: string
  tagline: string
  detail: string
  pick: () => void
}

/** Slow time and lay out cards to choose from (evolutions, or mutations with Directed Mutation). */
function openCards(title: string, subtitle: string, specs: CardSpec[], mutant = false) {
  choosing = true
  input.release()
  hud.evolveTitle.textContent = title
  hud.evolveSubtitle.textContent = subtitle
  hud.evolve.classList.toggle('mutant', mutant)
  hud.cards.replaceChildren(
    ...specs.map((spec, i) => {
      const card = document.createElement('button')
      card.className = 'card'
      card.innerHTML =
        `<span class="icon">${spec.icon}</span>` +
        `<span class="name">${spec.name}</span>` +
        (spec.note ? `<span class="lineage">${spec.note}</span>` : '') +
        `<span class="tagline">${spec.tagline}</span>` +
        `<span class="detail">${spec.detail}</span>` +
        `<span class="key">${i + 1}</span>`
      card.addEventListener('click', spec.pick)
      return card
    }),
  )
  hud.evolve.classList.add('shown')
}

function openChoice(
  options: TraitInfo[],
  title = 'Evolution',
  subtitle = 'Your protocell has gathered enough minerals to change.',
) {
  if (!options.length) return
  openCards(
    title,
    subtitle,
    options.map(trait => ({
      icon: TRAIT_ICONS[trait.id],
      name: trait.name,
      note: trait.requires
        ? `evolves from ${TRAITS[trait.requires].name}`
        : trait.requiresMutation
          ? `from your ${MUTATIONS[trait.requiresMutation].name}`
          : undefined,
      tagline: trait.tagline,
      detail: trait.detail,
      pick: () => choose(trait.id),
    })),
  )
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
  sound.evolve()
  haptic(30)
  input.release()
  effects.ripple(player.cx, player.cy, player.palette.rim, 1.2)
  updateHud()
}

const svg = (body: string) =>
  `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">${body}</svg>`

const TRAIT_ICONS: Record<TraitId, string> = {
  thermophile: svg(
    '<circle cx="32" cy="38" r="12"/><path d="M22 20c0-5 4-5 4-10M32 18c0-5 4-5 4-10M42 20c0-5 4-5 4-10" stroke-width="2"/>',
  ),
  acidResistance: svg(
    '<circle cx="32" cy="32" r="16"/><circle cx="32" cy="32" r="11" stroke-width="1.5"/><circle cx="14" cy="50" r="3"/><circle cx="50" cy="14" r="2.5"/><circle cx="52" cy="48" r="2"/>',
  ),
  pigment: svg(
    '<circle cx="32" cy="34" r="13"/><path d="M32 34m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0" fill="currentColor" opacity="0.5"/><path d="M14 8l8 10M30 6l3 10M48 8l-6 10" stroke-width="2"/>',
  ),
  mechanoreception: svg(
    '<circle cx="22" cy="32" r="9"/><path d="M36 22c5 6 5 14 0 20M44 16c8 9 8 23 0 32" stroke-width="2"/><circle cx="56" cy="32" r="3"/>',
  ),
  sealed: svg('<circle cx="32" cy="32" r="16"/><path d="M24 32l6 6 11-13"/>'),
  toxic: svg(
    '<circle cx="24" cy="30" r="12"/><circle cx="44" cy="40" r="3"/><circle cx="52" cy="46" r="2.2"/><circle cx="40" cy="50" r="2"/>' +
      '<path d="M20 28l8 4M28 28l-8 4" stroke-width="2"/>',
  ),
  venom: svg(
    '<circle cx="26" cy="32" r="11"/><path d="M37 32h18M50 27l5 5-5 5"/><circle cx="45" cy="32" r="2.5" fill="currentColor"/>',
  ),
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

/** 0..1: how strongly something much bigger than you is bearing down (drives the rumble). */
function looming() {
  if (deathTime !== null || phase === 'complete') return 0
  let most = 0
  for (const c of cells) {
    if (c === player || c.colony || c.gone || c.engulfedBy) continue
    const size = clamp((c.R / focus.r - 1.3) / 2, 0, 1)
    if (size <= 0) continue
    const d = Math.hypot(wrapDelta(c.cx - focus.x, WORLD), wrapDelta(c.cy - focus.y, WORLD))
    const near = clamp(1 - (d - c.R) / (c.R * 3 + 220), 0, 1)
    most = Math.max(most, size * near)
  }
  return most
}

function updateCamera(dt: number) {
  // Follow with a little lag and look-ahead, so speed reads as the cell drifting off-centre.
  const k = 1 - Math.exp(-4 * dt)
  const lead = deathTime === null && phase !== 'complete' ? 0.25 : 0
  view.x = wrapCoord(view.x + wrapDelta(focus.x + focus.vx * lead - view.x, WORLD) * k, WORLD)
  view.y = wrapCoord(view.y + wrapDelta(focus.y + focus.vy * lead - view.y, WORLD) * k, WORLD)
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
  drawZones(ctx, view, zones, time)
  for (const vent of vents) vent.draw(ctx, view, time)
  nutrients.draw(ctx, view, time)
  // Cells being swallowed draw on top of whatever is swallowing them; the player draws above its peers.
  for (const cell of cells) if (!cell.engulfedBy && cell !== player && !cell.colony) cell.draw(ctx, view)
  drawBridges()
  for (const cell of colony) cell.draw(ctx, view)
  if (!player.gone) player.draw(ctx, view)
  for (const cell of cells) if (cell.engulfedBy) cell.draw(ctx, view)
  drawTendril()
  effects.draw(ctx, view)
  let dark = 0
  for (const z of zones) if (z.type === 'dark') dark = Math.max(dark, z.strengthAt(focus.x, focus.y))
  drawDarkness(
    ctx,
    view,
    zones,
    { x: focus.x, y: focus.y, r: focus.r, dark, mechano: player.traits.has('mechanoreception') },
    cells,
    time,
  )
  drawZoneLabels(ctx, view, zones, player.traits, focus.x, focus.y)
  drawStickyIndicator()
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
  evolveTitle: document.querySelector<HTMLElement>('#evolve h1')!,
  evolveSubtitle: document.querySelector<HTMLElement>('#evolve > p')!,
  generation: document.querySelector<HTMLElement>('#generation b')!,
  lineageDna: document.querySelector<HTMLElement>('#lineage .dna')!,
  treeBtn: document.querySelector<HTMLButtonElement>('#tree-btn')!,
  tree: document.querySelector<HTMLElement>('#tree')!,
  deathTitle: document.querySelector<HTMLElement>('#death h1')!,
  transitionBtn: document.querySelector<HTMLButtonElement>('#transition-btn')!,
  banner: document.querySelector<HTMLElement>('#banner')!,
  prompt: document.querySelector<HTMLElement>('#prompt')!,
  lineage: document.querySelector<HTMLElement>('#lineage')!,
  lineageName: document.querySelector<HTMLElement>('#lineage .name')!,
  lineageForm: document.querySelector<HTMLElement>('#lineage .form')!,
  lineageStats: document.querySelector<HTMLElement>('#lineage .stats')!,
  lineageDiscovered: document.querySelector<HTMLElement>('#lineage .discovered')!,
  goal: document.querySelector<HTMLElement>('#goal b')!,
  hazard: document.querySelector<HTMLElement>('#hazard')!,
  sound: document.querySelector<HTMLButtonElement>('#sound')!,
  mutations: document.querySelector<HTMLElement>('#mutations')!,
  mutation: document.querySelector<HTMLElement>('#mutation')!,
  mutationName: document.querySelector<HTMLElement>('#mutation .name')!,
  mutationGood: document.querySelector<HTMLElement>('#mutation .good')!,
  mutationBad: document.querySelector<HTMLElement>('#mutation .bad')!,
  lineageMutations: document.querySelector<HTMLElement>('#lineage .mutations')!,
  cards: document.querySelector<HTMLElement>('#evolve .cards')!,
}

function updateHud() {
  hud.generation.textContent = `${save.generation} · ${save.dna} DNA`
  hud.mutations.textContent = [...player.mutations].map(id => MUTATIONS[id].name).join(' · ')
  hud.organic.textContent = String(eaten.organic)
  hud.lipid.textContent = String(eaten.lipid)
  const more = availableTraits(player.traits, player.mutations).length > 0
  hud.mineral.textContent = more ? `${eaten.mineral} / ${nextEvolutionCost()}` : String(eaten.mineral)
  hud.biomass.textContent = `×${player.biomass.toFixed(2)}`
  hud.goal.textContent =
    `${Math.min(evolutions, TRANSITION_EVOLUTIONS)}/${TRANSITION_EVOLUTIONS} evolutions · ` +
    `×${Math.min(player.biomass, TRANSITION_BIOMASS).toFixed(1)}/×${TRANSITION_BIOMASS}`
}

const tree = new TreeOfLife(hud.tree, save, () => updateHud())

function openTree() {
  if (choosing || confirming) return
  input.release()
  tree.open()
}

/** After dying, any tap or key starts a new protocell (with a short pause so the burst can play). */
function tryRestart(e: Event) {
  if (tree.isOpen) return
  if (e instanceof KeyboardEvent && ['l', 'm', 'escape'].includes(e.key.toLowerCase())) return
  if (deathTime !== null && time - deathTime > 1.2) reset()
}
hud.treeBtn.addEventListener('click', openTree)
hud.lineage.querySelector('[data-action="tree"]')!.addEventListener('click', openTree)
window.addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
  const key = e.key.toLowerCase()
  if (key === 'l') {
    if (tree.isOpen) tree.close()
    else openTree()
  } else if (key === 'escape' && tree.isOpen) {
    tree.close()
  }
})
function toggleSound() {
  const muted = sound.toggleMute()
  hud.sound.textContent = muted ? 'sound off' : 'sound on'
}
hud.sound.textContent = sound.muted ? 'sound off' : 'sound on'
hud.sound.addEventListener('click', toggleSound)
window.addEventListener('keydown', e => {
  if (e.key.toLowerCase() === 'm' && !(e.target instanceof HTMLInputElement)) toggleSound()
})

canvas.addEventListener('pointerdown', tryRestart)
window.addEventListener('keydown', tryRestart)

hud.transitionBtn.addEventListener('click', openConfirm)
hud.prompt.querySelector('[data-action="begin"]')!.addEventListener('click', beginTransition)
hud.prompt.querySelector('[data-action="cancel"]')!.addEventListener('click', closeConfirm)
hud.lineage.querySelector('[data-action="again"]')!.addEventListener('click', () => reset())
window.addEventListener('keydown', e => {
  if (confirming && e.key === 'Enter') beginTransition()
  else if (confirming && e.key === 'Escape') closeConfirm()
  else if (phase === 'complete' && e.key === 'Enter') reset()
  else if (e.key.toLowerCase() === 't' && transitionReady()) openConfirm()
})

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
gui
  .add(input, 'sticky')
  .name('sticky movement')
  .onChange(() => {
    input.stickyDir = null
    stickyTarget = null
  })
gui.add({ volume: 0.7 }, 'volume', 0, 1).onChange((v: number) => sound.setVolume(v))
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
  mutationSlow = Math.max(0, mutationSlow - elapsed)
  if (tree.isOpen) acc = 0
  else
    acc +=
      elapsed * (choosing || confirming ? CHOICE_TIME_SCALE : phase === 'complete' ? 0.5 : mutationSlow > 0 ? 0.3 : 1)
  let steps = 0
  while (acc >= STEP && steps < 3) {
    simulate(STEP)
    acc -= STEP
    steps++
  }
  if (steps === 3) acc = 0
  updateFocus()
  updateCamera(elapsed)
  render()
  sound.update(looming())
  const warning =
    hazardWarning && deathTime === null ? `${ZONES[hazardWarning].warning} · ${ZONES[hazardWarning].label}` : ''
  if (hud.hazard.textContent !== warning) {
    hud.hazard.textContent = warning
    hud.hazard.style.color = hazardWarning ? `rgb(${ZONES[hazardWarning].rgb})` : ''
  }
  hud.transitionBtn.classList.toggle('shown', transitionReady() && !confirming)

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
      mutate(id?: MutationId) {
        mutate(id ? MUTATIONS[id] : undefined)
      },
      evolve(id: TraitId) {
        player.addTrait(id)
        updateHud()
      },
      /** Skip ahead to the Great Transition: evolve to the requirement and grow. */
      readyTransition() {
        while (evolutions < TRANSITION_EVOLUTIONS && availableTraits(player.traits, player.mutations).length) {
          player.addTrait(availableTraits(player.traits, player.mutations)[0].id)
          evolutions++
        }
        player.grow(Math.max(0, TRANSITION_BIOMASS - player.biomass))
        updateHud()
      },
      beginTransition() {
        openConfirm()
        beginTransition()
      },
      /** Jump to the end of the current transition stage (survival minute or assembly). */
      skipTimer() {
        phaseTime = (phase === 'colony' ? TRANSITION_TIME : ASSEMBLY_TIME) - 0.05
      },
      get colony() {
        return colony
      },
      sound,
      get zones() {
        return zones
      },
      /** Teleport the player into the first zone of a type. */
      goto(type: Zone['type']) {
        const z = zones.find(zone => zone.type === type)
        if (!z) return
        const dx = z.x - player.cx
        const dy = z.y - player.cy
        for (const p of player.pts) {
          p.x += dx
          p.y += dy
        }
        for (const b of [...player.inner, ...player.digesting]) {
          b.x += dx
          b.y += dy
        }
        player.flagellum?.shift(dx, dy)
        player.cx = z.x
        player.cy = z.y
        view.x = z.x
        view.y = z.y
      },
      get nutrients() {
        return nutrients
      },
      get phase() {
        return phase
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
