import type { PathId } from './paths'
/** A run reaches a mature organism rather than growing exponentially without limit. */
export const MATURE_BIOMASS = 32
export const MAX_RUN_BIOMASS = 128
export function boundedGrowth(biomass: number, amount: number, ceiling: number, taper = false) {
  if (amount <= 0) return biomass + amount
  const efficiency =
    taper && biomass > MATURE_BIOMASS ? Math.max(0, (ceiling - biomass) / (ceiling - MATURE_BIOMASS)) : 1
  return Math.min(ceiling, biomass + amount * efficiency)
}
export const PATH_BALANCE: Record<
  PathId,
  { thrust: number; assimilation: number; light: number; damage: number; drain: number; ram: number }
> = {
  pursuer: { thrust: 1.1, assimilation: 0.8, light: 0.65, damage: 1.2, drain: 1, ram: 1 },
  bulwark: { thrust: 0.9, assimilation: 0.8, light: 0.8, damage: 0.85, drain: 0.85, ram: 1.15 },
  trapper: { thrust: 0.9, assimilation: 0.85, light: 0.85, damage: 1, drain: 1.35, ram: 0.85 },
  producer: { thrust: 0.85, assimilation: 0.6, light: 1.35, damage: 1, drain: 0.8, ram: 0.9 },
}
