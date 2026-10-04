/** World is a torus this many units across; everything wraps. */
export const WORLD = 1536
/** Fluid grid resolution per side. Must be a power of two. */
export const GRID = 128

export const PROTOCELL_RADIUS = 26

/** Live-tunable values, exposed in the lil-gui panel. */
export const tuning = {
  // Fluid
  pressureIterations: 10,
  currentStrength: 28,
  currentRelax: 0.4,
  wake: 6,
  jet: 1.6,
  // Protocell
  thrust: 80,
  pulse: 0.4,
  pulseRate: 1.6,
  drag: 1.6,
  frontDrag: 1.2,
  stiffness: 90,
  wobbleDamping: 2.5,
  // Feeding
  capture: 260,
  // Debug
  showFlow: false,
}
