import type { PathId } from './paths'
import type { MutationId } from './mutations'
import type { TraitId } from './traits'

/** Permanent unlocks bought with DNA. Each widens what's possible rather than making you stronger. */
export type UnlockId = 'geneticMemory' | 'widerOptions' | 'directedMutation' | 'heritableMutation'

export interface UnlockInfo {
  id: UnlockId
  name: string
  detail: string
  cost: number
}

export const UNLOCKS: Record<UnlockId, UnlockInfo> = {
  geneticMemory: {
    id: 'geneticMemory',
    name: 'Genetic Memory',
    detail: 'Every new protocell starts with a free evolution choice.',
    cost: 12,
  },
  widerOptions: {
    id: 'widerOptions',
    name: 'Wider Options',
    detail: 'Evolution offers four adaptations instead of three.',
    cost: 15,
  },
  directedMutation: {
    id: 'directedMutation',
    name: 'Directed Mutation',
    detail: 'When a mutation strikes, choose between two.',
    cost: 20,
  },
  heritableMutation: {
    id: 'heritableMutation',
    name: 'Heritable Mutation',
    detail: 'Begin each run with a mutation from one of your lineages.',
    cost: 25,
  },
}

/** One run, as it's remembered on the Tree of Life. */
export interface RunRecord {
  path?: PathId | null
  outcome: 'lineage' | 'extinct'
  /** Generation the run was played in. */
  generation: number
  name: string
  form: string
  traits: TraitId[]
  mutations: MutationId[]
  seconds: number
  peakBiomass: number
  cellsEaten: number
  dna: number
  date: number
  /** Playtest telemetry (absent on runs recorded before it existed). */
  stats?: RunStats
}

/** What a playtest needs from each run. Times are seconds since the run started. */
export interface RunStats {
  firstEvolutionAt: number | null
  /** When both Great Transition requirements were first met. */
  transitionReadyAt: number | null
  /** What ended the run: the species that swallowed you, 'colony' (devoured during the transition), or 'lineage'. */
  cause: string
  /** Each adaptation in the order taken, with when. */
  evolutions: { trait: TraitId; at: number }[]
  /** Cells you swallowed, by species. */
  eaten: Record<string, number>
  /** Seconds spent in each habitat: zone types, 'vent' (near an ordinary vent), 'cloud' (in a food cloud). */
  habitat: Record<string, number>
  /** Colony cells alive when the transition ended (null if it was never attempted). */
  transitionSurvivors: number | null
  combat?: { strikes: number; venomHits: number; ramHits: number; drainedBiomass: number; raidLunges: number }
}

export interface Save {
  version: 1
  dna: number
  /** Generation of the next run; goes up each time a lineage is established. */
  generation: number
  runs: RunRecord[]
  unlocks: UnlockId[]
  /** Heritable Mutation: which mutation new runs start with. */
  inherited: MutationId | null
}

const KEY = 'primordial.save'

function fresh(): Save {
  return { version: 1, dna: 0, generation: 1, runs: [], unlocks: [], inherited: null }
}

export function loadSave(): Save {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return fresh()
    const data = JSON.parse(raw) as Partial<Save>
    return { ...fresh(), ...data, version: 1 }
  } catch {
    return fresh()
  }
}

export function writeSave(save: Save) {
  try {
    localStorage.setItem(KEY, JSON.stringify(save))
  } catch {
    // Storage unavailable (private mode, quota): progress lasts only this session.
  }
}

export interface DnaLine {
  label: string
  amount: number
}

/**
 * DNA for establishing a lineage, scored on how the organism lived rather than just how big it got,
 * so farming one corner isn't the best strategy.
 */
export function dnaFor(run: {
  cellsEaten: number
  evolutions: number
  mutations: number
  survivors: number
  peakBiomass: number
}): DnaLine[] {
  const lines: DnaLine[] = [
    { label: 'Lineage established', amount: 5 },
    { label: 'Predation', amount: run.cellsEaten },
    { label: 'Adaptation', amount: run.evolutions * 2 },
    { label: 'Mutation', amount: run.mutations * 3 },
    { label: 'Colony', amount: run.survivors },
    { label: 'Growth', amount: Math.max(0, Math.floor(Math.log2(Math.max(1, run.peakBiomass)))) },
  ]
  return lines.filter(l => l.amount > 0)
}

/** Every mutation that appeared in an established lineage, for Heritable Mutation. */
export function heritableChoices(save: Save): MutationId[] {
  const all = new Set<MutationId>()
  for (const r of save.runs) if (r.outcome === 'lineage') for (const m of r.mutations) all.add(m)
  return [...all]
}
