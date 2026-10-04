// Headless handling check: top speed and how long a 180° reversal takes, with and without traits.
// Usage: npx tsx scripts/handling.mts
const fake: any = () => new Proxy(() => fake(), { get: () => fake() })
;(globalThis as any).document = { createElement: () => ({ getContext: () => fake() }) }
const { Fluid } = await import('../src/fluid.ts')
const { Protocell } = await import('../src/protocell.ts')
const { tuning, WORLD } = await import('../src/config.ts')

tuning.currentStrength = 0 // still water, so numbers are comparable
for (const traits of [[], ['flagellum']] as const) {
  const f = new Fluid()
  const c = new Protocell(WORLD / 2, WORLD / 2, 1, 'player')
  for (const t of traits) c.addTrait(t)
  let t = 0
  const run = (secs: number, ix: number, iy: number, until?: () => boolean) => {
    for (let s = 0; s < secs * 60; s++) {
      t += 1 / 60
      for (let i = 0; i < 3; i++) c.step(1 / 180, f, ix, iy, 1, t, [])
      f.dragToward(c.cx, c.cy, c.R * 1.05, c.cvx, c.cvy, tuning.wake)
      f.push(c.jetX, c.jetY, c.R * 0.9, -c.steerX * c.thrust * tuning.jet, -c.steerY * c.thrust * tuning.jet)
      f.step(1 / 60, t)
      if (until?.()) return s / 60
    }
    return Infinity
  }
  run(5, 1, 0)
  const top = Math.hypot(c.cvx, c.cvy)
  // Reverse: time until velocity points mostly left at decent speed.
  const reverse = run(10, -1, 0, () => c.cvx < -top * 0.5)
  console.log(
    `${traits.join('+') || 'none'}: top speed ${top.toFixed(0)}, reverse to half speed ${reverse.toFixed(2)}s`,
  )
}
