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
