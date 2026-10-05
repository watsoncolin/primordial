# Primordial

**[Play it in your browser →](https://watsoncolin.github.io/primordial/)**

A 2D microbe evolution roguelite. Start as a single cell, eat smaller things, avoid bigger ones, and grow while the world continuously rescales around you. Evolve physics-changing adaptations, survive random mutations, and make the Great Transition to multicellular life.

See [docs/PLAN.md](docs/PLAN.md) for the design and build plan.

## Development

```sh
npm install
npm run dev        # serves on your LAN too, so you can open it on your phone
npm run typecheck
npm run format
```

Tuning sliders live in the collapsible panel in the top-right corner.

## Controls

- Swim with arrows/WASD, or hold and drag with the mouse. Touch uses a floating joystick.
- Burst Jet: Space or the jet button once evolved.
- Venom: F or strike; aim your prow at a nearby enemy.
- Feeding Tendril: R or latch; first wound a larger enemy, then attach and drain it. Press again to release.
- T opens the Great Transition when ready. L opens the Tree of Life; M toggles sound.
- Life guide and evolution tree pause the game while you browse.

For input that persists between presses, open `?sticky` or enable sticky movement in Tuning. Arrows set a direction, Space stops, and B triggers Burst Jet.

See [the combat and finale polish notes](docs/COMBAT-FINALE-POLISH.md) for this implementation round and validation.
