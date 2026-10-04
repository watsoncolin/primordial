import { TAU, rand } from './math'
import type { Species } from './protocell'

/**
 * How each kind of organism is built and moves. The collision body is always the biomass-derived
 * circle; these shapes are what the membrane springs toward, so roles read from silhouette and
 * motion rather than colour alone.
 */
export interface BodyPlan {
  /** Rest radius multiplier around the body; angle 0 is the front. Averages about 1. */
  profile: (angle: number, seed: ShapeSeed) => number
  /** Turns to face where it's going (torque only; never adds thrust). */
  directional: boolean
  turn: number
  /** Rim stroke width and opacity relative to the player's, which stays the strongest. */
  rim: number
  rimAlpha: number
  /** Body fill opacity multiplier. */
  fill: number
  /** Floating interior particles. */
  inner: number
  /** Breathing amplitude and pace multipliers. */
  squirm: number
  squirmRate: number
}

/** Per-cell randomness fixed at birth, so no two sacs or rosettes look identical. */
export interface ShapeSeed {
  p1: number
  p2: number
  lobes: number
}

export function newShapeSeed(): ShapeSeed {
  return { p1: rand(0, TAU), p2: rand(0, TAU), lobes: 3 + Math.floor(rand(0, 3)) }
}

/** Polar radius of an ellipse with semi-axes a (front-back) and b (side to side). */
const ellipse = (t: number, a: number, b: number) => 1 / Math.sqrt((Math.cos(t) / a) ** 2 + (Math.sin(t) / b) ** 2)
const front = (t: number) => Math.max(0, Math.cos(t))
const rear = (t: number) => Math.max(0, -Math.cos(t))

export const PLANS: Record<Species, BodyPlan> = {
  // The starting protocell: round, bright-rimmed. Everything else is measured against it.
  player: {
    profile: () => 1,
    directional: false,
    turn: 0,
    rim: 1,
    rimAlpha: 0.6,
    fill: 1,
    inner: 3,
    squirm: 1,
    squirmRate: 1,
  },
  offspring: {
    profile: () => 1,
    directional: false,
    turn: 0,
    rim: 0.7,
    rimAlpha: 0.45,
    fill: 0.8,
    inner: 2,
    squirm: 1,
    squirmRate: 1,
  },
  // Drifting protocell: a thin, irregular, clear sac with a lazy asymmetric squirm.
  grazer: {
    profile: (t, s) => 1 + 0.09 * Math.sin(2 * t + s.p1) + 0.06 * Math.sin(3 * t + s.p2),
    directional: false,
    turn: 0,
    rim: 0.5,
    rimAlpha: 0.4,
    fill: 0.5,
    inner: 1,
    squirm: 2.6,
    squirmRate: 0.55,
  },
  // Flagellated hunter: a directional teardrop, narrow at the tail, with a feeding bulge in front.
  engulfer: {
    profile: t => ellipse(t, 1.24, 0.82) * (1 - 0.16 * rear(t) ** 2) * (1 + 0.08 * front(t) ** 6),
    directional: true,
    turn: 170,
    rim: 0.85,
    rimAlpha: 0.5,
    fill: 1,
    inner: 4,
    squirm: 0.6,
    squirmRate: 1,
  },
  // Light colony: three to five rounded lobes in a rosette.
  producer: {
    profile: (t, s) => 0.78 + 0.3 * (0.5 + 0.5 * Math.cos(s.lobes * t + s.p1)) ** 1.5,
    directional: false,
    turn: 0,
    rim: 0.55,
    rimAlpha: 0.45,
    fill: 0.85,
    inner: 0,
    squirm: 0.35,
    squirmRate: 0.5,
  },
  // Armored scavenger: a squat bean, flat on one side.
  scavenger: {
    profile: t => ellipse(t, 1.2, 0.8) * (1 - 0.13 * Math.max(0, Math.sin(t)) ** 3),
    directional: true,
    turn: 90,
    rim: 0.6,
    rimAlpha: 0.45,
    fill: 0.9,
    inner: 2,
    squirm: 0.4,
    squirmRate: 0.7,
  },
  // Anchored filter feeder: a wide, shallow cup opening toward the current.
  filter: {
    profile: t => ellipse(t, 0.72, 1.22) * (1 - 0.2 * front(t) ** 2),
    directional: true,
    turn: 140,
    rim: 0.6,
    rimAlpha: 0.45,
    fill: 0.8,
    inner: 1,
    squirm: 0.4,
    squirmRate: 0.6,
  },
}

/** Below this on-screen radius, fine detail (fringe, plate seams, light structures) is skipped. */
export const DETAIL_MIN_PX = 9

/**
 * Thick membrane as broad armour plates following the outline. As armour cracks, the plates pull
 * apart, recoil outward and dim; as it reseals they close back up.
 */
export function drawPlates(
  ctx: CanvasRenderingContext2D,
  sx: Float32Array,
  sy: Float32Array,
  cx: number,
  cy: number,
  R: number,
  armor: number,
  rgb: string,
  count: number,
) {
  const n = sx.length
  const broken = 1 - armor
  const gap = 1.1 + broken * 1.6
  const out = R * (0.03 + broken * 0.12)
  ctx.lineCap = 'round'
  for (let k = 0; k < count; k++) {
    const start = (k / count) * n + gap / 2
    const end = ((k + 1) / count) * n - gap / 2
    ctx.beginPath()
    for (let f = start; f <= end; f += 0.5) {
      const i = Math.floor(f) % n
      const j = (i + 1) % n
      const t = f - Math.floor(f)
      const x = sx[i] + (sx[j] - sx[i]) * t
      const y = sy[i] + (sy[j] - sy[i]) * t
      const dx = x - cx
      const dy = y - cy
      const d = Math.hypot(dx, dy) || 1
      const px = x + (dx / d) * out
      const py = y + (dy / d) * out
      if (f === start) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.lineWidth = Math.max(2, R * 0.17)
    ctx.strokeStyle = `rgba(${rgb},${0.22 + 0.25 * armor})`
    ctx.stroke()
    ctx.lineWidth = Math.max(1, R * 0.05)
    ctx.strokeStyle = `rgba(${rgb},${0.45 + 0.4 * armor})`
    ctx.stroke()
  }
}

/** A forward feeding fold: a crescent pressed into the front of the body. */
export function drawFold(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  R: number,
  fx: number,
  fy: number,
  rgb: string,
  open: number,
) {
  const px = -fy
  const py = fx
  const tipX = cx + fx * R * 0.92
  const tipY = cy + fy * R * 0.92
  const w = R * (0.32 + 0.1 * open)
  const depth = R * (0.22 + 0.15 * open)
  ctx.beginPath()
  ctx.moveTo(tipX + px * w, tipY + py * w)
  ctx.quadraticCurveTo(tipX - fx * depth, tipY - fy * depth, tipX - px * w, tipY - py * w)
  ctx.lineCap = 'round'
  ctx.lineWidth = Math.max(1.2, R * 0.07)
  ctx.strokeStyle = `rgba(${rgb},0.75)`
  ctx.stroke()
}

/** The filter feeder's beating fringe along its open, current-facing edge. */
export function drawFringe(
  ctx: CanvasRenderingContext2D,
  sx: Float32Array,
  sy: Float32Array,
  cx: number,
  cy: number,
  R: number,
  fx: number,
  fy: number,
  time: number,
  open: number,
  rgb: string,
) {
  if (open <= 0.05) return
  ctx.beginPath()
  for (let i = 0; i < sx.length; i++) {
    const dx = sx[i] - cx
    const dy = sy[i] - cy
    const d = Math.hypot(dx, dy) || 1
    const nx = dx / d
    const ny = dy / d
    const facing = nx * fx + ny * fy
    if (facing < 0.15) continue
    const beat = Math.sin(time * 9 - i * 0.9) * 0.6
    const len = R * 0.32 * open * facing
    const ex = nx * Math.cos(beat) - ny * Math.sin(beat)
    const ey = nx * Math.sin(beat) + ny * Math.cos(beat)
    ctx.moveTo(sx[i], sy[i])
    ctx.lineTo(sx[i] + ex * len, sy[i] + ey * len)
  }
  ctx.lineCap = 'round'
  ctx.lineWidth = Math.max(1, R * 0.035)
  ctx.strokeStyle = `rgba(${rgb},0.7)`
  ctx.stroke()
}

/** The stalk tying a filter feeder to the rock. */
export function drawStalk(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  R: number,
  rgb: string,
) {
  const mx = (ax + bx) / 2 + (by - ay) * 0.15
  const my = (ay + by) / 2 - (bx - ax) * 0.15
  ctx.beginPath()
  ctx.moveTo(ax, ay)
  ctx.quadraticCurveTo(mx, my, bx, by)
  ctx.lineCap = 'round'
  ctx.lineWidth = Math.max(1.5, R * 0.14)
  ctx.strokeStyle = `rgba(${rgb},0.55)`
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(ax, ay, Math.max(1.5, R * 0.16), 0, TAU)
  ctx.fillStyle = `rgba(${rgb},0.6)`
  ctx.fill()
}

/** A light-catching plate: a flat green disc with stacked membranes inside (like a chloroplast). */
export function drawLightPlate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  angle: number,
  alpha: number,
) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.beginPath()
  ctx.ellipse(0, 0, r, r * 0.55, 0, 0, TAU)
  ctx.fillStyle = `rgba(120,225,110,${0.35 * alpha})`
  ctx.fill()
  ctx.lineWidth = Math.max(0.6, r * 0.12)
  ctx.strokeStyle = `rgba(170,250,150,${0.8 * alpha})`
  ctx.stroke()
  if (r > 2.5) {
    ctx.beginPath()
    for (const k of [-0.25, 0, 0.25]) {
      ctx.moveTo(-r * 0.6, r * k)
      ctx.lineTo(r * 0.6, r * k)
    }
    ctx.lineWidth = Math.max(0.5, r * 0.08)
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * Small anatomy for adaptations that would otherwise leave the body unchanged, so every first
 * pick shows on the cell: sensory whiskers, a heat-hardened inner lining, dark pigment, a waxy
 * acid-proof coat, a ring of touch-sensitive hairs, venom-tipped spikes.
 */
export function drawTraitMarks(
  ctx: CanvasRenderingContext2D,
  traits: Set<string>,
  sx: Float32Array,
  sy: Float32Array,
  cx: number,
  cy: number,
  R: number,
  fx: number,
  fy: number,
  path: Path2D,
  time: number,
  emphasis: number,
) {
  const boost = 1 + emphasis * 0.8
  if (traits.has('pigment')) {
    // UV pigment: a dark sunscreen tint through the whole body.
    ctx.fillStyle = `rgba(70,40,90,${0.28 + 0.1 * emphasis})`
    ctx.fill(path)
  }
  if (traits.has('thermophile')) {
    // Heat-hardened inner lining: a second, warm ring just inside the membrane.
    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(0.86, 0.86)
    ctx.translate(-cx, -cy)
    ctx.lineWidth = (Math.max(1, R * 0.05) * boost) / 0.86
    ctx.strokeStyle = `rgba(255,150,80,${0.55 + 0.3 * emphasis})`
    ctx.stroke(path)
    ctx.restore()
  }
  if (traits.has('acidResistance')) {
    // A waxy coat just outside the membrane.
    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(1.08, 1.08)
    ctx.translate(-cx, -cy)
    ctx.lineWidth = (Math.max(1, R * 0.06) * boost) / 1.08
    ctx.strokeStyle = `rgba(215,240,120,${0.4 + 0.3 * emphasis})`
    ctx.stroke(path)
    ctx.restore()
  }
  if (traits.has('mechanoreception')) {
    // Touch-sensitive hairs all round, twitching.
    ctx.beginPath()
    for (let i = 0; i < sx.length; i += 2) {
      const dx = sx[i] - cx
      const dy = sy[i] - cy
      const d = Math.hypot(dx, dy) || 1
      const twitch = 0.15 * Math.sin(time * 5 + i * 1.7)
      const nx = dx / d
      const ny = dy / d
      const ex = nx * Math.cos(twitch) - ny * Math.sin(twitch)
      const ey = nx * Math.sin(twitch) + ny * Math.cos(twitch)
      ctx.moveTo(sx[i], sy[i])
      ctx.lineTo(sx[i] + ex * R * 0.2 * boost, sy[i] + ey * R * 0.2 * boost)
    }
    ctx.lineCap = 'round'
    ctx.lineWidth = Math.max(0.8, R * 0.025)
    ctx.strokeStyle = 'rgba(210,225,255,0.6)'
    ctx.stroke()
  }
  if (traits.has('chemoreception')) {
    // A pair of long sensory whiskers out of the front, tasting the water.
    const px = -fy
    const py = fx
    ctx.beginPath()
    for (const side of [-1, 1]) {
      const bx = cx + fx * R * 0.9 + px * side * R * 0.25
      const by = cy + fy * R * 0.9 + py * side * R * 0.25
      const sway = Math.sin(time * 2.5 + side) * R * 0.15
      const ex = bx + fx * R * 0.75 * boost + px * (side * R * 0.35 + sway)
      const ey = by + fy * R * 0.75 * boost + py * (side * R * 0.35 + sway)
      ctx.moveTo(bx, by)
      ctx.quadraticCurveTo(bx + fx * R * 0.4, by + fy * R * 0.4, ex, ey)
    }
    ctx.lineCap = 'round'
    ctx.lineWidth = Math.max(1, R * 0.035)
    ctx.strokeStyle = 'rgba(220,200,255,0.75)'
    ctx.stroke()
  }
}
