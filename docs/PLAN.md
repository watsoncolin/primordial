# Primordial — build plan

**North star:** simple arcade physics on the surface, deep evolutionary roguelite underneath. Evolution changes physics, not numbers.

Every phase ends with a playable build and a go/no-go question. Don't start the next phase until the current one is fun.

**Stack:** TypeScript + Vite, Canvas2D for the prototype (PixiJS once entity counts demand it), custom circle physics with a spatial hash, Capacitor for iOS/Android later.

## Phase 0 — Fun test (circles only)

- Entity `{pos, vel, mass, radius = sqrt(mass)}`
- Drag-to-thrust; thrust ∝ mass^α (α ≈ 0.7–0.8) so big = sluggish
- Linear drag / coasting
- Absorb ≤ ~40% of your mass, mass transferred over ~0.2–0.5s
- Camera: `zoom = targetScreenRadius / player.radius` (smoothed)
- Scale-relative spawner: log-distributed masses centred on player mass; despawn far / sub-pixel entities
- Floating origin to keep float precision sane at huge scales
- AI: wander / flee bigger / chase smaller
- Death: membrane bursts into particles that others eat
- lil-gui tuning panel + telemetry (mass multiple, time to 10×/100×)

**Go/no-go:** Is 5 minutes of growing from `o` to `O` fun? Does eating something that chased you earlier feel good? Does being huge feel heavy?

## Phase 1 — Core feel

Energy alongside biomass · AI archetypes (chaser, ambusher, grazer, schooler, flips-to-fleeing) · risky food (toxic, shelled, explosive, low-nutrition) · rare giants · mass-based eras (Microbe → Predator → Apex) · placeholder audio/haptics.

## Phase 2 — Evolution tree

Organism = body + traits. Traits are data + hooks (`onUpdate`, `onCollide`, `modifyThrust`, `perception`), with `requires`/`excludes`. 2–3 choice picks, `???` for undiscovered nodes. Start with ~12 nodes across Mobility, Predator, Senses.

## Phase 3 — Colony / multi-body

Mitosis, flocking control, centroid camera, recombine, Shared Membrane, Swarm (up to 32 cells). Biggest technical risk.

## Phase 4 — Run structure & ending

Win requirements → Great Transition (split + survive ~60s) → colony assembles → lineage from trait tags → results screen.

## Phase 5 — Mutations

Mutations are traits applied without the player choosing them; they're visible on the body, can unlock tree nodes, and bad ones offer fix-or-exploit adaptations. ~15 to start.

## Phase 6 — Biomes & Survival branch

Regions placed by a noise field (vents, acid, dark, UV, currents); Survival nodes open regions.

## Phase 7 — Meta

Persistence, discovery log, lifestyle-based DNA, prestige that unlocks possibilities (not stats), generation-gated content, Tree of Life screen, Endless mode.

## Phase 8 — Polish & ship

Art, audio, haptics, onboarding, Capacitor builds, store pages.

## Deferred past v1

Cell specialization · per-cell mutations / favor lineage · symbiosis · sexual reproduction · later evolutionary stages.
