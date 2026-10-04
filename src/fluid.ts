import { GRID, WORLD, tuning } from './config'
import { TAU, rand } from './math'
import type { View } from './view'

const N = GRID
const M = N - 1
const SHIFT = Math.round(Math.log2(N))
const SIZE = N * N
/** Sim steps between recomputing the ambient current field (it changes slowly). */
const TARGET_REFRESH = 10
const SOR = 1.7

/** One travelling wave of the ambient current, precomputed as divergence-free basis fields. */
interface Mode {
  cosU: Float32Array
  cosV: Float32Array
  sinU: Float32Array
  sinV: Float32Array
  amp: number
  omega: number
  phase: number
  beat: number
  beatPhase: number
}

function bilerp(f: Float32Array, x: number, y: number) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const i0 = x0 & M
  const i1 = (x0 + 1) & M
  const j0 = (y0 & M) << SHIFT
  const j1 = ((y0 + 1) & M) << SHIFT
  const a = f[j0 | i0]
  const b = f[j0 | i1]
  const c = f[j1 | i0]
  const d = f[j1 | i1]
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}

/**
 * Stam-style stable fluids on a periodic grid. Velocities are in world units/s.
 * Ambient currents are a few slowly drifting waves the field relaxes toward, so anything
 * the player stirs up (wake, jet) lives for a while and then settles back into the current.
 */
export class Fluid {
  readonly h = WORLD / N
  readonly u = new Float32Array(SIZE)
  readonly v = new Float32Array(SIZE)
  /** Result of the last sample() call, so lookups don't allocate. */
  su = 0
  sv = 0

  private readonly u0 = new Float32Array(SIZE)
  private readonly v0 = new Float32Array(SIZE)
  private readonly p = new Float32Array(SIZE)
  private readonly div = new Float32Array(SIZE)
  private readonly fu = new Float32Array(SIZE)
  private readonly fv = new Float32Array(SIZE)
  private readonly tu = new Float32Array(SIZE)
  private readonly tv = new Float32Array(SIZE)
  private readonly modes: Mode[]
  private readonly norm: number
  private steps = 0

  constructor() {
    const waves = [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, -2],
      [2, 1],
      [3, -1],
    ]
    this.modes = waves.map(([mx, my]) => {
      // Stream function ψ = sin/cos(k·x) → velocity perpendicular to k, so divergence-free.
      const k = Math.hypot(mx, my)
      const du = my / k
      const dv = -mx / k
      const cosU = new Float32Array(SIZE)
      const cosV = new Float32Array(SIZE)
      const sinU = new Float32Array(SIZE)
      const sinV = new Float32Array(SIZE)
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const theta = (TAU * (mx * (i + 0.5) + my * (j + 0.5))) / N
          const c = Math.cos(theta)
          const s = Math.sin(theta)
          const idx = (j << SHIFT) | i
          cosU[idx] = du * c
          cosV[idx] = dv * c
          sinU[idx] = du * s
          sinV[idx] = dv * s
        }
      }
      return {
        cosU,
        cosV,
        sinU,
        sinV,
        amp: 1 / Math.sqrt(k),
        omega: rand(0.015, 0.05) * TAU * (Math.random() < 0.5 ? -1 : 1),
        phase: rand(0, TAU),
        beat: rand(0.01, 0.03) * TAU,
        beatPhase: rand(0, TAU),
      }
    })
    this.norm = 1 / Math.sqrt(this.modes.reduce((sum, m) => sum + m.amp * m.amp, 0))
    this.refreshTarget(0)
    this.u.set(this.tu)
    this.v.set(this.tv)
  }

  step(dt: number, time: number) {
    if (this.steps++ % TARGET_REFRESH === 0) this.refreshTarget(time)
    const { u, v, fu, fv, tu, tv } = this
    const relax = Math.min(1, tuning.currentRelax * dt)
    for (let k = 0; k < SIZE; k++) {
      u[k] += fu[k] * dt + (tu[k] - u[k]) * relax
      v[k] += fv[k] * dt + (tv[k] - v[k]) * relax
      fu[k] = 0
      fv[k] = 0
    }
    this.advect(dt)
    this.project(tuning.pressureIterations)
  }

  /** Scale all current velocities (the world was rescaled around the player). */
  scaleVelocity(k: number) {
    for (let i = 0; i < SIZE; i++) {
      this.u[i] *= k
      this.v[i] *= k
    }
  }

  /** Bilinear velocity at a world position; result in `su`/`sv`. */
  sample(wx: number, wy: number) {
    const gx = wx / this.h - 0.5
    const gy = wy / this.h - 0.5
    this.su = bilerp(this.u, gx, gy)
    this.sv = bilerp(this.v, gx, gy)
  }

  /** Accelerate fluid in a disc (soft falloff). */
  push(wx: number, wy: number, radius: number, ax: number, ay: number) {
    const { fu, fv } = this
    this.disc(wx, wy, radius, (k, _dx, _dy, w) => {
      fu[k] += ax * w
      fv[k] += ay * w
    })
  }

  /** Pull fluid in a disc toward a velocity — how a moving body drags water with it. */
  dragToward(wx: number, wy: number, radius: number, vx: number, vy: number, rate: number) {
    const { u, v, fu, fv } = this
    this.disc(wx, wy, radius, (k, _dx, _dy, w) => {
      fu[k] += (vx - u[k]) * rate * w
      fv[k] += (vy - v[k]) * rate * w
    })
  }

  /** Radial + rotational forcing, e.g. a vent's plume. */
  swirl(wx: number, wy: number, radius: number, outward: number, spin: number) {
    const { fu, fv } = this
    this.disc(wx, wy, radius, (k, dx, dy, w) => {
      const d = Math.hypot(dx, dy) || 1
      const nx = dx / d
      const ny = dy / d
      fu[k] += (nx * outward - ny * spin) * w
      fv[k] += (ny * outward + nx * spin) * w
    })
  }

  /** Debug: velocity arrows across the visible area. */
  drawFlow(ctx: CanvasRenderingContext2D, view: View) {
    const step = 32
    const halfW = view.w / 2 / view.zoom
    const halfH = view.h / 2 / view.zoom
    const x0 = Math.floor((view.x - halfW) / step) * step
    const y0 = Math.floor((view.y - halfH) / step) * step
    ctx.beginPath()
    for (let wy = y0; wy < view.y + halfH + step; wy += step) {
      for (let wx = x0; wx < view.x + halfW + step; wx += step) {
        this.sample(wx, wy)
        const sx = view.w / 2 + (wx - view.x) * view.zoom
        const sy = view.h / 2 + (wy - view.y) * view.zoom
        ctx.moveTo(sx, sy)
        ctx.lineTo(sx + this.su * view.zoom * 0.5, sy + this.sv * view.zoom * 0.5)
        ctx.rect(sx - 1, sy - 1, 2, 2)
      }
    }
    ctx.strokeStyle = 'rgba(255,120,120,0.55)'
    ctx.lineWidth = 1
    ctx.stroke()
  }

  private disc(wx: number, wy: number, radius: number, fn: (k: number, dx: number, dy: number, w: number) => void) {
    const gx = wx / this.h - 0.5
    const gy = wy / this.h - 0.5
    const gr = Math.max(radius / this.h, 1.5)
    const gr2 = gr * gr
    for (let j = Math.ceil(gy - gr); j <= Math.floor(gy + gr); j++) {
      for (let i = Math.ceil(gx - gr); i <= Math.floor(gx + gr); i++) {
        const dx = i - gx
        const dy = j - gy
        const d2 = dx * dx + dy * dy
        if (d2 >= gr2) continue
        fn(((j & M) << SHIFT) | (i & M), dx, dy, 1 - d2 / gr2)
      }
    }
  }

  private refreshTarget(time: number) {
    const { tu, tv } = this
    const s = tuning.currentStrength * this.norm
    // Slow global drift so the whole world has a sense of direction that wanders over minutes.
    const driftX = s * 0.5 * Math.cos(time * 0.013 * TAU)
    const driftY = s * 0.5 * Math.sin(time * 0.009 * TAU + 1)
    tu.fill(driftX)
    tv.fill(driftY)
    for (const m of this.modes) {
      const a = s * m.amp * (0.6 + 0.4 * Math.sin(m.beat * time + m.beatPhase))
      const cc = a * Math.cos(m.omega * time + m.phase)
      const cs = a * Math.sin(m.omega * time + m.phase)
      const { cosU, cosV, sinU, sinV } = m
      for (let k = 0; k < SIZE; k++) {
        tu[k] += cc * cosU[k] + cs * sinU[k]
        tv[k] += cc * cosV[k] + cs * sinV[k]
      }
    }
  }

  private advect(dt: number) {
    const { u, v, u0, v0 } = this
    u0.set(u)
    v0.set(v)
    const s = dt / this.h
    for (let j = 0; j < N; j++) {
      const row = j << SHIFT
      for (let i = 0; i < N; i++) {
        const k = row | i
        const x = i - s * u0[k]
        const y = j - s * v0[k]
        u[k] = bilerp(u0, x, y)
        v[k] = bilerp(v0, x, y)
      }
    }
  }

  /** Make the field divergence-free (Gauss–Seidel pressure solve, warm-started from last step). */
  private project(iterations: number) {
    const { u, v, p, div } = this
    for (let j = 0; j < N; j++) {
      const row = j << SHIFT
      const up = ((j - 1) & M) << SHIFT
      const dn = ((j + 1) & M) << SHIFT
      for (let i = 0; i < N; i++) {
        div[row | i] = -0.5 * (u[row | ((i + 1) & M)] - u[row | ((i - 1) & M)] + v[dn | i] - v[up | i])
      }
    }
    // Successive over-relaxation: Gauss–Seidel nudged past each update, converges in far fewer sweeps.
    // The wrapping columns are handled outside the inner loop so it's plain neighbour indexing.
    const w = SOR
    for (let it = 0; it < iterations; it++) {
      for (let j = 0; j < N; j++) {
        const row = j << SHIFT
        const up = ((j - 1) & M) << SHIFT
        const dn = ((j + 1) & M) << SHIFT
        p[row] += w * ((div[row] + p[row + M] + p[row + 1] + p[up] + p[dn]) * 0.25 - p[row])
        for (let i = 1; i < M; i++) {
          const k = row + i
          p[k] += w * ((div[k] + p[k - 1] + p[k + 1] + p[up + i] + p[dn + i]) * 0.25 - p[k])
        }
        const e = row + M
        p[e] += w * ((div[e] + p[e - 1] + p[row] + p[up + M] + p[dn + M]) * 0.25 - p[e])
      }
    }
    for (let j = 0; j < N; j++) {
      const row = j << SHIFT
      const up = ((j - 1) & M) << SHIFT
      const dn = ((j + 1) & M) << SHIFT
      for (let i = 0; i < N; i++) {
        const k = row | i
        u[k] -= 0.5 * (p[row | ((i + 1) & M)] - p[row | ((i - 1) & M)])
        v[k] -= 0.5 * (p[dn | i] - p[up | i])
      }
    }
  }
}
