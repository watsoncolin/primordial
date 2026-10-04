import { PROTOCELL_RADIUS, WORLD } from './config'
import type { Effects } from './effects'
import type { Fluid } from './fluid'
import { rand, wrapDelta } from './math'
import type { Nutrients } from './nutrients'
import type { Protocell } from './protocell'
import { scale } from './scale'
import { Vent } from './vents'

/** Rescale once the player's radius is this many times the base radius. */
export const RESCALE_AT = 1.4
/** Cells shrunk below this radius are specks now, too small to matter. */
const MIN_CELL_RADIUS = 2.5
/** Vents shrunk below this radius are replaced by fresh ones at the new scale. */
const MIN_VENT_RADIUS = 14

export function needsRescale(player: Protocell) {
  return player.targetR > PROTOCELL_RADIUS * RESCALE_AT
}

/**
 * Shrink the whole world toward the player so the player is back to the base radius in world units.
 * Returns the shrink factor k; the caller multiplies the camera zoom by 1/k so nothing jumps on screen.
 * Anything that becomes too small to matter is removed, and the emptied outer band refills with
 * fresh things at the new scale through the usual spawners.
 */
export function rescaleWorld(
  player: Protocell,
  cells: Protocell[],
  nutrients: Nutrients,
  vents: Vent[],
  fluid: Fluid,
  effects: Effects,
) {
  const old = scale.biomass
  scale.biomass = player.biomass
  const k = Math.sqrt(old / scale.biomass)
  const ox = player.cx
  const oy = player.cy

  for (const cell of cells) {
    cell.rescale(ox, oy, k)
    if (cell !== player && cell.R < MIN_CELL_RADIUS) cell.gone = true
  }
  nutrients.rescale(ox, oy, k)
  fluid.scaleVelocity(k)
  effects.clear()

  for (let i = 0; i < vents.length; i++) {
    vents[i].rescale(ox, oy, k)
    if (vents[i].r < MIN_VENT_RADIUS) vents[i] = newVent(ox, oy, vents)
  }
  return k
}

/** A fresh vent out in the far band, clear of the other vents. */
function newVent(px: number, py: number, vents: Vent[]) {
  let x = 0
  let y = 0
  for (let tries = 0; tries < 30; tries++) {
    x = rand(0, WORLD)
    y = rand(0, WORLD)
    const farFromPlayer = Math.hypot(wrapDelta(x - px, WORLD), wrapDelta(y - py, WORLD)) > WORLD * 0.38
    const clear = vents.every(v => Math.hypot(wrapDelta(x - v.x, WORLD), wrapDelta(y - v.y, WORLD)) > 300)
    if (farFromPlayer && clear) break
  }
  return new Vent(x, y, rand(32, 48))
}
