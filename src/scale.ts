import { PROTOCELL_RADIUS } from './config'

/**
 * The world is simulated in player-relative units so it never runs out of room or precision.
 * `scale.biomass` is the biomass of a cell drawn at the base radius; it ratchets up each time the
 * player has grown enough that the world gets rescaled around them (see rescale.ts).
 */
export const scale = { biomass: 1 }

/** Simulation radius of a cell with this (absolute) biomass at the current scale. */
export function radiusFor(biomass: number) {
  return PROTOCELL_RADIUS * Math.sqrt(biomass / scale.biomass)
}
