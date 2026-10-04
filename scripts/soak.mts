// Headless soak test: runs the ecosystem without rendering and reports cells whose membrane
// points stray far from their centre (which renders as fills streaking across the screen).
// Usage: npx tsx scripts/soak.mts [seconds]
const fake: any = () => new Proxy(() => fake(), { get: () => fake() })
;(globalThis as any).document = { createElement: () => ({ getContext: () => fake() }) }
const { Fluid } = await import('../src/fluid.ts')
const { Protocell } = await import('../src/protocell.ts')
const { Nutrients } = await import('../src/nutrients.ts')
const { placeVents } = await import('../src/vents.ts')
const { newBrain, think } = await import('../src/ai.ts')
const { tuning, WORLD } = await import('../src/config.ts')
const { wrapDelta, rand } = await import('../src/math.ts')

const seconds = Number(process.argv[2] ?? 300)
const f = new Fluid()
const vents = placeVents()
const player = new Protocell(WORLD / 2, WORLD / 2, 1, 'player')
player.brain = newBrain()
let cells = [player]
const nut = new Nutrients()
nut.seed(player.cx, player.cy, vents)
const add = (sp: 'grazer' | 'engulfer', ratio: number) => {
  const c = new Protocell(rand(0, WORLD), rand(0, WORLD), ratio, sp)
  c.brain = newBrain()
  cells.push(c)
}
const steer = { x: 0, y: 0, mag: 0 }
const reported = new Set<Protocell>()
const lastEvent = new Map<Protocell, string>()
let t = 0
for (let s = 0; s < seconds * 60; s++) {
  const dt = 1 / 60
  t += dt
  if (s % 120 === 0) {
    while (cells.filter(c => c.species === 'grazer').length < 9)
      add('grazer', Math.exp(rand(Math.log(0.12), Math.log(1.3))))
    while (cells.filter(c => c.species === 'engulfer').length < 2) add('engulfer', rand(2.8, 4.5))
  }
  for (const c of cells) {
    const st = c.engulfedBy ? { x: 0, y: 0, mag: 0 } : think(c, dt, cells, nut, steer)
    for (let i = 0; i < 3; i++) c.step(dt / 3, f, st.x, st.y, st.mag, t, vents)
    f.dragToward(c.cx, c.cy, c.R * 1.05, c.cvx, c.cvy, tuning.wake)
  }
  for (let i = 0; i < cells.length; i++)
    for (let j = i + 1; j < cells.length; j++) {
      const a = cells[i]
      const b = cells[j]
      if (a.engulfedBy || b.engulfedBy) continue
      const d = Math.hypot(wrapDelta(b.cx - a.cx, WORLD), wrapDelta(b.cy - a.cy, WORLD))
      if (d > a.R + b.R) continue
      if (a.canEat(b)) {
        if (d < a.R) b.startEngulf(a)
      } else if (b.canEat(a)) {
        if (d < b.R) a.startEngulf(b)
      } else {
        a.pushOutOf(b)
        b.pushOutOf(a)
        lastEvent.set(a, `bumped ${b.species}(${b.biomass.toFixed(2)}) at t=${t.toFixed(2)}`)
        lastEvent.set(b, `bumped ${a.species}(${a.biomass.toFixed(2)}) at t=${t.toFixed(2)}`)
      }
    }
  for (const c of cells) if (c.gone && c.engulfedBy && !c.engulfedBy.gone) c.engulfedBy.ingestCell(c)
  cells = cells.filter(c => !c.gone)
  for (const v of vents) v.step(dt, f, nut)
  f.step(dt, t)
  nut.step(dt, f, vents, player.cx, player.cy)
  nut.sweep()

  for (const c of cells) {
    let max = 0
    for (const p of c.pts) max = Math.max(max, Math.hypot(p.x - c.cx, p.y - c.cy))
    const bad = !Number.isFinite(max) || max > c.R * 2.5
    if (bad && !reported.has(c)) {
      reported.add(c)
      console.log(
        `t=${t.toFixed(2)} ${c.species}(${c.biomass.toFixed(2)}) stretch ${(max / c.R).toFixed(1)}R ` +
          `centre (${c.cx.toFixed(0)},${c.cy.toFixed(0)}) engulfed=${!!c.engulfedBy} last: ${lastEvent.get(c) ?? '-'}`,
      )
    }
  }
}
console.log(`done: ${seconds}s simulated, ${reported.size} cells flagged`)
