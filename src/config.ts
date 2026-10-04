/** World is a torus this many units across; everything wraps. */
export const WORLD = 1536
/** Fluid grid resolution per side. Must be a power of two. */
export const GRID = 128

/** Radius of a cell with biomass 1 (the player's starting size). Radius scales with sqrt(biomass). */
export const PROTOCELL_RADIUS = 26
/** A cell can engulf anything with at most this fraction of its biomass. */
export const EAT_RATIO = 0.4
/** Thrust force ∝ biomass^MASS_EXPONENT, so acceleration falls as cells get heavier. */
export const MASS_EXPONENT = 0.8

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
  // Ecosystem
  grazers: 9,
  engulfers: 2,
  engulferSense: 200,
  engulferStamina: 6,
  /** Thrust multiplier during an engulfer's short lunge at nearby prey. */
  engulferLunge: 3.2,
  // Debug
  showFlow: false,
}
