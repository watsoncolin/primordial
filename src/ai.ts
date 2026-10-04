import { WORLD, tuning } from './config'
import { TAU, rand, wrapDelta } from './math'
import type { Nutrient, Nutrients } from './nutrients'
import type { Protocell } from './protocell'

const RETARGET = 0.4
const GRAZER_SENSE = 260
const FLEE_SENSE = 100
/** Seconds a cell can sprint away before tiring, and how long it stays tired. */
const FLEE_STAMINA = 2.5
const EXHAUSTED_TIME = 2
const EXHAUSTED_EFFORT = 0.35
/** Engulfers lunge when prey is this close to their membrane. */
const LUNGE_RANGE = 80
const LUNGE_TIME = 0.9
const LUNGE_COOLDOWN = 3

export interface Brain {
  heading: number
  retarget: number
  food: Nutrient | null
  prey: Protocell | null
  chaseTime: number
  rest: number
  lunge: number
  lungeCooldown: number
  fleeTime: number
  exhausted: number
}

export function newBrain(): Brain {
  return {
    heading: rand(0, TAU),
    retarget: rand(0, RETARGET),
    food: null,
    prey: null,
    chaseTime: 0,
    rest: 0,
    lunge: 0,
    lungeCooldown: 0,
    fleeTime: 0,
    exhausted: 0,
  }
}

export interface Steer {
  x: number
  y: number
  mag: number
}

/**
 * Simple steering for non-player cells. Everyone flees what can eat them; grazers chase food
 * (and anything small enough to swallow); engulfers hunt cells until they tire, then rest.
 */
export function think(cell: Protocell, dt: number, cells: Protocell[], nutrients: Nutrients, out: Steer) {
  const brain = cell.brain!
  brain.rest = Math.max(0, brain.rest - dt)
  brain.lunge = Math.max(0, brain.lunge - dt)
  brain.lungeCooldown = Math.max(0, brain.lungeCooldown - dt)
  cell.boost = brain.lunge > 0 ? tuning.engulferLunge : 1

  const threat = nearestCell(cell, cells, FLEE_SENSE + cell.R, other => other.canEat(cell))
  brain.exhausted = Math.max(0, brain.exhausted - dt)
  if (threat) {
    steerAt(cell, threat.cx, threat.cy, -1, out)
    brain.prey = null
    // Sprinting away burns out; a persistent chaser gets its chance.
    if (brain.exhausted > 0) {
      out.mag = EXHAUSTED_EFFORT
    } else {
      brain.fleeTime += dt
      if (brain.fleeTime > FLEE_STAMINA) {
        brain.fleeTime = 0
        brain.exhausted = EXHAUSTED_TIME
      }
    }
    return out
  }
  brain.fleeTime = Math.max(0, brain.fleeTime - dt * 0.5)

  brain.retarget -= dt
  if (brain.retarget <= 0) {
    brain.retarget = RETARGET
    const sense = cell.species === 'engulfer' ? tuning.engulferSense : GRAZER_SENSE * 0.5
    brain.prey = brain.rest > 0 ? null : nearestCell(cell, cells, sense + cell.R, other => cell.canEat(other))
    brain.food = nearestFood(cell, nutrients, GRAZER_SENSE)
  }

  const prey = brain.prey
  if (prey && !prey.engulfedBy && !prey.gone) {
    steerAt(cell, prey.cx, prey.cy, 1, out)
    if (cell.species === 'engulfer') {
      // Cruise slowly, then a short burst once the prey is close.
      const gap = Math.hypot(wrapDelta(prey.cx - cell.cx, WORLD), wrapDelta(prey.cy - cell.cy, WORLD)) - cell.R - prey.R
      if (gap < LUNGE_RANGE && brain.lungeCooldown <= 0) {
        brain.lunge = LUNGE_TIME
        brain.lungeCooldown = LUNGE_COOLDOWN + LUNGE_TIME
      }
      brain.chaseTime += dt
      if (brain.chaseTime > tuning.engulferStamina) {
        brain.chaseTime = 0
        brain.rest = 3
        brain.prey = null
      }
    }
    return out
  }
  brain.chaseTime = Math.max(0, brain.chaseTime - dt)

  const food = brain.food
  if (food && !food.dead) {
    steerAt(cell, food.x, food.y, 1, out)
    out.mag = cell.species === 'engulfer' ? 0.45 : 0.75
    return out
  }

  // Wander: a slowly turning heading at low effort.
  brain.heading += (Math.random() - 0.5) * 3 * dt
  out.x = Math.cos(brain.heading)
  out.y = Math.sin(brain.heading)
  out.mag = 0.3
  return out
}

/** Point `out` toward (sign 1) or away from (sign -1) a world position. */
function steerAt(cell: Protocell, x: number, y: number, sign: number, out: Steer) {
  const dx = wrapDelta(x - cell.cx, WORLD) * sign
  const dy = wrapDelta(y - cell.cy, WORLD) * sign
  const d = Math.hypot(dx, dy) || 1
  out.x = dx / d
  out.y = dy / d
  out.mag = 1
  cell.brain!.heading = Math.atan2(out.y, out.x)
}

function nearestCell(cell: Protocell, cells: Protocell[], range: number, accept: (other: Protocell) => boolean) {
  let best: Protocell | null = null
  let bestD = range * range
  for (const other of cells) {
    if (other === cell || other.engulfedBy || other.gone) continue
    const dx = wrapDelta(other.cx - cell.cx, WORLD)
    const dy = wrapDelta(other.cy - cell.cy, WORLD)
    const d2 = dx * dx + dy * dy
    if (d2 < bestD && accept(other)) {
      best = other
      bestD = d2
    }
  }
  return best
}

function nearestFood(cell: Protocell, nutrients: Nutrients, range: number) {
  let best: Nutrient | null = null
  let bestD = range * range
  for (const n of nutrients.items) {
    if (n.kind === 'mineral' || n.fading) continue
    const dx = wrapDelta(n.x - cell.cx, WORLD)
    if (dx > range || dx < -range) continue
    const dy = wrapDelta(n.y - cell.cy, WORLD)
    const d2 = dx * dx + dy * dy
    if (d2 < bestD) {
      best = n
      bestD = d2
    }
  }
  return best
}
