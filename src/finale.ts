import type { Protocell } from './protocell'
import { WORLD } from './config'
import { wrapDelta } from './math'
export function raidPopulation(seconds: number) {
  return seconds < 20 ? 3 : seconds < 40 ? 4 : 5
}
export function raidStage(seconds: number) {
  return seconds < 20 ? 'First contact' : seconds < 40 ? 'Predators closing' : 'Final surge'
}
/** Prefer exposed members, with travel distance keeping different hunters on different flanks. */
export function exposedPrey(hunter: Protocell, colony: Protocell[]) {
  const live = colony.filter(c => !c.gone && !c.engulfedBy)
  if (!live.length) return null
  const origin = live[0]
  const mx = origin.cx + live.reduce((s, c) => s + wrapDelta(c.cx - origin.cx, WORLD), 0) / live.length
  const my = origin.cy + live.reduce((s, c) => s + wrapDelta(c.cy - origin.cy, WORLD), 0) / live.length
  let best: Protocell | null = null,
    score = Infinity
  for (const c of live) {
    if (!hunter.canEat(c)) continue
    const travel = Math.hypot(wrapDelta(c.cx - hunter.cx, WORLD), wrapDelta(c.cy - hunter.cy, WORLD))
    const exposure = Math.hypot(wrapDelta(c.cx - mx, WORLD), wrapDelta(c.cy - my, WORLD))
    const candidate = travel - exposure * 0.65
    if (candidate < score) {
      best = c
      score = candidate
    }
  }
  return best
}
