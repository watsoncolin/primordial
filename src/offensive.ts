import type { Protocell } from './protocell'
import { WORLD } from './config'
import { wrapDelta } from './math'
import { PATH_BALANCE } from './balance'

export const STRIKE_WINDUP = 0.22
export const STRIKE_COOLDOWN = 3
export const TETHER_LIMIT = 6
export const TETHER_RECOVERY = 2.5
export function distance(a: Protocell, b: Protocell) {
  return Math.hypot(wrapDelta(b.cx - a.cx, WORLD), wrapDelta(b.cy - a.cy, WORLD))
}
export function canJab(attacker: Protocell, target: Protocell) {
  if (target === attacker || target.gone || target.engulfedBy || (attacker.colony && target.colony)) return false
  const dx = wrapDelta(target.cx - attacker.cx, WORLD),
    dy = wrapDelta(target.cy - attacker.cy, WORLD)
  const d = Math.hypot(dx, dy) || 1
  return d <= attacker.R + target.R + attacker.R * 0.65 && (dx * attacker.facingX + dy * attacker.facingY) / d > 0.55
}
export function canLatch(attacker: Protocell, target: Protocell) {
  return (
    target !== attacker &&
    !target.gone &&
    !target.engulfedBy &&
    !(attacker.colony && target.colony) &&
    target.wounded > 0 &&
    !attacker.canEat(target) &&
    target.biomass <= attacker.biomass * 4 &&
    distance(attacker, target) - attacker.R - target.R < attacker.R * 2.5
  )
}
/** Stateful, bounded attachment; victim AI remains free to swim and retaliate. */
export class DrainTether {
  target: Protocell | null = null
  age = 0
  strain = 0
  cooldown = 0
  start(attacker: Protocell, target: Protocell) {
    if (this.target || this.cooldown > 0 || !canLatch(attacker, target)) return false
    this.target = target
    this.age = this.strain = 0
    attacker.tethered = true
    return true
  }
  release(attacker: Protocell) {
    if (this.target) this.cooldown = TETHER_RECOVERY
    this.target = null
    attacker.tethered = false
  }
  step(attacker: Protocell, dt: number) {
    this.cooldown = Math.max(0, this.cooldown - dt)
    const target = this.target
    if (!target) return 0
    this.age += dt
    const dx = wrapDelta(target.cx - attacker.cx, WORLD),
      dy = wrapDelta(target.cy - attacker.cy, WORLD)
    const d = Math.hypot(dx, dy) || 1,
      nx = dx / d,
      ny = dy / d
    const outward = (target.cvx - attacker.cvx) * nx + (target.cvy - attacker.cvy) * ny
    this.strain = outward > 55 ? this.strain + dt : Math.max(0, this.strain - dt)
    if (
      attacker.gone ||
      attacker.engulfedBy ||
      target.gone ||
      target.engulfedBy ||
      this.age >= TETHER_LIMIT ||
      this.strain >= 0.45 ||
      d > attacker.R * 3 + target.R ||
      attacker.canEat(target)
    ) {
      this.release(attacker)
      return 0
    }
    const before = target.biomass
    target.grow(-target.biomass * 0.05 * dt * (attacker.path ? PATH_BALANCE[attacker.path].drain : 1))
    const drained = Math.max(0, before - target.biomass)
    attacker.grow(drained * 0.65)
    target.wounded = Math.max(target.wounded, 0.3)
    for (const p of target.pts) {
      p.vx -= nx * 35 * dt
      p.vy -= ny * 35 * dt
    }
    attacker.reachWant = 1
    attacker.reachDirX = nx
    attacker.reachDirY = ny
    return drained
  }
}

/** Wind up once, then resolve against the target's current position: moving can dodge a jab. */
export function venomStrike(
  actor: Protocell,
  cells: Protocell[],
  dt: number,
  requested: boolean,
): Protocell | null | undefined {
  if (actor.gone || actor.engulfedBy) {
    actor.attackWindup = 0
    return undefined
  }
  if (requested && actor.traits.has('venom') && actor.attackCooldown <= 0) {
    actor.attackWindup = STRIKE_WINDUP
    actor.attackCooldown = STRIKE_COOLDOWN
  }
  if (actor.attackWindup <= 0) return undefined
  actor.attackWindup = Math.max(0, actor.attackWindup - dt)
  if (actor.attackWindup > 0) return undefined
  const target = cells.filter(c => canJab(actor, c)).sort((a, b) => distance(actor, a) - distance(actor, b))[0]
  if (!target) return null
  target.poison = Math.max(target.poison, actor.mutations.has('hollowSpines') ? 6 : 4)
  target.wounded = 6
  target.woundX = -actor.facingX
  target.woundY = -actor.facingY
  if (target.brain) {
    target.brain.attacker = actor
    target.brain.alarm = 6
    target.brain.retarget = 0
    target.brain.coil = 0
    target.brain.lunge = 0
    target.brain.recover = Math.max(target.brain.recover, 0.35)
  }
  return target
}
