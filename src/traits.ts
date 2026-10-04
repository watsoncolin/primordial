import type { MutationId } from './mutations'

/**
 * Evolutionary traits. Each one physically changes the organism (propulsion, collisions, senses…)
 * rather than tweaking a stat; the behaviour lives with the body part it creates.
 */
export type TraitId =
  | 'flagellum'
  | 'membrane'
  | 'engulfing'
  | 'photosynthesis'
  | 'chemoreception'
  | 'burst'
  | 'spikes'
  | 'tendril'
  | 'lure'
  | 'sealed'
  | 'toxic'
  | 'venom'
  | 'thermophile'
  | 'acidResistance'
  | 'pigment'
  | 'mechanoreception'

export interface TraitInfo {
  id: TraitId
  name: string
  /** One evocative line. */
  tagline: string
  /** What actually changes, in plain terms. */
  detail: string
  /** The adaptation this one evolves from. */
  requires?: TraitId
  /** Only offered after this mutation. */
  requiresMutation?: MutationId
  /** Taking this trait cures the mutation. */
  cures?: MutationId
}

export const TRAITS: Record<TraitId, TraitInfo> = {
  flagellum: {
    id: 'flagellum',
    name: 'Flagellum',
    tagline: 'A whip-like tail that beats against the water.',
    detail: 'Far stronger thrust, but only in the direction you face. Turning means swinging your whole body around.',
  },
  membrane: {
    id: 'membrane',
    name: 'Thick Membrane',
    tagline: 'Layered lipids, hard to break.',
    detail:
      'Shove other cells aside and shrug off currents. Survives one engulfing attempt, then needs time to reseal. Slower to get moving.',
  },
  engulfing: {
    id: 'engulfing',
    name: 'Engulfing',
    tagline: 'Your membrane reaches out for food.',
    detail:
      'Swallow cells up to 60% of your size instead of 40%. Pseudopods bulge toward prey and grab it before contact. Big meals slow you down while you digest.',
  },
  photosynthesis: {
    id: 'photosynthesis',
    name: 'Photosynthesis',
    tagline: 'Chloroplasts turn light into biomass.',
    detail:
      'Grow slowly on your own, twice as fast while holding still. But you glow, and predators notice you from much farther away.',
  },
  chemoreception: {
    id: 'chemoreception',
    name: 'Chemoreception',
    tagline: 'You can taste the water.',
    detail: 'Faint traces at the edge of your vision point toward food clouds and mineral vents you can’t see yet.',
  },
  burst: {
    id: 'burst',
    name: 'Burst Jet',
    tagline: 'One violent snap of the tail.',
    detail: 'Press Space or double-tap to lunge forward. Takes a few seconds to recover.',
    requires: 'flagellum',
  },
  spikes: {
    id: 'spikes',
    name: 'Spikes',
    tagline: 'Your membrane hardens into barbs.',
    detail: 'Ram cells too big to swallow and knock chunks of biomass off them. Anything that grabs you gets torn too.',
    requires: 'membrane',
  },
  tendril: {
    id: 'tendril',
    name: 'Tendril',
    tagline: 'A long, sticky arm of membrane.',
    detail: 'Reach for prey much farther away and reel it in toward you.',
    requires: 'engulfing',
  },
  lure: {
    id: 'lure',
    name: 'Bioluminescent Lure',
    tagline: 'Your glow becomes a trap.',
    detail: 'Small cells are drawn to your light instead of fleeing from it.',
    requires: 'photosynthesis',
  },
  sealed: {
    id: 'sealed',
    name: 'Sealed Membrane',
    tagline: 'Patch the leaks.',
    detail: 'Cures your Porous Membrane. No more biomass trickling away.',
    requiresMutation: 'porous',
    cures: 'porous',
  },
  toxic: {
    id: 'toxic',
    name: 'Toxic Seep',
    tagline: 'If you must leak, leak poison.',
    detail: 'You keep leaking, but anything that eats what you leave behind wastes away instead of growing.',
    requiresMutation: 'porous',
  },
  venom: {
    id: 'venom',
    name: 'Venom Gland',
    tagline: 'Your hollow spines can inject.',
    detail: 'Spike hits poison their victim: slowed to half speed and wasting away for a few seconds.',
    requires: 'spikes',
    requiresMutation: 'hollowSpines',
  },
  // Survival: adaptations that turn hostile regions into territory.
  thermophile: {
    id: 'thermophile',
    name: 'Thermophile',
    tagline: 'Proteins that hold their shape in boiling water.',
    detail: 'Thermal fields no longer scald you. Their minerals and lipids are yours, and nothing follows you in.',
  },
  acidResistance: {
    id: 'acidResistance',
    name: 'Acid Resistance',
    tagline: 'A membrane that acid can’t eat through.',
    detail: 'Acid pools stop dissolving you and stop dragging at you. Feed on their rich organic clouds in peace.',
    requires: 'membrane',
  },
  pigment: {
    id: 'pigment',
    name: 'UV Pigment',
    tagline: 'A dark sunscreen in your membrane.',
    detail: 'Sunlit shallows stop burning you. With photosynthesis, bask there for double growth.',
    requires: 'photosynthesis',
  },
  mechanoreception: {
    id: 'mechanoreception',
    name: 'Mechanoreception',
    tagline: 'Feel the ripples of anything that moves.',
    detail: 'See farther in the dark, and sense nearby cells as ripples even where there’s no light.',
    requires: 'chemoreception',
  },
}

/** Traits a cell could evolve next: not taken yet, prerequisite trait and mutation present. */
export function availableTraits(has: Set<TraitId>, mutations: Set<MutationId>) {
  return Object.values(TRAITS).filter(
    t =>
      !has.has(t.id) &&
      (!t.requires || has.has(t.requires)) &&
      (!t.requiresMutation || mutations.has(t.requiresMutation)) &&
      // Once the leak is sealed, there's nothing left to weaponise (and vice versa).
      !(t.requiresMutation === 'porous' && (has.has('sealed') || has.has('toxic'))),
  )
}

/** Venom: seconds a spike hit keeps its victim poisoned. */
export const VENOM_TIME = 4

// Trait tuning. Kept here so each trait's numbers sit next to its description.
/** Thick membrane: how much of a contact overlap this cell yields (0.5 = even split). */
export const MEMBRANE_YIELD = 0.15
export const MEMBRANE_STIFFNESS = 1.7
export const MEMBRANE_THRUST = 0.6
/** Fraction of normal current drag; heavier membranes drift less. */
export const MEMBRANE_DRAG = 0.65
/** Seconds for a cracked membrane to reseal. */
export const MEMBRANE_RESEAL = 20
/** Engulfing: biggest prey, as a fraction of own biomass. */
export const ENGULF_RATIO = 0.6
/** How far a pseudopod reaches, as a multiple of the radius beyond the membrane. */
export const PSEUDOPOD_REACH = 0.55
/** Digestion after swallowing a cell: thrust multiplier and seconds per unit of relative meal size. */
export const DIGEST_THRUST = 0.55
export const DIGEST_TIME = 6
/** Photosynthesis: biomass per second as a fraction of the current scale, and the bonus for holding still. */
export const PHOTO_RATE = 0.002
export const PHOTO_STILL_BONUS = 2
/** How much farther away predators notice a glowing cell. */
export const PHOTO_CONSPICUOUS = 1.6

/** Minerals needed for each successive evolution. */
export const EVOLUTION_COST = [8, 20, 36, 56, 80, 110, 150, 200, 260]
/** Burst jet: speed added along your facing, and seconds before you can do it again. */
export const BURST_SPEED = 150
export const BURST_COOLDOWN = 3
/** Spikes: minimum closing speed for a hit to tear, the biomass fraction a full-speed hit knocks off, and per-victim recovery. */
export const SPIKE_MIN_SPEED = 30
export const SPIKE_FULL_SPEED = 120
export const SPIKE_BITE = 0.15
export const SPIKE_RECOVERY = 0.6
/** Tendril: how far it reaches (gap beyond the membrane, in radii) and how hard it reels prey in. */
export const TENDRIL_RANGE = 4
export const TENDRIL_PULL = 150
/** Lure: how far away small cells are drawn in, and how hard they swim toward the light. */
export const LURE_RANGE = 320
export const LURE_EFFORT = 0.55
