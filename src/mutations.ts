import type { TraitId } from './traits'

/**
 * Mutations happen to you rather than being chosen. Each one is a physical change with an upside
 * and a cost, and some of them open (or reshape) branches of the evolution tree.
 */
export type MutationId =
  | 'giantFlagellum'
  | 'sticky'
  | 'hypermetabolism'
  | 'gigantism'
  | 'miniaturization'
  | 'mitosis'
  | 'porous'
  | 'hollowSpines'

export interface MutationInfo {
  id: MutationId
  name: string
  good: string
  bad: string
  /** Only possible once you have this trait. */
  requires?: TraitId
  /** Relative chance among eligible mutations. */
  weight: number
}

export const MUTATIONS: Record<MutationId, MutationInfo> = {
  giantFlagellum: {
    id: 'giantFlagellum',
    name: 'Giant Flagellum',
    good: 'Much stronger thrust',
    bad: 'Lopsided: it pulls you to one side',
    requires: 'flagellum',
    weight: 1.2,
  },
  sticky: {
    id: 'sticky',
    name: 'Sticky Membrane',
    good: 'Food sticks to you from farther away',
    bad: 'Debris clings too: more drag',
    weight: 1,
  },
  hypermetabolism: {
    id: 'hypermetabolism',
    name: 'Hypermetabolism',
    good: 'Burning hot: much more thrust',
    bad: 'Constantly burns biomass',
    weight: 1,
  },
  gigantism: {
    id: 'gigantism',
    name: 'Gigantism',
    good: 'Suddenly far bigger',
    bad: 'Sluggish from now on',
    weight: 0.8,
  },
  miniaturization: {
    id: 'miniaturization',
    name: 'Miniaturisation',
    good: 'Small and nimble: more thrust',
    bad: 'Lose a third of your biomass',
    weight: 0.8,
  },
  mitosis: {
    id: 'mitosis',
    name: 'Unstable Mitosis',
    good: 'Every so often a daughter cell buds off',
    bad: '…taking a fifth of you with it. Eat it back before something else does',
    weight: 0.7,
  },
  porous: {
    id: 'porous',
    name: 'Porous Membrane',
    good: 'Your next evolutions can fix or weaponise it',
    bad: 'You leak biomass as you go',
    weight: 0.9,
  },
  hollowSpines: {
    id: 'hollowSpines',
    name: 'Hollow Spines',
    good: 'Opens a new evolution: Venom Gland',
    bad: 'Your spikes tear a little less',
    requires: 'spikes',
    weight: 1.5,
  },
}

// Mutation tuning.
/** Mutagen needed for the first mutation, and how much more each one after it needs. */
export const MUTAGEN_FIRST = 100
export const MUTAGEN_STEP = 60
/** Mutagen from each source. Minerals come from vents, which count as radiation. */
export const MUTAGEN_MINERAL = 4
export const MUTAGEN_CELL = 12
export const MUTAGEN_HURT = 20
export const GIANT_FLAGELLUM_POWER = 1.5
export const GIANT_FLAGELLUM_LENGTH = 1.6
/** Constant sideways torque, as a fraction of normal turning, from a lopsided giant tail. */
export const GIANT_FLAGELLUM_BIAS = 0.35
export const STICKY_REACH = 22
export const STICKY_DRAG = 1.25
export const HYPER_THRUST = 1.4
/** Biomass burned per second, as a fraction of the current scale. */
export const HYPER_BURN = 0.003
export const GIGANTISM_GROWTH = 0.6
export const GIGANTISM_THRUST = 0.75
export const MINI_LOSS = 0.35
export const MINI_THRUST = 1.35
/** Seconds between buds, the bud's warning time, and the share of biomass it takes. */
export const MITOSIS_INTERVAL: [number, number] = [25, 40]
export const MITOSIS_WARNING = 2.5
export const MITOSIS_SHARE = 0.2
/** Leak: biomass per second as a fraction of the current scale, released as particles this often. */
export const POROUS_LEAK = 0.0025
export const POROUS_INTERVAL = 0.5
export const HOLLOW_SPIKE_BITE = 0.7

/** A random mutation this cell doesn't have yet and could get, weighted. */
export function rollMutation(has: Set<MutationId>, traits: Set<TraitId>): MutationInfo | null {
  const eligible = Object.values(MUTATIONS).filter(m => !has.has(m.id) && (!m.requires || traits.has(m.requires)))
  const total = eligible.reduce((sum, m) => sum + m.weight, 0)
  let r = Math.random() * total
  for (const m of eligible) {
    r -= m.weight
    if (r <= 0) return m
  }
  return eligible[eligible.length - 1] ?? null
}
