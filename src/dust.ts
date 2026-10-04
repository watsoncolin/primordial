import { WORLD } from './config'
import type { Fluid } from './fluid'
import { rand, wrapCoord } from './math'
import type { View } from './view'

const COUNT = 2000

/** Inert specks that ride the flow. Purely visual, but they're what makes the water readable. */
export class Dust {
  private readonly x = new Float32Array(COUNT)
  private readonly y = new Float32Array(COUNT)
  private readonly vx = new Float32Array(COUNT)
  private readonly vy = new Float32Array(COUNT)

  constructor() {
    for (let i = 0; i < COUNT; i++) {
      this.x[i] = rand(0, WORLD)
      this.y[i] = rand(0, WORLD)
    }
  }

  step(dt: number, fluid: Fluid) {
    const k = Math.min(1, 4 * dt)
    for (let i = 0; i < COUNT; i++) {
      fluid.sample(this.x[i], this.y[i])
      this.vx[i] += (fluid.su - this.vx[i]) * k + (Math.random() - 0.5) * 20 * dt
      this.vy[i] += (fluid.sv - this.vy[i]) * k + (Math.random() - 0.5) * 20 * dt
      this.x[i] = wrapCoord(this.x[i] + this.vx[i] * dt, WORLD)
      this.y[i] = wrapCoord(this.y[i] + this.vy[i] * dt, WORLD)
    }
  }

  draw(ctx: CanvasRenderingContext2D, view: View) {
    const z = view.zoom
    const tail = 0.15 * z
    ctx.beginPath()
    for (let i = 0; i < COUNT; i++) {
      const sx = view.sx(this.x[i])
      const sy = view.sy(this.y[i])
      if (!view.onScreen(sx, sy, 10)) continue
      ctx.moveTo(sx, sy)
      ctx.lineTo(sx - this.vx[i] * tail + 0.01, sy - this.vy[i] * tail)
    }
    ctx.strokeStyle = 'rgba(150,210,220,0.35)'
    ctx.lineWidth = Math.max(1, z * 0.7)
    ctx.lineCap = 'round'
    ctx.stroke()
  }
}
