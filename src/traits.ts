/**
 * Evolutionary traits. Each one physically changes the organism (propulsion, collisions, senses…)
 * rather than tweaking a stat; the behaviour lives with the body part it creates.
 */
export type TraitId = 'flagellum'

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
}

/** Minerals needed for each successive evolution. */
export const EVOLUTION_COST = [8, 20, 36, 56]
