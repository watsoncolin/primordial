/**
 * Evolutionary traits. Each one physically changes the organism (propulsion, collisions, senses…)
 * rather than tweaking a stat; the behaviour lives with the body part it creates.
 */
export type TraitId = 'flagellum' | 'membrane' | 'engulfing' | 'photosynthesis'

export interface TraitInfo {
  id: TraitId
  name: string
  /** One evocative line. */
  tagline: string
  /** What actually changes, in plain terms. */
  detail: string
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
}

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
export const EVOLUTION_COST = [8, 20, 36, 56]
