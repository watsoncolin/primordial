import assert from 'node:assert/strict'
const fake: any = () => new Proxy(() => fake(), { get: () => fake() })
;(globalThis as any).document = { createElement: () => ({ getContext: () => fake() }) }
const { ramImpact } = await import('../src/combat.ts')
const { Protocell } = await import('../src/protocell.ts')
const { newBrain, think } = await import('../src/ai.ts')
const { Nutrients } = await import('../src/nutrients.ts')
assert.equal(ramImpact(100, 70, 1, false), 1)
for (const args of [
  [100, 70, 0.2, false],
  [30, 70, 1, false],
  [100, 0, 1, false],
  [100, 70, 1, true],
] as const)
  assert.equal(ramImpact(...args), 0)
const attacker = new Protocell(500, 500, 1, 'player')
attacker.addTrait('membrane')
attacker.addTrait('spikes')
attacker.addTrait('engulfing')
const prey = new Protocell(570, 500, 1.3, 'grazer')
prey.brain = newBrain()
assert.equal(attacker.canEat(prey), false)
for (let i = 0; i < 3; i++) prey.grow(-prey.biomass * 0.24)
assert.equal(attacker.canEat(prey), true)
prey.brain.attacker = attacker
prey.brain.alarm = 6
const out = { x: 0, y: 0, mag: 0 }
think(prey, 0.016, [prey, attacker], new Nutrients(), out)
assert(out.x > 0, 'injured prey should flee away from attacker')
const hunter = new Protocell(570, 500, 4, 'engulfer')
hunter.brain = newBrain()
hunter.brain.attacker = attacker
hunter.brain.alarm = 6
think(hunter, 0.016, [hunter, attacker], new Nutrients(), out)
assert.equal(hunter.brain.prey, attacker)
assert(out.x < 0, 'hunter should approach attacker')
console.log('Passed: frontal/speed/recovery gates, larger prey weakened to edible size, fleeing and retaliation.')

// A ram must be aimable without requiring the separate flagellum adaptation.
const { Fluid } = await import('../src/fluid.ts')
const { tuning } = await import('../src/config.ts')
tuning.currentStrength = 0
const rammer = new Protocell(500, 500, 1, 'player')
rammer.addTrait('membrane')
rammer.addTrait('spikes')
const fluid = new Fluid()
for (let step = 0; step < 540; step++) {
  rammer.step(1 / 180, fluid, 0, 1, 1, step / 180, [])
}
assert(rammer.facingY > 0.85, 'ram crest should turn toward steering without a flagellum')
assert(Math.abs(rammer.facingX) < 0.5, 'ram crest must stop facing the original direction')
console.log('Passed: ram-equipped cell turns toward steering without a flagellum.')
