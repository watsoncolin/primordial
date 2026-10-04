import type { Zone } from './biomes'
import { WORLD } from './config'
import type { Fluid } from './fluid'
import { TAU, rand, wrapDelta } from './math'
import type { Protocell, Species } from './protocell'
import type { Vent } from './vents'

/**
 * Where each role lives, and how to find a valid, out-of-sight spot for a new one. Everything
 * spawns beyond the edge of the screen so nothing pops into existence beside the player.
 */

/** Spawn size range for each role, as a fraction of the player's biomass. */
export const ROLE_SIZE: Record<Exclude<Species, 'player' | 'offspring'>, [number, number]> = {
  grazer: [0.12, 1.3],
  engulfer: [2.8, 4.5],
  // Small enough for a basic protocell to eat.
  producer: [0.25, 0.4],
  // Edible only with Engulfing (≤60%), and armoured even then.
  scavenger: [0.45, 0.6],
  filter: [0.25, 0.5],
}

/** Light colonies stop photosynthesising at this multiple of their spawn biomass. */
export const PRODUCER_CAP = 1.6
/** They shed organics only when above this multiple, every few seconds, a small share each time. */
export const PRODUCER_SHED_ABOVE = 1.1
export const PRODUCER_SHED_INTERVAL: [number, number] = [4, 7]
export const PRODUCER_SHED_SHARE = 0.015
/** A filter feeder pulls in particles from this far beyond its membrane while open. */
export const FILTER_REACH = 30
/** Seconds a filter feeder stays contracted after being bumped. */
export const FILTER_CONTRACT = 1.5

const dist = (ax: number, ay: number, bx: number, by: number) =>
  Math.hypot(wrapDelta(ax - bx, WORLD), wrapDelta(ay - by, WORLD))

/** Is this point beyond the visible screen (plus a margin) around the focus? */
export function outOfView(x: number, y: number, fx: number, fy: number, viewRadius: number) {
  return dist(x, y, fx, fy) > viewRadius
}

/** A vent sitting inside a thermal field (its core is for thermophiles, not for these roles). */
export function isThermalVent(v: Vent, zones: Zone[]) {
  return zones.some(z => z.type === 'thermal' && z.strengthAt(v.x, v.y) > 0)
}

/** A spot inside sunlit shallows, out of view. */
export function producerSpot(zones: Zone[], fx: number, fy: number, viewRadius: number): [number, number] | null {
  const uv = zones.filter(z => z.type === 'uv')
  for (let tries = 0; tries < 24 && uv.length; tries++) {
    const z = uv[Math.floor(Math.random() * uv.length)]
    const a = rand(0, TAU)
    const d = Math.sqrt(Math.random()) * z.r * 0.6
    const x = z.x + Math.cos(a) * d
    const y = z.y + Math.sin(a) * d
    if (outOfView(x, y, fx, fy, viewRadius)) return [x, y]
  }
  return null
}

/** A spot near an ordinary vent's debris (outside any thermal core), out of view. */
export function scavengerSpot(
  vents: Vent[],
  zones: Zone[],
  fx: number,
  fy: number,
  viewRadius: number,
): [number, number] | null {
  const ordinary = vents.filter(v => !isThermalVent(v, zones))
  for (let tries = 0; tries < 24 && ordinary.length; tries++) {
    const v = ordinary[Math.floor(Math.random() * ordinary.length)]
    const a = rand(0, TAU)
    const d = v.r * rand(2, 3.2)
    const x = v.x + Math.cos(a) * d
    const y = v.y + Math.sin(a) * d
    if (outOfView(x, y, fx, fy, viewRadius) && !zones.some(z => z.type === 'thermal' && z.strengthAt(x, y) > 0)) {
      return [x, y]
    }
  }
  return null
}

/**
 * Where a filter feeder anchors: on the current-facing edge of an ordinary vent that doesn't
 * already have one. Returns the anchor and the outward (upstream) direction its cup faces.
 */
export function filterSite(
  vents: Vent[],
  zones: Zone[],
  cells: Protocell[],
  fluid: Fluid,
  fx: number,
  fy: number,
  viewRadius: number,
  /** The feeder's radius: a vent smaller than this can't hold it. */
  feederR: number,
): { x: number; y: number; ux: number; uy: number } | null {
  const free = vents.filter(
    v =>
      v.r >= feederR * 0.8 &&
      !isThermalVent(v, zones) &&
      outOfView(v.x, v.y, fx, fy, viewRadius) &&
      !cells.some(c => c.anchored && dist(c.anchorX, c.anchorY, v.x, v.y) < v.r * 2.5),
  )
  if (!free.length) return null
  const v = free[Math.floor(Math.random() * free.length)]
  fluid.sample(v.x, v.y)
  const speed = Math.hypot(fluid.su, fluid.sv)
  const a = rand(0, TAU)
  // Face into the current: the anchor sits on the upstream side of the rock.
  const ux = speed > 1 ? -fluid.su / speed : Math.cos(a)
  const uy = speed > 1 ? -fluid.sv / speed : Math.sin(a)
  return { x: v.x + ux * v.r * 0.95, y: v.y + uy * v.r * 0.95, ux, uy }
}
