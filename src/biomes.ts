import { WORLD } from './config'
import { TAU, clamp, rand, wrapCoord, wrapDelta } from './math'
import type { Protocell } from './protocell'
import type { TraitId } from './traits'
import type { Vent } from './vents'
import type { View } from './view'

export type ZoneType = 'thermal' | 'acid' | 'uv' | 'dark'

interface ZoneInfo {
  /** Shown over the zone until you're adapted to it. */
  label: string
  /** What it does to you, for the warning line. */
  warning: string
  /** The adaptation that makes it safe. */
  resist: TraitId
  rgb: string
}

export const ZONES: Record<ZoneType, ZoneInfo> = {
  thermal: { label: '82°C', warning: 'Scalding', resist: 'thermophile', rgb: '255,140,70' },
  acid: { label: 'pH 2', warning: 'Dissolving', resist: 'acidResistance', rgb: '205,235,80' },
  uv: { label: 'UV', warning: 'Burning in the light', resist: 'pigment', rgb: '255,245,190' },
  dark: { label: 'darkness', warning: '', resist: 'mechanoreception', rgb: '0,0,0' },
}

// Hazard tuning: fraction of biomass lost per second at full strength, and the other effects.
export const HEAT_BURN = 0.05
export const ACID_BURN = 0.035
export const ACID_DRAG = 1.6
export const UV_BURN = 0.02
/** Mutagen per second in full sunlight, burnt or not: radiation scrambles genes. */
export const UV_MUTAGEN = 8
/** Photosynthesis multiplier in full sunlight. */
export const UV_LIGHT = 1.75
/** Zones shrunk below this by a rescale are replaced at the new scale. */
const MIN_ZONE_RADIUS = 60

export class Zone {
  readonly type: ZoneType
  x: number
  y: number
  r: number
  readonly seed = rand(0, 1000)

  constructor(type: ZoneType, x: number, y: number, r: number) {
    this.type = type
    this.x = x
    this.y = y
    this.r = r
  }

  /** 1 in the core, fading to 0 at the edge. */
  strengthAt(px: number, py: number) {
    const dx = wrapDelta(px - this.x, WORLD)
    if (dx > this.r || dx < -this.r) return 0
    const dy = wrapDelta(py - this.y, WORLD)
    const d = Math.hypot(dx, dy)
    if (d >= this.r) return 0
    const core = this.r * 0.7
    return d <= core ? 1 : 1 - (d - core) / (this.r - core)
  }

  rescale(ox: number, oy: number, k: number) {
    this.x = wrapCoord(ox + wrapDelta(this.x - ox, WORLD) * k, WORLD)
    this.y = wrapCoord(oy + wrapDelta(this.y - oy, WORLD) * k, WORLD)
    this.r *= k
  }
}

/** One of each zone, away from the player's start; the thermal field sits on a vent. */
export function placeZones(vents: Vent[], px: number, py: number): Zone[] {
  const zones: Zone[] = []
  const farthestVent = [...vents].sort(
    (a, b) =>
      Math.hypot(wrapDelta(b.x - px, WORLD), wrapDelta(b.y - py, WORLD)) -
      Math.hypot(wrapDelta(a.x - px, WORLD), wrapDelta(a.y - py, WORLD)),
  )[0]
  zones.push(new Zone('thermal', farthestVent.x, farthestVent.y, rand(150, 180)))
  for (const type of ['acid', 'uv', 'dark'] as const) zones.push(newZone(type, px, py, zones, 350))
  return zones
}

function newZone(type: ZoneType, px: number, py: number, others: Zone[], minDist: number) {
  const r = rand(140, 190)
  let x = 0
  let y = 0
  for (let tries = 0; tries < 40; tries++) {
    x = rand(0, WORLD)
    y = rand(0, WORLD)
    const far = Math.hypot(wrapDelta(x - px, WORLD), wrapDelta(y - py, WORLD)) > minDist + r
    const clear = others.every(z => Math.hypot(wrapDelta(x - z.x, WORLD), wrapDelta(y - z.y, WORLD)) > z.r + r + 40)
    if (far && clear) break
  }
  return new Zone(type, x, y, r)
}

/** Shrink zones with the world; any that become too small are replaced out in the far band. */
export function rescaleZones(zones: Zone[], ox: number, oy: number, k: number) {
  for (let i = 0; i < zones.length; i++) {
    zones[i].rescale(ox, oy, k)
    if (zones[i].r < MIN_ZONE_RADIUS) {
      const others = zones.filter((_, j) => j !== i)
      zones[i] = newZone(zones[i].type, ox, oy, others, WORLD * 0.3)
    }
  }
}

export interface Exposure {
  /** Biomass fraction lost per second. */
  burn: number
  /** The worst hazard currently hurting the cell, for the warning line. */
  worst: ZoneType | null
  /** 0..1 how deep in darkness. */
  dark: number
  /** 0..1 how much sunlight. */
  light: number
}

/**
 * Apply every zone's effect to one cell for this step: burns (unless adapted), acid drag,
 * sunlight for photosynthesis. Returns what the cell is exposed to.
 */
export function applyHazards(cell: Protocell, zones: Zone[], dt: number): Exposure {
  const out: Exposure = { burn: 0, worst: null, dark: 0, light: 0 }
  let drag = 1
  let worstBurn = 0
  for (const z of zones) {
    const s = z.strengthAt(cell.cx, cell.cy)
    if (s <= 0) continue
    const safe = cell.traits.has(ZONES[z.type].resist)
    let burn = 0
    if (z.type === 'thermal' && !safe) burn = HEAT_BURN * s
    if (z.type === 'acid' && !safe) {
      burn = ACID_BURN * s
      drag = Math.max(drag, 1 + (ACID_DRAG - 1) * s)
    }
    if (z.type === 'uv') {
      out.light = Math.max(out.light, s)
      if (!safe) burn = UV_BURN * s
    }
    if (z.type === 'dark') out.dark = Math.max(out.dark, s)
    if (burn > worstBurn) {
      worstBurn = burn
      out.worst = z.type
    }
    out.burn += burn
  }
  if (out.burn > 0) cell.grow(-cell.biomass * out.burn * dt)
  cell.envDrag = drag
  cell.envLight = 1 + (UV_LIGHT - 1) * out.light
  cell.hazard = clamp(out.burn * 20, 0, 1)
  cell.hazardRgb = out.worst ? ZONES[out.worst].rgb : cell.hazardRgb
  return out
}

/** Would this cell be hurt where it is, or a little way ahead? Returns a unit vector away, or null. */
export function hostileAhead(cell: Protocell, zones: Zone[], dirX: number, dirY: number): [number, number] | null {
  const ax = cell.cx + dirX * cell.R * 3 + cell.cvx * 0.6
  const ay = cell.cy + dirY * cell.R * 3 + cell.cvy * 0.6
  for (const z of zones) {
    if (z.type === 'dark' || cell.traits.has(ZONES[z.type].resist)) continue
    if (z.strengthAt(ax, ay) <= 0 && z.strengthAt(cell.cx, cell.cy) <= 0) continue
    const dx = wrapDelta(cell.cx - z.x, WORLD)
    const dy = wrapDelta(cell.cy - z.y, WORLD)
    const d = Math.hypot(dx, dy) || 1
    return [dx / d, dy / d]
  }
  return null
}

// ── Drawing ──────────────────────────────────────────────────────────────────

/** Thermal, acid and sunlit zones, drawn under everything that lives in them. */
export function drawZones(ctx: CanvasRenderingContext2D, view: View, zones: Zone[], time: number) {
  for (const z of zones) {
    if (z.type === 'dark') continue
    const sx = view.sx(z.x)
    const sy = view.sy(z.y)
    const R = z.r * view.zoom
    if (!view.onScreen(sx, sy, R)) continue
    const rgb = ZONES[z.type].rgb
    const grad = ctx.createRadialGradient(sx, sy, R * 0.2, sx, sy, R)
    const core = z.type === 'uv' ? 0.1 : 0.16
    grad.addColorStop(0, `rgba(${rgb},${core})`)
    grad.addColorStop(0.7, `rgba(${rgb},${core * 0.7})`)
    grad.addColorStop(1, `rgba(${rgb},0)`)
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(sx, sy, R, 0, TAU)
    ctx.fill()

    if (z.type === 'thermal') drawHeat(ctx, z, sx, sy, R, time)
    else if (z.type === 'acid') drawBubbles(ctx, z, sx, sy, R, time)
    else drawShafts(ctx, z, sx, sy, R, time)
  }
}

/** A stable pseudo-random point inside the zone for particle i. */
function spot(z: Zone, i: number): [number, number] {
  const a = z.seed + i * 2.399
  const d = Math.sqrt(((i * 0.6180339) % 1) * 0.9 + 0.05)
  return [Math.cos(a) * d, Math.sin(a) * d]
}

function drawHeat(ctx: CanvasRenderingContext2D, z: Zone, sx: number, sy: number, R: number, time: number) {
  ctx.fillStyle = 'rgba(255,170,100,0.55)'
  for (let i = 0; i < 26; i++) {
    const [ox, oy] = spot(z, i)
    const phase = (time * 0.35 + i * 0.37) % 1
    const x = sx + ox * R * 0.85 + Math.sin(time * 2 + i) * R * 0.02
    const y = sy + oy * R * 0.85 - phase * R * 0.3
    ctx.globalAlpha = (1 - phase) * 0.7
    ctx.beginPath()
    ctx.arc(x, y, Math.max(0.8, R * 0.008), 0, TAU)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

function drawBubbles(ctx: CanvasRenderingContext2D, z: Zone, sx: number, sy: number, R: number, time: number) {
  ctx.lineWidth = 1
  for (let i = 0; i < 18; i++) {
    const [ox, oy] = spot(z, i)
    const phase = (time * 0.4 + i * 0.29) % 1
    ctx.strokeStyle = `rgba(215,240,110,${(1 - phase) * 0.5})`
    ctx.beginPath()
    ctx.arc(sx + ox * R * 0.85, sy + oy * R * 0.85, Math.max(1, R * (0.008 + phase * 0.025)), 0, TAU)
    ctx.stroke()
  }
}

function drawShafts(ctx: CanvasRenderingContext2D, z: Zone, sx: number, sy: number, R: number, time: number) {
  ctx.save()
  ctx.beginPath()
  ctx.arc(sx, sy, R, 0, TAU)
  ctx.clip()
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 6; i++) {
    const offset = (i / 6 - 0.5) * R * 2.2 + Math.sin(time * 0.3 + i * 1.7 + z.seed) * R * 0.08
    const w = R * (0.08 + 0.06 * Math.sin(i * 2.1 + z.seed))
    ctx.globalAlpha = 0.07 + 0.05 * Math.sin(time * 0.8 + i * 1.3)
    ctx.fillStyle = 'rgb(255,248,210)'
    ctx.beginPath()
    // Slanted bands, as if light is coming down from above at an angle.
    ctx.moveTo(sx + offset - R, sy - R)
    ctx.lineTo(sx + offset - R + w, sy - R)
    ctx.lineTo(sx + offset + R * 0.4 + w, sy + R)
    ctx.lineTo(sx + offset + R * 0.4, sy + R)
    ctx.fill()
  }
  ctx.restore()
}

let mask: HTMLCanvasElement | null = null

/**
 * Darkness, drawn over everything. From outside, a dark zone is a black fog hiding what's in it.
 * Inside, you see only a small circle around yourself, wider with Mechanoreception, which also
 * shows nearby moving cells as ripples.
 */
export function drawDarkness(
  ctx: CanvasRenderingContext2D,
  view: View,
  zones: Zone[],
  me: { x: number; y: number; r: number; dark: number; mechano: boolean },
  cells: Protocell[],
  time: number,
) {
  const dark = zones.filter(z => z.type === 'dark')
  const visible = dark.filter(z => view.onScreen(view.sx(z.x), view.sy(z.y), z.r * view.zoom))
  if (!visible.length && me.dark <= 0) return
  const dpr = ctx.getTransform().a
  mask ??= document.createElement('canvas')
  if (mask.width !== Math.round(view.w * dpr) || mask.height !== Math.round(view.h * dpr)) {
    mask.width = Math.round(view.w * dpr)
    mask.height = Math.round(view.h * dpr)
  }
  const m = mask.getContext('2d')!
  m.setTransform(dpr, 0, 0, dpr, 0, 0)
  m.clearRect(0, 0, view.w, view.h)
  for (const z of visible) {
    const sx = view.sx(z.x)
    const sy = view.sy(z.y)
    const R = z.r * view.zoom
    const g = m.createRadialGradient(sx, sy, R * 0.55, sx, sy, R)
    g.addColorStop(0, 'rgba(1,4,6,0.94)')
    g.addColorStop(1, 'rgba(1,4,6,0)')
    m.fillStyle = g
    m.beginPath()
    m.arc(sx, sy, R, 0, TAU)
    m.fill()
  }
  const px = view.sx(me.x)
  const py = view.sy(me.y)
  if (me.dark > 0) {
    // Inside: the whole screen dims, with a window of sight around you.
    m.fillStyle = `rgba(1,4,6,${0.9 * me.dark})`
    m.fillRect(0, 0, view.w, view.h)
    const sight = me.r * view.zoom * (me.mechano ? 7 : 3.2)
    m.globalCompositeOperation = 'destination-out'
    const g = m.createRadialGradient(px, py, sight * 0.35, px, py, sight)
    g.addColorStop(0, 'rgba(0,0,0,1)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    m.fillStyle = g
    m.fillRect(px - sight, py - sight, sight * 2, sight * 2)
    m.globalCompositeOperation = 'source-over'
  }
  ctx.drawImage(mask, 0, 0, view.w, view.h)

  if (me.mechano && me.dark > 0) {
    // Mechanoreception: movement registers as ripples, even in pitch black.
    const range = me.r * 14
    ctx.lineWidth = 1.2
    for (const c of cells) {
      const dx = wrapDelta(c.cx - me.x, WORLD)
      const dy = wrapDelta(c.cy - me.y, WORLD)
      const d = Math.hypot(dx, dy)
      if (d > range || d < me.r) continue
      const speed = Math.hypot(c.cvx, c.cvy)
      const a = clamp(speed / 60, 0.2, 1) * (1 - d / range) * 0.8
      const ring = (time * 1.5 + c.R) % 1
      ctx.strokeStyle = `rgba(200,220,255,${a * (1 - ring)})`
      ctx.beginPath()
      ctx.arc(px + dx * view.zoom, py + dy * view.zoom, c.R * view.zoom * (1 + ring * 0.6), 0, TAU)
      ctx.stroke()
    }
  }
}

/** Labels over zones you haven't adapted to yet. */
export function drawZoneLabels(
  ctx: CanvasRenderingContext2D,
  view: View,
  zones: Zone[],
  traits: Set<TraitId>,
  /** Where the player is: no label over a zone you're already inside (you know where you are). */
  meX: number,
  meY: number,
) {
  ctx.font = '600 12px ui-rounded, system-ui, sans-serif'
  ctx.textAlign = 'center'
  for (const z of zones) {
    if (traits.has(ZONES[z.type].resist) || z.strengthAt(meX, meY) > 0) continue
    const sx = view.sx(z.x)
    const sy = view.sy(z.y)
    if (!view.onScreen(sx, sy, 20)) continue
    const rgb = z.type === 'dark' ? '150,170,190' : ZONES[z.type].rgb
    ctx.fillStyle = `rgba(${rgb},0.6)`
    ctx.fillText(ZONES[z.type].label, sx, sy)
  }
  ctx.textAlign = 'start'
}
