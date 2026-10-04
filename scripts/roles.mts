// Headless role checks: hunter faces its prey, telegraphs (coil) before lunging, then recovers.
// Usage: npx tsx scripts/roles.mts
const fake: any = () => new Proxy(() => fake(), { get: () => fake() })
;(globalThis as any).document = { createElement: () => ({ getContext: () => fake() }) }
const { Fluid } = await import('../src/fluid.ts')
const { Protocell } = await import('../src/protocell.ts')
const { Nutrients } = await import('../src/nutrients.ts')
const { newBrain, think } = await import('../src/ai.ts')
const { tuning } = await import('../src/config.ts')
tuning.currentStrength = 0

{
  const f = new Fluid()
  const hunter = new Protocell(500, 500, 3.5, 'engulfer')
  hunter.brain = newBrain()
  const prey = new Protocell(700, 540, 1, 'player') // inside the hunter's sensing range
  const cells = [hunter, prey]
  const nut = new Nutrients()
  const out = { x: 0, y: 0, mag: 0 }
  let t = 0
  let last = ''
  const log: string[] = []
  for (let s = 0; s < 8 * 60; s++) {
    t += 1 / 60
    const st = think(hunter, 1 / 60, cells, nut, out)
    for (let i = 0; i < 3; i++) {
      hunter.step(1 / 180, f, st.x, st.y, st.mag, t, [])
      prey.step(1 / 180, f, 0, 0, 0, t, [])
    }
    hunter.clearAim()
    f.step(1 / 60, t)
    if (hunter.pose !== last) {
      const dx = prey.cx - hunter.cx
      const dy = prey.cy - hunter.cy
      const err = Math.abs(
        Math.atan2(hunter.facingX * dy - hunter.facingY * dx, hunter.facingX * dx + hunter.facingY * dy),
      )
      log.push(
        `${t.toFixed(2)}s ${hunter.pose.padEnd(7)} facing error ${((err * 180) / Math.PI).toFixed(0)}°, gap ${(Math.hypot(dx, dy) - hunter.R - prey.R).toFixed(0)}`,
      )
      last = hunter.pose
    }
  }
  console.log('hunter vs still prey:\n  ' + log.join('\n  '))
}

// Moving feast: with no prey around, a hunter circles a food cloud's edge rather than sitting in it.
{
  const f = new Fluid()
  const hunter = new Protocell(300, 500, 3.5, 'engulfer')
  hunter.brain = newBrain()
  const nut = new Nutrients()
  for (let i = 0; i < 60; i++) nut.spawn('organic', 500 + (Math.random() - 0.5) * 80, 500 + (Math.random() - 0.5) * 80)
  const cells = [hunter]
  const out = { x: 0, y: 0, mag: 0 }
  let t = 0
  const dists: number[] = []
  let angle = 0
  let lastA = Math.atan2(hunter.cy - 500, hunter.cx - 500)
  for (let s = 0; s < 30 * 60; s++) {
    t += 1 / 60
    const st = think(hunter, 1 / 60, cells, nut, out)
    for (let i = 0; i < 3; i++) hunter.step(1 / 180, f, st.x, st.y, st.mag, t, [])
    hunter.clearAim()
    f.step(1 / 60, t)
    for (const n of nut.items) {
      n.vx = n.vy = 0 // hold the cloud still for the measurement
    }
    if (s > 10 * 60) {
      dists.push(Math.hypot(hunter.cx - 500, hunter.cy - 500))
      const a = Math.atan2(hunter.cy - 500, hunter.cx - 500)
      let da = a - lastA
      if (da > Math.PI) da -= Math.PI * 2
      if (da < -Math.PI) da += Math.PI * 2
      angle += da
      lastA = a
    } else lastA = Math.atan2(hunter.cy - 500, hunter.cx - 500)
  }
  const mean = dists.reduce((a, b) => a + b, 0) / dists.length
  console.log(
    `hunter patrol: distance from cloud centre ${Math.min(...dists).toFixed(0)}–${Math.max(...dists).toFixed(0)} (mean ${mean.toFixed(0)}), circled ${(Math.abs(angle) / (Math.PI * 2)).toFixed(1)} times in 20s`,
  )
}
