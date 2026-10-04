// Headless biome checks: burn rates with and without adaptations, sunlight, avoidance.
// Usage: npx tsx scripts/biomes.mts
const fake: any = () => new Proxy(() => fake(), { get: () => fake() })
;(globalThis as any).document = { createElement: () => ({ getContext: () => fake() }) }
const { Fluid } = await import('../src/fluid.ts')
const { Protocell } = await import('../src/protocell.ts')
const { Zone, applyHazards, hostileAhead } = await import('../src/biomes.ts')
const { tuning } = await import('../src/config.ts')
tuning.currentStrength = 0

function soak(type: 'thermal' | 'acid' | 'uv' | 'dark', traits: string[], secs = 10, moving = false) {
  const zone = new Zone(type, 500, 500, 200)
  const f = new Fluid()
  const c = new Protocell(500, 500, 1, 'player')
  for (const t of traits) c.addTrait(t as any)
  let t = 0
  let worst = null
  for (let s = 0; s < secs * 60; s++) {
    t += 1 / 60
    const e = applyHazards(c, [zone], 1 / 60)
    worst = e.worst ?? worst
    for (let i = 0; i < 3; i++) c.step(1 / 180, f, moving ? 1 : 0, 0, moving ? 1 : 0, t, [])
    f.step(1 / 60, t)
    // Keep it in the core.
    for (const p of c.pts) {
      p.x -= c.cx - 500
      p.y -= c.cy - 500
    }
  }
  return { biomass: c.biomass, drag: c.envDrag, light: c.envLight, worst }
}

const row = (label: string, r: ReturnType<typeof soak>) =>
  console.log(
    `${label.padEnd(36)} biomass after 10s ${r.biomass.toFixed(2)}  drag ×${r.drag.toFixed(2)}  light ×${r.light.toFixed(1)}  warning ${r.worst}`,
  )
row('thermal, unadapted', soak('thermal', []))
row('thermal, thermophile', soak('thermal', ['thermophile']))
row('acid, unadapted', soak('acid', []))
row('acid, acid resistance', soak('acid', ['membrane', 'acidResistance']))
row('uv, photosynthesis', soak('uv', ['photosynthesis']))
row('uv, photosynthesis + pigment', soak('uv', ['photosynthesis', 'pigment']))
row('dark', soak('dark', []))

// Avoidance: a cell heading straight at a thermal zone gets told to turn away; an adapted one doesn't.
{
  const zone = new Zone('thermal', 700, 500, 150)
  const c = new Protocell(480, 500, 1, 'grazer')
  console.log('avoid (unadapted, heading in):', hostileAhead(c, [zone], 1, 0))
  c.addTrait('thermophile')
  console.log('avoid (thermophile, heading in):', hostileAhead(c, [zone], 1, 0))
}
