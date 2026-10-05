import { WORLD, tuning } from './config'
import { TAU, rand, wrapDelta } from './math'
import type { Nutrient, Nutrients } from './nutrients'
import type { Protocell } from './protocell'
import { LURE_EFFORT, LURE_RANGE } from './traits'
import type { Zone } from './biomes'
import type { Vent } from './vents'

/** The world features roles care about; main keeps this current. */
export const aiWorld: { zones: Zone[]; vents: Vent[] } = { zones: [], vents: [] }

/** Hunters circle food clouds within this range when they have no prey. */
const PATROL_RANGE = 450

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
/** The tell before a lunge (tail coils, body points at the prey), and the slack recovery after it. */
export const COIL_TIME = 0.4
export const RECOVER_TIME = 1.2
const RECOVER_EFFORT = 0.12

export interface Brain {
  heading: number
  retarget: number
  food: Nutrient | null
  prey: Protocell | null
  chaseTime: number
  rest: number
  lunge: number
  lungeCooldown: number
  coil: number
  recover: number
  fleeTime: number
  exhausted: number
  attacker: Protocell | null
  alarm: number
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
    coil: 0,
    recover: 0,
    fleeTime: 0,
    exhausted: 0,
    attacker: null,
    alarm: 0,
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
  cell.leanWant = 0
  brain.alarm = Math.max(0, brain.alarm - dt)
  if (brain.alarm <= 0 || brain.attacker?.gone || brain.attacker?.engulfedBy) brain.attacker = null
  // Anchored filter feeders don't swim; they turn into the current (main aims them).
  if (cell.species === 'filter') {
    out.x = out.y = out.mag = 0
    return out
  }
  brain.rest = Math.max(0, brain.rest - dt)
  brain.lungeCooldown = Math.max(0, brain.lungeCooldown - dt)
  // Lunge sequence: coil (the warning) → lunge → recovery.
  if (brain.coil > 0) {
    brain.coil -= dt
    if (brain.coil <= 0) {
      brain.coil = 0
      brain.lunge = LUNGE_TIME
    }
  } else if (brain.lunge > 0) {
    brain.lunge -= dt
    if (brain.lunge <= 0) {
      brain.lunge = 0
      brain.recover = RECOVER_TIME
    }
  } else {
    brain.recover = Math.max(0, brain.recover - dt)
  }
  cell.boost = brain.lunge > 0 ? tuning.engulferLunge : 1
  cell.pose = brain.coil > 0 ? 'coil' : brain.lunge > 0 ? 'lunge' : brain.recover > 0 ? 'recover' : 'idle'
  if (brain.recover > 0) {
    // Spent: drifts slack for a moment, an opening for anything quick enough to use it.
    out.x = Math.cos(brain.heading)
    out.y = Math.sin(brain.heading)
    out.mag = RECOVER_EFFORT
    return out
  }

  // Injured prey abandon food; a hunter that can swallow its attacker retaliates.
  if (brain.attacker && !(cell.species === 'engulfer' && cell.canEat(brain.attacker))) {
    steerAt(cell, brain.attacker.cx, brain.attacker.cy, -1, out)
    out.mag = cell.species === 'producer' ? 0.5 : 1
    brain.prey = null
    return out
  }

  // A bioluminescent lure that could eat this cell mesmerises it: no fear, just a drift toward the light.
  const lure = nearestCell(cell, cells, LURE_RANGE, other => other.traits.has('lure') && other.canEat(cell))
  if (lure) {
    steerAt(cell, lure.cx, lure.cy, 1, out)
    out.mag = LURE_EFFORT
    brain.prey = null
    return out
  }

  const threat = nearestCell(cell, cells, FLEE_SENSE + cell.R, other => other.canEat(cell))
  brain.exhausted = Math.max(0, brain.exhausted - dt)
  if (threat) {
    steerAt(cell, threat.cx, threat.cy, -1, out)
    // Producers barely swim; they edge away rather than bolt.
    if (cell.species === 'producer') out.mag = 0.5
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

  if (cell.species === 'producer') return producer(cell, dt, out)
  if (cell.species === 'scavenger') return scavenger(cell, dt, nutrients, out)

  brain.retarget -= dt
  if (brain.retarget <= 0) {
    brain.retarget = RETARGET
    const sense = cell.species === 'engulfer' ? tuning.engulferSense : GRAZER_SENSE * 0.5
    brain.prey = brain.rest > 0 ? null : nearestCell(cell, cells, sense + cell.R, other => cell.canEat(other), true)
    brain.food = nearestFood(cell, nutrients, GRAZER_SENSE)
  }

  if (brain.attacker && cell.species === 'engulfer' && cell.canEat(brain.attacker) && brain.rest <= 0) {
    brain.prey = brain.attacker
  }
  const prey = brain.prey
  if (prey && !prey.engulfedBy && !prey.gone) {
    steerAt(cell, prey.cx, prey.cy, 1, out)
    // Lean the front of the body toward the prey as it closes in (visual only).
    const pdx = wrapDelta(prey.cx - cell.cx, WORLD)
    const pdy = wrapDelta(prey.cy - cell.cy, WORLD)
    const pd = Math.hypot(pdx, pdy) || 1
    if (pd - cell.R - prey.R < cell.R * 1.2) {
      cell.leanWant = 1
      cell.leanDirX = pdx / pd
      cell.leanDirY = pdy / pd
    }
    if (cell.species === 'engulfer') {
      // Cruise slowly, then a short burst once the prey is close.
      const gap = Math.hypot(wrapDelta(prey.cx - cell.cx, WORLD), wrapDelta(prey.cy - cell.cy, WORLD)) - cell.R - prey.R
      if (gap < LUNGE_RANGE && brain.lungeCooldown <= 0 && brain.coil <= 0 && brain.lunge <= 0) {
        brain.coil = COIL_TIME
        brain.lungeCooldown = COIL_TIME + LUNGE_TIME + LUNGE_COOLDOWN
      }
      if (brain.coil > 0) {
        // The tell: nearly stopped, body swung round to point straight at the prey.
        cell.aim(out.x, out.y)
        out.mag = 0.15
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

  // Hunters with nothing to chase patrol the edge of the nearest food cloud, where prey gathers.
  if (cell.species === 'engulfer' && brain.rest <= 0 && patrol(cell, nutrients, out)) return out

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

/** Nearest acceptable cell within `range`; `noticeable` scales the range per target (e.g. glowing cells). */
function nearestCell(
  cell: Protocell,
  cells: Protocell[],
  range: number,
  accept: (other: Protocell) => boolean,
  noticeable = false,
) {
  let best: Protocell | null = null
  let bestD = Infinity
  for (const other of cells) {
    if (other === cell || other.engulfedBy || other.gone) continue
    const dx = wrapDelta(other.cx - cell.cx, WORLD)
    const dy = wrapDelta(other.cy - cell.cy, WORLD)
    const d2 = dx * dx + dy * dy
    const r = noticeable ? range * other.conspicuous : range
    if (d2 < r * r && d2 < bestD && accept(other)) {
      best = other
      bestD = d2
    }
  }
  return best
}

function nearestFood(cell: Protocell, nutrients: Nutrients, range: number, only?: Nutrient['kind']) {
  let best: Nutrient | null = null
  let bestD = range * range
  for (const n of nutrients.items) {
    if (n.kind === 'mineral' || n.fading || (only && n.kind !== only)) continue
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

/** Light colony: drift slowly in the sunlit shallows, heading back in if it strays toward the edge. */
function producer(cell: Protocell, dt: number, out: Steer) {
  const brain = cell.brain!
  let home: Zone | null = null
  let bestD = Infinity
  for (const z of aiWorld.zones) {
    if (z.type !== 'uv') continue
    const d = Math.hypot(wrapDelta(z.x - cell.cx, WORLD), wrapDelta(z.y - cell.cy, WORLD))
    if (d < bestD) {
      home = z
      bestD = d
    }
  }
  if (home && home.strengthAt(cell.cx, cell.cy) < 0.7) {
    steerAt(cell, home.x, home.y, 1, out)
    out.mag = 0.35
    return out
  }
  brain.heading += (Math.random() - 0.5) * 2 * dt
  out.x = Math.cos(brain.heading)
  out.y = Math.sin(brain.heading)
  out.mag = 0.12
  return out
}

/** Armored scavenger: rock its way toward lipids near vent debris; otherwise linger by a vent. */
function scavenger(cell: Protocell, dt: number, nutrients: Nutrients, out: Steer) {
  const brain = cell.brain!
  brain.retarget -= dt
  if (brain.retarget <= 0) {
    brain.retarget = RETARGET
    brain.food = nearestFood(cell, nutrients, 320, 'lipid')
  }
  const food = brain.food
  if (food && !food.dead) {
    steerAt(cell, food.x, food.y, 1, out)
    out.mag = 0.6
    return out
  }
  let vent: Vent | null = null
  let bestD = Infinity
  for (const v of aiWorld.vents) {
    const d = Math.hypot(wrapDelta(v.x - cell.cx, WORLD), wrapDelta(v.y - cell.cy, WORLD))
    if (d < bestD) {
      vent = v
      bestD = d
    }
  }
  if (vent && bestD > vent.r * 3.5) {
    steerAt(cell, vent.x, vent.y, 1, out)
    out.mag = 0.3
    return out
  }
  brain.heading += (Math.random() - 0.5) * 2 * dt
  out.x = Math.cos(brain.heading)
  out.y = Math.sin(brain.heading)
  out.mag = 0.2
  return out
}

/**
 * Circle the nearest organic cloud at its edge. Returns false when there's no cloud nearby.
 * The cloud's centre is the average of the organics around the nearest one.
 */
function patrol(cell: Protocell, nutrients: Nutrients, out: Steer) {
  const near = nearestFood(cell, nutrients, PATROL_RANGE, 'organic')
  if (!near) return false
  let sx = 0
  let sy = 0
  let n = 0
  for (const p of nutrients.items) {
    if (p.kind !== 'organic' || p.fading) continue
    const dx = wrapDelta(p.x - near.x, WORLD)
    const dy = wrapDelta(p.y - near.y, WORLD)
    if (dx * dx + dy * dy > 120 * 120) continue
    sx += dx
    sy += dy
    n++
  }
  if (n < 8) return false // a stray speck, not a cloud
  const ccx = near.x + sx / n
  const ccy = near.y + sy / n
  const dx = wrapDelta(cell.cx - ccx, WORLD)
  const dy = wrapDelta(cell.cy - ccy, WORLD)
  const d = Math.hypot(dx, dy) || 1
  const ring = 90 + cell.R * 1.5
  // Tangent to the ring, plus a correction back onto it.
  const radial = Math.max(-1, Math.min(1, (ring - d) / ring)) * 1.5
  const x = -dy / d + (dx / d) * radial
  const y = dx / d + (dy / d) * radial
  const len = Math.hypot(x, y) || 1
  out.x = x / len
  out.y = y / len
  out.mag = 0.4
  cell.brain!.heading = Math.atan2(out.y, out.x)
  return true
}
