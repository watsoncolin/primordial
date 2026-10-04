# Primordial — build plan

**North star:** simple arcade physics on the surface, deep evolutionary roguelite underneath. Evolution changes physics, not numbers. A good upgrade makes you say _"oh, now I can do this"_, not _"now I have 12% more damage."_

**Golden rule:** every phase ends with a **playable build and a go/no-go question**. Don't start the next phase until the current one is fun. Order: **feel → choices → structure → chaos → meta → polish.**

---

## Stack

**TypeScript + Vite + Canvas2D** for the prototype, moving to **PixiJS** once entity counts demand it. Ship to mobile later with **Capacitor**.

- Fastest iteration: hot reload while tuning feel.
- Test on a phone over LAN from day one (`npm run dev` serves on the network). This is a touch/drag game, so mouse feel will lie to you.
- Capacitor gives iOS and Android from one codebase.
- **Custom physics.** Circle-vs-circle with a spatial hash is about 100 lines. A physics engine only becomes worth considering for multicellular soft bodies (Phase 4), so don't decide that yet.

---

## Phase 0 — The fun test (1–2 days)

Circles only. No tree, mutations, prestige, art or sound.

**Build:**

1. **Entity:** `{pos, vel, mass, radius = sqrt(mass)}`. Everything uses world units.
2. **Control:** drag to set thrust direction. Thrust force ∝ `mass^α` with α ≈ 0.7–0.8, so acceleration falls as you grow. That one exponent is the "freight train" knob.
3. **Drag:** linear drag so you coast. Tune it so coasting is useful.
4. **Eating:** you can absorb anything ≤ ~40% of your mass on overlap. Transfer the mass over ~0.2–0.5s instead of deleting the prey instantly; it feels much better. A bigger cell does the same to you.
5. **Camera:** `zoom = targetScreenRadius / player.radius`, smoothed. The player stays the same size on screen and the world shrinks.
6. **Scale-relative spawner (the key piece):**
   - Keep a target density of entities in a ring just outside the viewport.
   - Draw their masses from a **log distribution centred on the player's mass**, roughly 0.01× to 10×.
   - Despawn anything far away or under ~1px on screen. Optionally fold those into a "dust" background layer.
   - This makes the world feel infinite and continuously rescaling without simulating every scale at once.
7. **Floating origin:** recentre the world around the player now and then, so float precision holds up at 10⁶× growth.
8. **Minimal AI:** wander. If something bigger is within sense radius, flee. If something smaller is, chase.
9. **Death:** the membrane bursts into ~100 particles that nearby cells eat. Show what killed you.
10. **Debug panel (lil-gui):** live sliders for α, drag, eat ratio, spawn distribution and AI sense radius. Most of the phase is spent here.
11. **Telemetry overlay:** current mass multiple, time to 10×, time to 100×.

**Go/no-go:** Is 5 minutes of drifting from `o` to `O` fun? Does eating something that chased you two minutes ago feel good? Does being big actually feel heavy?

---

## Phase 1 — Core feel (~1 week)

Make the bare loop tense before adding any choices.

- **Energy** as a second resource next to biomass. Thrust costs energy, so holding full thrust isn't free and you can end up huge but exhausted.
- **AI archetypes:** chaser, ambusher, grazer, schooler, and a "fleer" that switches from hunting you to running once you outgrow it. Use simple steering behaviours, not behaviour trees.
- **Risky food (3–4 kinds):** toxic, hard-shelled, explosive, low-nutrition. Each recognisable by look (colour/shape), not by a label.
- **Rare giant:** something huge drifts through. You feel its current before you see it.
- **Eras from mass thresholds:** Microbe → Predator → Apex. Each changes the spawn mix.
- **Placeholder audio and haptics:** absorb pop, collision thump, a low rumble when something big is near. Cheap, and adds a lot to the feel.

**Go/no-go:** Does a 10-minute run have a rhythm of tension and relief, or is it just more mass?

---

## Phase 2 — Evolution tree (~2 weeks)

The system that makes it more than "Fishy with cells."

**Architecture (decide before content):** an organism is a body plus a list of **traits**. Each trait is data plus optional hooks:

```ts
interface Trait {
  id: string
  branch: Branch
  tags: string[]
  requires?: string[]
  excludes?: string[]
  onUpdate?(o: Organism, dt: number): void
  onCollide?(o: Organism, other: Organism, impact: Impact): CollisionResult
  modifyThrust?(o: Organism, t: Vec): Vec
  perception?(o: Organism, world: World): PerceptionLayer[]
}
```

- Every node is a component that changes physics or perception, never a stat bump. Collisions run through a pipeline the traits can intercept (spikes, engulf, bounce, …).
- **Evolution points:** for now, award one at mass milestones and when you eat rare organisms. Rebalance later.
- **Pick screen:** offer 2–3 choices, Hades-boon style. Show **???** for undiscovered children.
- **First content, ~12 nodes:**
  - **Mobility:** Flagellum → Burst Jet → Dual Flagella
  - **Predator:** Engulf → Spikes → Barbed (knocks chunks off bigger prey); Pseudopod → Tendril
  - **Senses:** Chemoreception (trails) → Mechanoreception (edge-of-screen pulse) → Predator Sense
- Senses is cheap to build, and changing what the player can see shows off "changes the game, not numbers" well.
- Hold back Colony (Phase 3) and Survival (needs biomes, Phase 6).
- Add one pair of mutually exclusive nodes to prove the exclusion system works.

**Go/no-go:** Do two runs with different picks _play_ differently, not just numerically?

---

## Phase 3 — Colony and multiple bodies (~2 weeks, biggest technical risk)

- **Mitosis:** one input splits you into two bodies at 50% mass each.
- **Controlling many cells:** all cells steer toward the input with flocking (separation, cohesion, alignment).
- **Camera with several bodies:** frame the colony's centroid and spread.
- **Recombine** and **Shared Membrane** (cells pass biomass between each other).
- **Swarm branch:** 2 → 4 → 8 → 16 → 32 cells. This is the performance stress test.
- **Defer Specialization** (hunter/tank/feeder/reproductive roles) to after launch.

**Go/no-go:** Is splitting a tense decision you weigh, or just "press when safe"?

---

## Phase 4 — Run structure and ending (~1–2 weeks)

- **Win condition:** biomass threshold + a set number of advanced adaptations.
- **Great Transition:** choose to split into many cells, then survive ~60 seconds while every nearby organism closes in. This is the boss fight.
- **Assembly:** cells stick together and the camera pulls back to reveal your multicellular form.
- **Lineage from trait tags:** sum branch tags to get a lineage (Predator-heavy → worm, Colony → sponge, Survival → tardigrade-ish, Mobility → swimmer, Parasite → parasite). Start with ~6 lineages + 2 hybrids.
- **Results screen:** time, peak mass, organisms consumed, evolutions, lineage name.
- **Decide here whether multicellular soft bodies need a physics engine.** Plain springs between circles with Verlet integration are probably enough.

**Go/no-go:** Is a full 20–30 minute run satisfying start to finish? This is the real "is it a game" moment.

---

## Phase 5 — Mutations (~1–2 weeks)

- **Same trait system:** a mutation is a trait with a positive and a negative effect, applied without the player choosing it.
- **Triggers:** eating, dividing, taking damage (radiation later).
- **Visible on the body:** a giant flagellum is rendered on one side and its thrust really is asymmetric. Physical consequences over stat penalties.
- **Cascades:** a mutation can add nodes to the tree (Hollow Spines → Venom Gland). The tree is built per run rather than fixed.
- **Bad-mutation rule:** every negative mutation comes with an offer to fix it or exploit it (Porous Membrane → Repair / Weaponize Leakage / Spore Trail).
- **First pool:** ~15 mutations, including 2–3 wild ones (Unstable Mitosis, Glass Cell, Cannibalism).
- **Defer** per-cell mutations inside a colony and the "favor lineage" selection mechanic until after launch.

---

## Phase 6 — Biomes and Survival branch (~2 weeks)

- **Regions in the continuous world:** currents, thermal vents, acid, darkness, UV light, nutrient clouds. Placed by a noise field, not levels.
- **Survival nodes are keys:** Thermophile, Acid Resistance, Radiation Resistance, Thick Membrane, Dormancy, Camouflage. They open regions that were deadly before.
- **Region ecosystems:** each region has its own spawn table.

---

## Phase 7 — Meta progression (~2 weeks)

Three layers: **Mass = this life. Evolution = this lineage. Prestige = across all life.**

- **Persistence:** local save, cloud sync later.
- **Discovery log:** organisms, mutations, adaptations and lineages found.
- **Prestige DNA from how you played**, not size: predation, exploration, colony, survival and adaptation scores. Farming one corner earns little.
- **Prestige unlocks possibilities, not stats:** extra mutation slot, Genetic Memory, Heritable Mutation, new branches (Symbiosis, Metabolism, …). The world grows by generation: Gen 2 adds viruses, Gen 3 parasites, Gen 4 environmental extremes, and so on.
- **Tree of Life screen:** each finished run becomes a branch with a generated species name. This is the game's signature screen, so give it real design time.
- **Endless mode:** a "Keep Growing" choice instead of Ascend.

---

## Phase 8 — Art, audio and shipping

Final art, full sound and haptics, the death spectacle, onboarding, Capacitor builds, store pages, TestFlight / Play internal-track beta.

---

## Scope for v1

| System         | v1                    | Later                                          |
| -------------- | --------------------- | ---------------------------------------------- |
| Tree nodes     | ~25 across 5 branches | Specialization, Symbiosis, Sexual Reproduction |
| Mutations      | ~20                   | Mutations inside a colony + selecting for them |
| Lineages       | ~12                   | 42-entry "Pokédex"                             |
| Organism types | ~15                   | Content added by generation                    |
| Modes          | Run + Endless         | Next evolutionary stage (sequel)               |

## Main risks

1. **Rescaling vs. float precision.** Handled by the scale-relative spawner and floating origin in Phase 0.
2. **Controlling 32 cells with one finger.** Prototype early in Phase 3. If it feels mushy, rethink the Colony branch.
3. **Runs get easier as you grow.** Momentum, energy, giants and the Transition boss all push back. Watch it in telemetry from Phase 1 on.
4. **Upgrades drifting into stat bumps.** Check every node against _"does it make me say 'oh, now I can do this'?"_
