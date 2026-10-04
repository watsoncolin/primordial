// Headless trait checks: engulfing reach, photosynthesis growth, membrane reseal.
// Usage: npx tsx scripts/traits.mts
const fake: any = () => new Proxy(() => fake(), { get: () => fake() })
;(globalThis as any).document = { createElement: () => ({ getContext: () => fake() }) }
const { Fluid } = await import('../src/fluid.ts')
const { Protocell } = await import('../src/protocell.ts')
const { tuning, WORLD } = await import('../src/config.ts')
const { MEMBRANE_RESEAL } = await import('../src/traits.ts')
tuning.currentStrength = 0

const sim = (cells: InstanceType<typeof Protocell>[], secs: number, steer: (c: any) => [number, number, number]) => {
  const f = new Fluid()
  for (let s = 0, t = 0; s < secs * 60; s++) {
    t += 1 / 60
    for (const c of cells) {
      const [x, y, m] = steer(c)
      for (let i = 0; i < 3; i++) c.step(1 / 180, f, x, y, m, t, [])
    }
    f.step(1 / 60, t)
  }
}

// Engulfing: who can be eaten, and how far the pseudopod grabs.
{
  const plain = new Protocell(500, 500, 1, 'player')
  const eng = new Protocell(500, 500, 1, 'player')
  eng.addTrait('engulfing')
  const prey = new Protocell(600, 500, 0.55, 'grazer')
  console.log(`engulfing: plain can eat 0.55x? ${plain.canEat(prey)}; engulfing can? ${eng.canEat(prey)}`)
  eng.reachWant = 1
  eng.reachDirX = 1
  sim([eng], 1, () => [0, 0, 0])
  const front = Math.max(...eng.pts.map((p: any) => p.x - eng.cx))
  const back = Math.max(...eng.pts.map((p: any) => eng.cx - p.x))
  console.log(
    `engulfing: pseudopod out ${(front / eng.R).toFixed(2)}R toward prey vs ${(back / eng.R).toFixed(2)}R behind; grab radius ${(eng.grabRadius / eng.R).toFixed(2)}R`,
  )
}

// Photosynthesis: biomass gained per minute holding still vs swimming.
for (const still of [true, false]) {
  const c = new Protocell(500, 500, 1, 'player')
  c.addTrait('photosynthesis')
  sim([c], 60, () => (still ? [0, 0, 0] : [1, 0, 1]))
  console.log(`photosynthesis ${still ? 'still   ' : 'swimming'}: biomass ×1.00 → ×${c.biomass.toFixed(2)} in 60s`)
}

// Membrane: reseal time after cracking.
{
  const c = new Protocell(500, 500, 1, 'player')
  c.addTrait('membrane')
  c.armor = 0
  let t = 0
  const f = new Fluid()
  while (c.armor < 1 && t < 60) {
    t += 1 / 60
    for (let i = 0; i < 3; i++) c.step(1 / 180, f, 0, 0, 0, t, [])
  }
  console.log(`membrane: reseals in ${t.toFixed(1)}s (expected ${MEMBRANE_RESEAL}s)`)
}

// Burst jet: peak speed right after a dash from cruising, and the cooldown.
{
  const c = new Protocell(500, 500, 1, 'player')
  c.addTrait('flagellum')
  c.addTrait('burst')
  sim([c], 4, () => [1, 0, 1])
  const cruise = Math.hypot(c.cvx, c.cvy)
  c.dash()
  sim([c], 0.1, () => [1, 0, 1])
  const peak = Math.hypot(c.cvx, c.cvy)
  const again = c.dash()
  sim([c], 1.5, () => [1, 0, 1])
  console.log(
    `burst: cruise ${cruise.toFixed(0)} → ${peak.toFixed(0)} right after dash, back to ${Math.hypot(c.cvx, c.cvy).toFixed(0)} after 1.5s; immediate re-dash allowed? ${again}`,
  )
}

// Lure: a small grazer near a hungry cell flees normally, but drifts toward a lure-bearer.
{
  const { newBrain, think } = await import('../src/ai.ts')
  const { Nutrients } = await import('../src/nutrients.ts')
  for (const withLure of [false, true]) {
    const hunter = new Protocell(500, 500, 1, 'player')
    if (withLure) {
      hunter.addTrait('photosynthesis')
      hunter.addTrait('lure')
    }
    const g = new Protocell(600, 500, 0.3, 'grazer')
    g.brain = newBrain()
    const cells = [hunter, g]
    const nut = new Nutrients()
    const out = { x: 0, y: 0, mag: 0 }
    const f = new Fluid()
    let t = 0
    for (let s = 0; s < 4 * 60; s++) {
      t += 1 / 60
      const st = think(g, 1 / 60, cells, nut, out)
      for (let i = 0; i < 3; i++) {
        hunter.step(1 / 180, f, 0, 0, 0, t, [])
        g.step(1 / 180, f, st.x, st.y, st.mag, t, [])
      }
      f.step(1 / 60, t)
    }
    const gap = Math.hypot(g.cx - hunter.cx, g.cy - hunter.cy) - hunter.R - g.R
    console.log(
      `lure ${withLure ? 'on ' : 'off'}: grazer started 100 away (centre to centre), gap after 4s ${gap.toFixed(0)}`,
    )
  }
}
