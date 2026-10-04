// Headless growth test: force the player to grow ~1000x and check the world rescales sanely.
// Usage: npx tsx scripts/scale.mts
const fake: any = () => new Proxy(() => fake(), { get: () => fake() })
;(globalThis as any).document = { createElement: () => ({ getContext: () => fake() }) }
const { Fluid } = await import('../src/fluid.ts')
const { Protocell } = await import('../src/protocell.ts')
const { Nutrients } = await import('../src/nutrients.ts')
const { placeVents } = await import('../src/vents.ts')
const { Effects } = await import('../src/effects.ts')
const { newBrain, think } = await import('../src/ai.ts')
const { needsRescale, rescaleWorld } = await import('../src/rescale.ts')
const { scale } = await import('../src/scale.ts')
const { tuning, WORLD } = await import('../src/config.ts')
const { rand, wrapDelta } = await import('../src/math.ts')

const f = new Fluid()
const vents = placeVents()
const effects = new Effects()
const player = new Protocell(WORLD / 2, WORLD / 2, 1, 'player')
player.brain = newBrain()
let cells = [player]
const nut = new Nutrients()
nut.seed(player.cx, player.cy, vents)
const spawn = (sp: 'grazer' | 'engulfer') => {
  const ratio = sp === 'engulfer' ? rand(2.8, 4.5) : Math.exp(rand(Math.log(0.12), Math.log(1.3)))
  const c = new Protocell(rand(0, WORLD), rand(0, WORLD), player.biomass * ratio, sp)
  c.brain = newBrain()
  cells.push(c)
}
const steer = { x: 0, y: 0, mag: 0 }
let t = 0
let problems = 0
for (let s = 0; s < 120 * 60 && player.biomass < 1000; s++) {
  const dt = 1 / 60
  t += dt
  if (s % 30 === 0) player.grow(player.biomass * 0.05)
  if (s % 120 === 0) {
    if (cells.filter(c => c.species === 'grazer').length < 9) spawn('grazer')
    if (cells.filter(c => c.species === 'engulfer').length < 2) spawn('engulfer')
  }
  for (const c of cells) {
    const st = c.engulfedBy ? { x: 0, y: 0, mag: 0 } : think(c, dt, cells, nut, steer)
    for (let i = 0; i < 3; i++) c.step(dt / 3, f, st.x, st.y, st.mag, t, vents)
  }
  cells = cells.filter(c => !c.gone || c === player)
  for (const v of vents) v.step(dt, f, nut)
  f.step(dt, t)
  nut.step(dt, f, vents, player.cx, player.cy)
  nut.sweep()
  if (needsRescale(player)) {
    const k = rescaleWorld(player, cells, nut, vents, f, effects)
    cells = cells.filter(c => !c.gone || c === player)
    const radii = cells.filter(c => c !== player).map(c => c.R)
    const near = nut.items.filter(
      n => Math.hypot(wrapDelta(n.x - player.cx, WORLD), wrapDelta(n.y - player.cy, WORLD)) < 400,
    ).length
    console.log(
      `t=${t.toFixed(1)}s biomass ×${player.biomass.toFixed(1)} k=${k.toFixed(2)} playerR=${player.R.toFixed(1)} ` +
        `cells=${cells.length} R ${Math.min(...radii).toFixed(1)}–${Math.max(...radii).toFixed(1)} ` +
        `nutrients=${nut.items.length} (fading ${nut.items.filter(n => n.fading).length}, counted ${nut.count.organic}+${nut.count.lipid}+${nut.count.mineral}, near ${near}) vents R ${vents.map(v => v.r.toFixed(0)).join('/')}`,
    )
  }
  for (const c of cells) {
    if (!Number.isFinite(c.cx) || !Number.isFinite(c.R)) problems++
  }
  if (player.R > 26 * 1.6) problems++
}
console.log(
  `done at t=${t.toFixed(0)}s, biomass ×${player.biomass.toFixed(0)}, scale ${scale.biomass.toFixed(0)}, problems: ${problems}`,
)
