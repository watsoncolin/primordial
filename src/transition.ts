import type { TraitId } from './traits'

/** What it takes to attempt the Great Transition. */
export const TRANSITION_EVOLUTIONS = 4
export const TRANSITION_BIOMASS = 16
/** The body divides into this many cells, keeping this share of its biomass between them. */
export const COLONY_CELLS = 8
export const COLONY_SHARE = 0.9
/** Seconds the colony must survive, and how many cells it needs to bind into an organism. */
export const TRANSITION_TIME = 60
export const MIN_SURVIVORS = 3
/** Seconds the survivors take to pull into formation. */
export const ASSEMBLY_TIME = 3.5

type Branch = 'mobility' | 'defense' | 'predation' | 'light' | 'senses'

const BRANCH: Record<TraitId, Branch> = {
  flagellum: 'mobility',
  burst: 'mobility',
  membrane: 'defense',
  spikes: 'defense',
  engulfing: 'predation',
  tendril: 'predation',
  photosynthesis: 'light',
  lure: 'light',
  chemoreception: 'senses',
  sealed: 'defense',
  toxic: 'predation',
  venom: 'predation',
}

/** Latin-ish genus (from your first adaptation) and epithet (from your latest). */
const GENUS: Record<TraitId, string> = {
  flagellum: 'Natantia',
  burst: 'Saltella',
  membrane: 'Scutella',
  spikes: 'Echinula',
  engulfing: 'Voracia',
  tendril: 'Tentacula',
  photosynthesis: 'Lucella',
  lure: 'Lampadia',
  chemoreception: 'Olfactoria',
  sealed: 'Sutura',
  toxic: 'Toxella',
  venom: 'Venenia',
}

const EPITHET: Record<TraitId, string> = {
  flagellum: 'natans',
  burst: 'saliens',
  membrane: 'scutatus',
  spikes: 'spinosus',
  engulfing: 'vorax',
  tendril: 'tentaculatus',
  photosynthesis: 'viridis',
  lure: 'illicens',
  chemoreception: 'sagax',
  sealed: 'obsignatus',
  toxic: 'toxicus',
  venom: 'venenosus',
}

const FORM: Record<Branch | 'none', string> = {
  mobility: 'a tiny swimming creature, all muscle and tail',
  defense: 'an armoured, tardigrade-like grazer',
  predation: 'a primitive predatory worm',
  light: 'a coral-like colony that farms the light',
  senses: 'a drifting filter-feeder that tastes everything',
  none: 'a loose, sponge-like colony',
}

export type Formation = 'chain' | 'cluster'

export interface Lineage {
  name: string
  form: string
  formation: Formation
}

/** Rarer outcomes when two branches are evenly matched. Keyed by the two branches, sorted. */
const HYBRID: Record<string, string> = {
  'mobility+predation': 'a darting hunter with a grasping mouth',
  'defense+mobility': 'a shelled swimmer that rams its way through',
  'light+mobility': 'a glowing swimmer that follows the light',
  'mobility+senses': 'a restless scout that never stops searching',
  'defense+predation': 'a spined, armoured ambusher',
  'light+predation': 'a glowing trap that lures prey into its maw',
  'predation+senses': 'a patient hunter that tracks prey by taste',
  'defense+light': 'a shelled reef-builder basking in the light',
  'defense+senses': 'a wary, armoured forager',
  'light+senses': 'a drifting bloom that reaches for light and food alike',
}

/** `traits` in the order they were evolved. */
export function lineageFor(traits: TraitId[]): Lineage {
  const counts = new Map<Branch, number>()
  for (const t of traits) counts.set(BRANCH[t], (counts.get(BRANCH[t]) ?? 0) + 1)
  const ranked = [...counts].sort((a, b) => b[1] - a[1])
  const [top, second] = ranked
  let form = FORM.none
  let branches: Branch[] = []
  if (top && (!second || top[1] > second[1])) {
    form = FORM[top[0]]
    branches = [top[0]]
  } else if (top && top[1] >= 2) {
    // A tie between strong branches makes a hybrid (a three-way tie takes the first two evolved).
    branches = [top[0], second[0]].sort()
    form = HYBRID[branches.join('+')]
  }
  const first = traits[0]
  const last = traits[traits.length - 1]
  const name = first ? `${GENUS[first]} ${traits.length > 1 ? EPITHET[last] : 'simplex'}` : 'Protocella simplex'
  return {
    name,
    form,
    formation: branches.some(b => b === 'predation' || b === 'mobility') ? 'chain' : 'cluster',
  }
}

/**
 * Where each surviving cell sits in the finished organism, in units of cell radius, relative to
 * the organism's centre. A chain runs along +x (the direction of travel); a cluster packs in rings.
 */
export function formationOffsets(formation: Formation, n: number): [number, number][] {
  const gap = 1.85
  if (formation === 'chain') {
    return Array.from({ length: n }, (_, i) => {
      const along = (i - (n - 1) / 2) * gap
      return [along, Math.sin(i * 0.9) * 0.35] as [number, number]
    })
  }
  const out: [number, number][] = [[0, 0]]
  for (let ring = 1; out.length < n; ring++) {
    const slots = ring * 6
    for (let k = 0; k < slots && out.length < n; k++) {
      const a = (k / slots) * Math.PI * 2 + ring * 0.3
      out.push([Math.cos(a) * ring * gap, Math.sin(a) * ring * gap])
    }
  }
  return out
}

const STORAGE_KEY = 'primordial.lineages'

/** Record a lineage; returns how many distinct lineages have been discovered so far. */
export function recordLineage(name: string) {
  try {
    const known = new Set<string>(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'))
    known.add(name)
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...known]))
    return known.size
  } catch {
    return null
  }
}
