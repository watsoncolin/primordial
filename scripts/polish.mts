import assert from 'node:assert/strict'
const fake: any = () => new Proxy(() => fake(), { get: () => fake() })
;(globalThis as any).document = { createElement: () => ({ getContext: () => fake() }) }
const { Protocell } = await import('../src/protocell.ts')
const { newBrain, think } = await import('../src/ai.ts')
const { Nutrients } = await import('../src/nutrients.ts')
const { DrainTether, venomStrike, canLatch, STRIKE_WINDUP } = await import('../src/offensive.ts')
const { raidPopulation, exposedPrey } = await import('../src/finale.ts')
const { boundedGrowth, MAX_RUN_BIOMASS, PATH_BALANCE } = await import('../src/balance.ts')
const { availableTraits } = await import('../src/traits.ts')
const { scale } = await import('../src/scale.ts')
scale.biomass = 1
const attacker = new Protocell(500, 500, 1, 'player')
attacker.setPath('trapper')
for (const trait of ['engulfing', 'tendril', 'membrane', 'spikes', 'venom'] as const) attacker.addTrait(trait)
const target = new Protocell(580, 500, 2.8, 'engulfer')
target.brain = newBrain()
assert.equal(venomStrike(attacker, [attacker, target], 0.1, true), undefined)
assert.equal(target.poison, 0, 'wind-up should not apply poison early')
assert.equal(venomStrike(attacker, [attacker, target], STRIKE_WINDUP, false), target)
assert.equal(target.poison, 4)
assert.equal(target.brain.attacker, attacker)
assert.equal(venomStrike(attacker, [attacker, target], 0.3, true), undefined, 'cooldown rejects repeat attacks')
// Moving outside range during the wind-up dodges the strike.
attacker.attackCooldown = 0
venomStrike(attacker, [target], 0.1, true)
for (const p of target.pts) p.x += 300
// The controller resolves using current centre, as the simulation updates it.
target.cx += 300
assert.equal(venomStrike(attacker, [target], 0.2, false), null)
for (const p of target.pts) p.x -= 300
target.cx -= 300
assert(canLatch(attacker, target))
const tether = new DrainTether()
assert(tether.start(attacker, target))
const initial = target.biomass
for (let i = 0; i < 60; i++) tether.step(attacker, 1 / 60)
assert(target.biomass < initial && attacker.biomass > 1)
assert(attacker.tethered)
// Active outward swimming breaks the hold and applies recovery.
target.cvx = 100
for (let i = 0; i < 35; i++) tether.step(attacker, 1 / 60)
assert.equal(tether.target, null)
assert(!attacker.tethered)
assert(tether.cooldown > 0)
assert(!tether.start(attacker, target), 'cannot immediately re-latch')
const tether2 = new DrainTether()
target.cvx = 0
target.wounded = 4
assert(tether2.start(attacker, target))
tether2.step(attacker, 6.1)
assert.equal(tether2.target, null, 'attachment has a finite lifetime')
// Biomass is bounded over a long sequence of increasingly rich replacement meals.
let biomass = 1
for (let i = 0; i < 10000; i++) biomass = boundedGrowth(biomass, biomass * 0.4, MAX_RUN_BIOMASS, true)
assert(Number.isFinite(biomass))
assert(biomass <= MAX_RUN_BIOMASS)
assert(biomass > 100)
const player = new Protocell(500, 500, 1, 'player')
player.grow(1e18)
assert.equal(player.biomass, MAX_RUN_BIOMASS)
assert(boundedGrowth(1, 0.05, 128, true) === 1.05, 'opening growth stays unchanged')
assert(boundedGrowth(96, 10, 128, true) < 106, 'mature growth tapers')
// A foreign body root locks a second foreign root; native systems and descendants remain available.
const hybrid = new Set<any>(['engulfing', 'photosynthesis', 'membrane'])
assert(!availableTraits(hybrid, new Set(), 'trapper').some(t => t.id === 'flagellum'))
assert(availableTraits(hybrid, new Set(), 'trapper').some(t => t.id === 'spikes'))
assert(availableTraits(hybrid, new Set(), 'trapper').some(t => t.id === 'lure'))
assert(PATH_BALANCE.producer.assimilation < PATH_BALANCE.pursuer.assimilation)
assert(PATH_BALANCE.pursuer.damage > PATH_BALANCE.bulwark.damage)
assert.deepEqual([0, 20, 40].map(raidPopulation), [3, 4, 5])
const members = [new Protocell(600, 500, 1, 'player'), new Protocell(700, 500, 1, 'player')]
for (const c of members) c.colony = true
const hunter = new Protocell(800, 500, 3, 'engulfer')
hunter.brain = newBrain()
hunter.brain.raid = true
hunter.brain.retarget = 0
assert.equal(exposedPrey(hunter, members), members[1])
const out = { x: 0, y: 0, mag: 0 }
think(hunter, 0.1, [hunter, ...members], new Nutrients(), out)
assert(hunter.brain.prey === members[1], 'raid should actively target the exposed member')
assert(out.x < 0)
console.log(
  'Passed: venom timing/dodge/cooldown, draining/escape/recovery, bounded growth, hybrid commitments, and raid targeting.',
)

// A hunter commits to its wind-up heading instead of steering at a moving victim mid-lunge.
hunter.brain.coil = 0.01
hunter.facingX = -1
hunter.facingY = 0
think(hunter, 0.02, [hunter, ...members], new Nutrients(), out)
assert.equal(out.x, -1)
assert.equal(out.y, 0)
members[1].cy += 200
think(hunter, 0.1, [hunter, ...members], new Nutrients(), out)
assert.equal(out.x, -1)
assert.equal(out.y, 0, 'a sidestep should not be followed during the strike')
console.log('Passed: telegraphed lunges keep their committed direction.')
