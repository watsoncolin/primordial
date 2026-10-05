import type { TraitId } from './traits'
import type { Species } from './protocell'

export type PathId = 'pursuer' | 'bulwark' | 'trapper' | 'producer'
export interface EvolutionPath {
  id: PathId
  name: string
  starter: TraitId
  role: Species
  tagline: string
  detail: string
  traits: TraitId[]
  color: string
}
export const PATHS: Record<PathId, EvolutionPath> = {
  pursuer: {
    id: 'pursuer',
    name: 'Pursuer',
    starter: 'flagellum',
    role: 'engulfer',
    tagline: 'Fast pursuit. Fragile body. Strike and escape.',
    detail:
      'Become a narrow, streamlined hunter with a powerful tail. Start with Flagellum: strong forward thrust, but turning takes commitment. Develop Burst Jet and feeding tools to chase prey.',
    traits: ['burst', 'engulfing', 'tendril', 'chemoreception'],
    color: '255,180,135',
  },
  bulwark: {
    id: 'bulwark',
    name: 'Bulwark',
    starter: 'membrane',
    role: 'scavenger',
    tagline: 'Heavy armor. Slow movement. Stand your ground.',
    detail:
      'Become a broad, plated organism. Start with Thick Membrane: survive one engulfing attempt while your armor holds, but accelerate slowly. Develop Ram Crest and Venom to break larger enemies down.',
    traits: ['spikes', 'venom', 'engulfing', 'acidResistance'],
    color: '155,205,255',
  },
  trapper: {
    id: 'trapper',
    name: 'Trapper',
    starter: 'engulfing',
    role: 'filter',
    tagline: 'A feeding mouth. Close ambush. Reach and capture.',
    detail:
      'Become a crescent-shaped body built around a feeding opening. Start with Engulfing: grab larger meals, then slow down while digesting. Develop Tendril and a luminous lure to bring prey to you.',
    traits: ['tendril', 'photosynthesis', 'lure', 'chemoreception'],
    color: '220,165,255',
  },
  producer: {
    id: 'producer',
    name: 'Producer',
    starter: 'photosynthesis',
    role: 'producer',
    tagline: 'Living petals. Grow in light. Manage exposure.',
    detail:
      'Become a rosette of light-catching chambers. Start with Photosynthesis: grow without hunting, faster while still, but your glow attracts predators. Develop UV Pigment and defenses to protect your garden.',
    traits: ['pigment', 'membrane', 'thermophile', 'chemoreception'],
    color: '155,255,170',
  },
}

export interface EvolutionBranch {
  name: string
  strategy: string
  chain: TraitId[]
}
/** Every node grants an existing, working adaptation; the arrows describe its route. */
export const PATH_BRANCHES: Record<PathId, EvolutionBranch[]> = {
  pursuer: [
    { name: 'Dart Hunter', strategy: 'Commit to forward speed and burst escapes.', chain: ['flagellum', 'burst'] },
    {
      name: 'Pursuit Maw',
      strategy: 'Chase, catch larger meals, then reel fleeing prey in.',
      chain: ['engulfing', 'tendril'],
    },
    {
      name: 'Ripple Stalker',
      strategy: 'Track resources and hunt through darkness.',
      chain: ['chemoreception', 'mechanoreception'],
    },
  ],
  bulwark: [
    {
      name: 'Reef Breaker',
      strategy: 'Ram larger enemies; venom keeps wounded prey weak.',
      chain: ['membrane', 'spikes', 'venom'],
    },
    {
      name: 'Acid Bastion',
      strategy: 'Turn corrosive food patches into protected territory.',
      chain: ['membrane', 'acidResistance'],
    },
    {
      name: 'Watchful Shield',
      strategy: 'Sense danger before committing your heavy body.',
      chain: ['chemoreception', 'mechanoreception'],
    },
  ],
  trapper: [
    {
      name: 'Reaching Maw',
      strategy: 'Catch prey at a distance and pull it into your mouth.',
      chain: ['engulfing', 'tendril'],
    },
    {
      name: 'Lantern Maw',
      strategy: 'Grow a luminous lure that draws edible prey toward you.',
      chain: ['photosynthesis', 'lure'],
    },
    {
      name: 'Night Snare',
      strategy: 'Read ripples and ambush in the dark.',
      chain: ['chemoreception', 'mechanoreception'],
    },
  ],
  producer: [
    {
      name: 'Solar Crown',
      strategy: 'Protect your light-catching lobes and bask in UV.',
      chain: ['photosynthesis', 'pigment'],
    },
    {
      name: 'Thorn Garden',
      strategy: 'Armor your petals and punish anything that attacks.',
      chain: ['membrane', 'spikes', 'venom'],
    },
    {
      name: 'Vent Bloom',
      strategy: 'Grow beside mineral-rich thermal fields without burning.',
      chain: ['thermophile'],
    },
  ],
}
export function pathForm(path: PathId, traits: Set<TraitId>): string {
  const complete = PATH_BRANCHES[path].filter(b => b.chain.every(t => traits.has(t)))
  return complete.sort((a, b) => b.chain.length - a.chain.length)[0]?.name ?? PATHS[path].name
}
