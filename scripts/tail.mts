// Headless check that the flagellum grows out and trails straight behind a swimming cell.
const fake: any = () => new Proxy(() => fake(), { get: () => fake() })
;(globalThis as any).document = { createElement: () => ({ getContext: () => fake() }) }
const { Fluid } = await import('../src/fluid.ts')
const { Protocell } = await import('../src/protocell.ts')
const { WORLD } = await import('../src/config.ts')
const f = new Fluid()
const c = new Protocell(WORLD / 2, WORLD / 2, 1, 'player')
c.addTrait('flagellum')
let t = 0
const report = (label: string) => {
  const tail = c.flagellum!
  const reach = Math.hypot(tail.x[tail.x.length - 1] - tail.x[0], tail.y[tail.y.length - 1] - tail.y[0]) / (c.R * 2.1)
  // Is the tip behind the body relative to travel direction?
  const v = Math.hypot(c.cvx, c.cvy) || 1
  const behind = ((tail.x[tail.x.length - 1] - c.cx) * -c.cvx + (tail.y[tail.y.length - 1] - c.cy) * -c.cvy) / v / c.R
  console.log(
    `${label}: growth ${tail.growth.toFixed(2)} reach ${(reach * 100).toFixed(0)}% of length, tip ${behind.toFixed(1)}R behind`,
  )
}
const run = (secs: number, ix: number, iy: number, mag: number) => {
  for (let s = 0; s < secs * 60; s++) {
    t += 1 / 60
    for (let i = 0; i < 3; i++) c.step(1 / 180, f, ix, iy, mag, t, [])
    f.step(1 / 60, t)
  }
}
run(0.75, 1, 0, 1)
report('0.75s swimming right')
run(2, 1, 0, 1)
report('2.75s swimming right')
run(3, 0, 1, 1)
report('after turning down 3s')
run(3, 0, 0, 0)
report('idle 3s')
