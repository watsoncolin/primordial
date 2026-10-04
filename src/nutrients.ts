import { WORLD } from './config'
import type { Fluid } from './fluid'
import { TAU, gauss, rand, wrapCoord, wrapDelta } from './math'
import { scale } from './scale'
import { glowSprite } from './sprites'
import type { Vent } from './vents'
import type { View } from './view'

export type Kind = 'organic' | 'lipid' | 'mineral'

export interface Nutrient {
  kind: Kind
  x: number
  y: number
  vx: number
  vy: number
  r: number
  phase: number
  angle: number
  spin: number
  sides: number
  dead: boolean
  /** Seconds before this can be absorbed (lets a rupture's spray fly out first). */
  grace: number
  /** Biomass gained by whoever absorbs it. */
  value: number
  /** Culled by a rescale: fades out over about a second, can't be eaten, then is removed. */
  fading: boolean
  alpha: number
}

/**
 * Biomass per particle at scale 1. Lipids build membrane, so they're what really grows you.
 * Particles spawned at bigger scales stand for bigger clumps of matter and are worth proportionally more.
 */
export const NUTRITION: Record<Kind, number> = { organic: 0.004, lipid: 0.05, mineral: 0.01 }
/** Particles shrunk below this radius by a rescale are too small to matter and dissolve. */
const MIN_RADIUS = 0.6
const FADE_TIME = 1.2

/** How quickly each kind matches the local flow (1/s), and what fraction of it carries them. */
const COUPLING: Record<Kind, number> = { organic: 5, lipid: 2.5, mineral: 1.2 }
const CARRY: Record<Kind, number> = { organic: 1, lipid: 0.9, mineral: 0.45 }

const TARGET_ORGANICS = 300
const TARGET_LIPIDS = 70
export const MAX_MINERALS = 80

export class Nutrients {
  items: Nutrient[] = []
  readonly count: Record<Kind, number> = { organic: 0, lipid: 0, mineral: 0 }
  private spawnTimer = 0
  private readonly organicGlow = glowSprite(170, 255, 160)

  seed(px: number, py: number, vents: Vent[]) {
    // One cloud just ahead of the player so there's something to chase immediately.
    this.cloud(px + 220, py - 60)
    for (let i = 0; i < 4; i++) this.cloud(...this.farPoint(px, py, 500))
    for (let i = 0; i < 80; i++) this.spawn('organic', rand(0, WORLD), rand(0, WORLD))
    for (let i = 0; i < 7; i++) this.lipidCluster(...this.farPoint(px, py, 300))
    for (const vent of vents) {
      for (let i = 0; i < 10; i++) {
        const a = rand(0, TAU)
        const d = vent.r * rand(1.15, 2.2)
        this.spawn('mineral', vent.x + Math.cos(a) * d, vent.y + Math.sin(a) * d)
      }
    }
    this.recount()
  }

  spawn(kind: Kind, x: number, y: number, vx = 0, vy = 0, grace = 0) {
    const r = kind === 'organic' ? rand(1.2, 2.2) : kind === 'lipid' ? rand(2.5, 4.5) : rand(2.2, 3.8)
    this.items.push({
      kind,
      x: wrapCoord(x, WORLD),
      y: wrapCoord(y, WORLD),
      vx,
      vy,
      r,
      phase: rand(0, TAU),
      angle: rand(0, TAU),
      spin: rand(-1.5, 1.5),
      sides: Math.random() < 0.5 ? 5 : 6,
      dead: false,
      grace,
      value: NUTRITION[kind] * scale.biomass,
      fading: false,
      alpha: 1,
    })
  }

  /** A drifting cloud of organics with the occasional lipid mixed in. */
  cloud(x: number, y: number) {
    const sigma = rand(35, 70)
    const n = Math.round(rand(45, 85))
    for (let i = 0; i < n; i++) this.spawn('organic', x + gauss() * sigma, y + gauss() * sigma)
    const lipids = Math.floor(rand(0, 6))
    for (let i = 0; i < lipids; i++) this.spawn('lipid', x + gauss() * sigma * 0.6, y + gauss() * sigma * 0.6)
  }

  lipidCluster(x: number, y: number) {
    const n = Math.round(rand(3, 8))
    for (let i = 0; i < n; i++) this.spawn('lipid', x + gauss() * 15, y + gauss() * 15)
  }

  near(x: number, y: number, radius: number, kind: Kind) {
    let n = 0
    for (const it of this.items) {
      if (it.kind !== kind) continue
      const dx = wrapDelta(it.x - x, WORLD)
      const dy = wrapDelta(it.y - y, WORLD)
      if (dx * dx + dy * dy < radius * radius) n++
    }
    return n
  }

  step(dt: number, fluid: Fluid, vents: Vent[], px: number, py: number) {
    this.spawnTimer -= dt
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 1.5
      if (this.count.organic < TARGET_ORGANICS) this.cloud(...this.farPoint(px, py, 450))
      if (this.count.lipid < TARGET_LIPIDS) this.lipidCluster(...this.farPoint(px, py, 450))
    }

    for (const n of this.items) {
      n.grace = Math.max(0, n.grace - dt)
      if (n.fading) {
        n.alpha -= dt / FADE_TIME
        if (n.alpha <= 0) n.dead = true
      }
      fluid.sample(n.x, n.y)
      const k = Math.min(1, COUPLING[n.kind] * dt)
      const carry = CARRY[n.kind]
      n.vx += (fluid.su * carry - n.vx) * k
      n.vy += (fluid.sv * carry - n.vy) * k
      if (n.kind === 'organic') {
        // Light molecules jitter (Brownian motion).
        n.vx += (Math.random() - 0.5) * 60 * dt
        n.vy += (Math.random() - 0.5) * 60 * dt
      }
      n.x = wrapCoord(n.x + n.vx * dt, WORLD)
      n.y = wrapCoord(n.y + n.vy * dt, WORLD)
      n.angle += n.spin * dt
      for (const vent of vents) vent.pushOut(n, n.r)
    }

    this.clumpLipids(dt)
  }

  /**
   * Shrink everything toward (ox, oy) by k. A random share is culled so density near the player
   * stays the same; the emptied outer band refills with fresh particles at the new scale.
   */
  rescale(ox: number, oy: number, k: number) {
    for (const n of this.items) {
      n.x = wrapCoord(ox + wrapDelta(n.x - ox, WORLD) * k, WORLD)
      n.y = wrapCoord(oy + wrapDelta(n.y - oy, WORLD) * k, WORLD)
      n.vx *= k
      n.vy *= k
      n.r *= k
      if (n.r < MIN_RADIUS || Math.random() > k * k) n.fading = true
    }
    this.recount()
  }

  /** Drop absorbed items and refresh counts. */
  sweep() {
    this.items = this.items.filter(n => !n.dead)
    this.recount()
  }

  draw(ctx: CanvasRenderingContext2D, view: View, time: number) {
    const z = view.zoom

    for (const n of this.items) {
      if (n.kind !== 'mineral') continue
      const sx = view.sx(n.x)
      const sy = view.sy(n.y)
      const s = n.r * z
      if (!view.onScreen(sx, sy, s * 2)) continue
      ctx.globalAlpha = n.alpha
      ctx.beginPath()
      for (let i = 0; i < n.sides; i++) {
        const a = n.angle + (i / n.sides) * TAU
        const rr = s * (i % 2 ? 0.8 : 1)
        if (i === 0) ctx.moveTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr)
        else ctx.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr)
      }
      ctx.closePath()
      ctx.fillStyle = 'rgba(150,165,255,0.55)'
      ctx.fill()
      ctx.lineWidth = Math.max(0.75, s * 0.15)
      ctx.strokeStyle = 'rgba(220,228,255,0.85)'
      ctx.stroke()
    }
    ctx.globalAlpha = 1

    for (const n of this.items) {
      if (n.kind !== 'lipid') continue
      const sx = view.sx(n.x)
      const sy = view.sy(n.y)
      const s = n.r * z
      if (!view.onScreen(sx, sy, s * 2)) continue
      ctx.globalAlpha = n.alpha
      ctx.beginPath()
      ctx.arc(sx, sy, s, 0, TAU)
      ctx.fillStyle = 'rgba(255,196,92,0.2)'
      ctx.fill()
      ctx.lineWidth = Math.max(0.75, s * 0.16)
      ctx.strokeStyle = 'rgba(255,214,140,0.75)'
      ctx.stroke()
      // Oily shimmer.
      ctx.globalAlpha = (0.35 + 0.45 * (0.5 + 0.5 * Math.sin(time * 2.4 + n.phase))) * n.alpha
      ctx.beginPath()
      ctx.arc(sx - s * 0.35, sy - s * 0.35, s * 0.28, 0, TAU)
      ctx.fillStyle = '#fff6dc'
      ctx.fill()
      ctx.globalAlpha = 1
    }

    ctx.globalCompositeOperation = 'lighter'
    for (const n of this.items) {
      if (n.kind !== 'organic') continue
      const sx = view.sx(n.x)
      const sy = view.sy(n.y)
      const s = n.r * z * 6
      if (!view.onScreen(sx, sy, s)) continue
      ctx.globalAlpha = (0.55 + 0.35 * Math.sin(time * 3 + n.phase)) * n.alpha
      ctx.drawImage(this.organicGlow, sx - s / 2, sy - s / 2, s, s)
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  /** Oily droplets attract at short range and hold a contact distance, so they gather into clumps. */
  private clumpLipids(dt: number) {
    const lipids = this.items.filter(n => n.kind === 'lipid')
    const range = 50
    for (let a = 0; a < lipids.length; a++) {
      const la = lipids[a]
      for (let b = a + 1; b < lipids.length; b++) {
        const lb = lipids[b]
        const dx = wrapDelta(lb.x - la.x, WORLD)
        if (dx > range || dx < -range) continue
        const dy = wrapDelta(lb.y - la.y, WORLD)
        const d2 = dx * dx + dy * dy
        if (d2 > range * range) continue
        const d = Math.sqrt(d2) || 0.001
        const rest = (la.r + lb.r) * 0.9
        const f = (d < rest ? (d - rest) * 20 : (d - rest) * 0.8) * dt
        const fx = (dx / d) * f
        const fy = (dy / d) * f
        la.vx += fx
        la.vy += fy
        lb.vx -= fx
        lb.vy -= fy
      }
    }
  }

  private farPoint(px: number, py: number, minDist: number): [number, number] {
    let x = 0
    let y = 0
    for (let i = 0; i < 12; i++) {
      x = rand(0, WORLD)
      y = rand(0, WORLD)
      if (Math.hypot(wrapDelta(x - px, WORLD), wrapDelta(y - py, WORLD)) > minDist) break
    }
    return [x, y]
  }

  private recount() {
    this.count.organic = this.count.lipid = this.count.mineral = 0
    for (const n of this.items) if (!n.fading) this.count[n.kind]++
  }
}
