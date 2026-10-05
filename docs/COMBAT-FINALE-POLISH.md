# Primordial — Combat and Finale Polish

Date: 4 October 2026

## Result

The existing collection, growth, mutation, evolution, and colony loop remains intact. This round completes active offense, adds escalating predator pressure to the Great Transition, bounds runaway growth, and makes the four paths impose meaningful tradeoffs.

## Combat

- **Ram Crest:** a frontal collision attack that rewards speed and alignment, follows the cell's facing, and has recovery. Wounds and the edible-size cue make progress against larger enemies readable.
- **Venom strike (F / strike):** a frontal jab with a 0.22-second wind-up and three-second recovery. It resolves against the enemy's current position, so movement can dodge it. Poison lasts four seconds, or six with Hollow Spines; refreshes do not stack. A hit interrupts an enemy's immediate attack.
- **Draining tendril (R / latch):** first wound a larger enemy, then attach while close. Targets up to four times your biomass are eligible. The tether drains biomass, transfers some to you, and sharply restricts your movement. Outward swimming, separation, consumption eligibility, or six seconds breaks the hold; recovery prevents immediate reattachment.
- A short input buffer allows a quick F-then-R combination. Cooldown, release countdown, and brief failed-action messages explain what happened. These attacks carry into the colony phase.
- Keyboard and on-screen buttons are supported. Normal movement remains arrows/WASD, mouse hold, or touch joystick. Sticky mode remains available; Space stops and B bursts in that mode.

## Paths and growth

The distinct base bodies and twelve-branch tree remain. Pursuer gains thrust but takes greater wound damage and uses light poorly. Bulwark absorbs wounds better and hits harder with its ram, at a movement cost. Trapper drains more effectively but moves and rams less effectively. Producer gains more from light while moving more slowly and assimilating meals less efficiently.

Each path has native body systems and may acquire one foreign body system. Existing descendants and survival branches remain available. This preserves hybrid choices while preventing every lineage from acquiring all four body roots.

Early growth and mineral thresholds remain unchanged. Growth tapers beyond biomass ×32 and is bounded at ×128; NPC and colony growth also have bounds. The HUD identifies maturity. This prevents the replacement-meal feedback loop that previously produced quadrillions of biomass.

## Great Transition

- The full sixty-second survival objective remains: keep at least three colony members alive.
- Three, four, then five eligible predators pursue the colony across three twenty-second stages. Undersized hunters do not count toward that pressure.
- Hunters select exposed, edible colony members. Attacks have a visible wind-up and a committed lunge direction, followed by recovery. Sidestepping can evade a strike.
- Nearby attack tells and threat cues support reacting to danger; darkness still limits visibility.
- Survivors bind into the existing lineage form. Run records now include combat and predator-lunge counts.
- Development practice scenarios do not award DNA or save discoveries.

## Validation

- Production build and TypeScript checks pass; formatting and whitespace checks pass.
- Assertions cover venom timing/dodging/recovery, tether transfer/escape/lifetime, growth bounds, path hybrid restrictions, raid targeting, and committed lunge direction.
- Existing ram and evolution-tree assertions pass, including turning without a flagellum and twelve reachable branches. Trait, mutation, biome, role, and lineage diagnostics completed successfully.
- The scale simulation reported no geometry problems while reaching the growth cap.
- Actual browser play: a venom-plus-tendril attachment worked. A Producer fixture survived the full minute with **6/8** cells; a Bulwark fixture survived with **7/8**, recording **9** predator lunges. Neither finale used the timer skip.
- Production startup, mobile controls, and the scrollable evolution tree were checked at 390 × 844. No browser runtime errors were reported.

These finale results use development fixtures, not complete natural progression runs. They establish functional, survivable encounters; they do not establish win rates across all builds and mutation combinations.

## Deliberately deferred

Do not add a boss, projectile arsenal, new currencies, a second multicellular campaign, or per-cell colony mutation selection in this round. Keep tuning the existing nutrient ecosystem, four identities, close-range offense, and survival finale before expanding scope.
