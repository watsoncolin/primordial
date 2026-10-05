import { PATHS, type PathId } from './paths'
import { Protocell } from './protocell'
import { type TraitId, TRAITS } from './traits'
import { View } from './view'
import type { Fluid } from './fluid'

/** Still water for previews: a stand-in fluid that never moves. */
const stillWater = { su: 0, sv: 0, sample() {} } as unknown as Fluid

const SIZE = 132
const cache = new Map<string, string>()

/** Every trait this one builds on, so a preview shows the full body (Spikes on a thick membrane). */
function lineage(id: TraitId): TraitId[] {
  const chain: TraitId[] = []
  let t: TraitId | undefined = id
  while (t) {
    chain.unshift(t)
    t = TRAITS[t].requires
  }
  return chain
}

/**
 * A small picture of the player's cell with this adaptation (and what it evolves from), as an
 * image URL for an evolution card: the card shows the actual body feature you're choosing.
 */
export function traitPreview(id: TraitId, has: Set<TraitId>, path: PathId | null = null): string {
  const key = `${path ?? 'base'}:${[...lineage(id), ...has].join(',')}`
  const hit = cache.get(key)
  if (hit) return hit
  const cell = new Protocell(0, 0, 1, 'player')
  if (path) cell.setPath(path)
  cell.glows = false
  for (const t of has) cell.addTrait(t)
  for (const t of lineage(id)) if (!cell.traits.has(t)) cell.addTrait(t)
  if (cell.traits.has('engulfing')) {
    // Show the pseudopod reaching, as it does near prey.
    cell.reachWant = 1
    cell.reachDirX = 1
  }
  // Let it settle (tail grows in, plates form), swimming gently to the right.
  for (let s = 0; s < 150; s++) {
    for (let i = 0; i < 3; i++) cell.step(1 / 180, stillWater, 1, 0, 0.35, s / 60, [])
    cell.clearAim()
  }
  const canvas = document.createElement('canvas')
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  canvas.width = canvas.height = SIZE * dpr
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const view = new View()
  view.w = view.h = SIZE
  // Fit the body plus anything that sticks out (tail behind, fold, whiskers or pseudopod in front).
  const tail = cell.flagellum ? 1 : 0
  view.zoom = SIZE / (cell.R * (4 + tail * 2.4))
  view.x = cell.cx - tail * cell.R * 1.1
  view.y = cell.cy
  cell.draw(ctx, view, 1.2)
  const url = canvas.toDataURL()
  cache.set(key, url)
  return url
}

export function pathPreview(path: PathId): string {
  return traitPreview(PATHS[path].starter, new Set(), path)
}
