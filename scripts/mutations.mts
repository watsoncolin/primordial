// Headless mutation checks: how each one changes speed, steering and biomass.
// Usage: npx tsx scripts/mutations.mts
const fake: any = () => new Proxy(() => fake(), { get: () => fake() })
;(globalThis as any).document = { createElement: () => ({ getContext: () => fake() }) }
const { Fluid } = await import('../src/fluid.ts')
const { Protocell } = await import('../src/protocell.ts')
const { tuning } = await import('../src/config.ts')
const { rollMutation } = await import('../src/mutations.ts')
tuning.currentStrength = 0

function trial(traits: string[], muts: string[], secs = 5) {
  const f = new Fluid()
  const c = new Protocell(500, 500, 1, 'player')
  for (const t of traits) c.addTrait(t as any)
  for (const m of muts) c.addMutation(m as any)
  const b0 = c.biomass
  let t = 0
  for (let s = 0; s < secs * 60; s++) {
    t += 1 / 60
    for (let i = 0; i < 3; i++) c.step(1 / 180, f, 1, 0, 1, t, [])
    f.step(1 / 60, t)
  }
  const heading = (Math.atan2(c.cvy, c.cvx) * 180) / Math.PI
  return { speed: Math.hypot(c.cvx, c.cvy), heading, biomass: c.biomass, start: b0, c }
}

const row = (label: string, r: ReturnType<typeof trial>) =>
  console.log(
    `${label.padEnd(34)} speed ${r.speed.toFixed(0).padStart(4)}  heading ${r.heading.toFixed(0).padStart(4)}°  biomass ${r.start.toFixed(2)} → ${r.biomass.toFixed(2)}`,
  )

row('plain', trial([], []))
row('hypermetabolism', trial([], ['hypermetabolism']))
row('sticky', trial([], ['sticky']))
row('gigantism', trial([], ['gigantism']))
row('miniaturization', trial([], ['miniaturization']))
row('flagellum', trial(['flagellum'], []))
row('flagellum + giant flagellum', trial(['flagellum'], ['giantFlagellum']))
{
  const r = trial([], ['mitosis'], 1)
  console.log(`mitosis: first bud due in ${(r.c.budTimer + 1).toFixed(1)}s (25–40 expected)`)
}
const counts: Record<string, number> = {}
for (let i = 0; i < 2000; i++) {
  const m = rollMutation(new Set(), new Set(['flagellum', 'spikes'] as any))!
  counts[m.id] = (counts[m.id] ?? 0) + 1
}
console.log('roll spread (flagellum + spikes):', counts)
