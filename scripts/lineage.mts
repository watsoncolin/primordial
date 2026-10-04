// Prints the lineage each evolution path produces, and checks formations have the right number of slots.
// Usage: npx tsx scripts/lineage.mts
const { lineageFor, formationOffsets } = await import('../src/transition.ts')
const paths = [
  [],
  ['flagellum'],
  ['flagellum', 'burst', 'engulfing', 'tendril'],
  ['membrane', 'spikes', 'engulfing', 'membrane'],
  ['engulfing', 'tendril', 'chemoreception', 'flagellum'],
  ['photosynthesis', 'lure', 'membrane', 'chemoreception'],
  ['chemoreception', 'flagellum', 'membrane', 'photosynthesis'],
] as const
for (const p of paths) {
  const l = lineageFor([...p])
  console.log(`${(p.join(' → ') || '(none)').padEnd(56)} ${l.name.padEnd(24)} ${l.formation.padEnd(8)} ${l.form}`)
}
for (const f of ['chain', 'cluster'] as const) {
  const ok = [3, 5, 8].every(n => formationOffsets(f, n).length === n)
  console.log(`${f} formation slot counts ok: ${ok}`)
}
