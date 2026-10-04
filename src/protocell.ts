import type { Brain } from './ai'
import { EAT_RATIO, MASS_EXPONENT, WORLD, tuning } from './config'
import { Flagellum } from './flagellum'
import type { Fluid } from './fluid'
import { TAU, clamp, rand, wrapDelta } from './math'
import type { Kind } from './nutrients'
import {
  GIANT_FLAGELLUM_BIAS,
  GIANT_FLAGELLUM_LENGTH,
  GIANT_FLAGELLUM_POWER,
  GIGANTISM_GROWTH,
  GIGANTISM_THRUST,
  HYPER_BURN,
  HYPER_THRUST,
  MINI_LOSS,
  MINI_THRUST,
  MITOSIS_INTERVAL,
  MITOSIS_WARNING,
  type MutationId,
  STICKY_DRAG,
} from './mutations'
import { radiusFor, scale } from './scale'
import { glowSprite } from './sprites'
import {
  BURST_COOLDOWN,
  BURST_SPEED,
  DIGEST_THRUST,
  DIGEST_TIME,
  ENGULF_RATIO,
  MEMBRANE_DRAG,
  MEMBRANE_RESEAL,
  MEMBRANE_STIFFNESS,
  MEMBRANE_THRUST,
  MEMBRANE_YIELD,
  PHOTO_CONSPICUOUS,
  PHOTO_RATE,
  PHOTO_STILL_BONUS,
  PSEUDOPOD_REACH,
  type TraitId,
} from './traits'
import type { Vent } from './vents'
import type { View } from './view'

interface Body {
  x: number
  y: number
  vx: number
  vy: number
}

/** A particle floating in the cytoplasm. `r` is a fraction of the cell radius. */
interface Blob extends Body {
  r: number
  rgb: string
  life: number
  maxLife: number
  seed: number
}

const POINTS = 28
const CHLOROPLAST_RGB = '120,230,110'
/** The membrane point at the back of the rest shape (rest angle π), where a tail attaches. */
const REAR = POINTS / 2
/** Seconds an engulfed cell takes to be drawn in and dissolved. */
const ENGULF_TIME = 0.5

export type Species = 'player' | 'grazer' | 'engulfer' | 'offspring'

/** Colours as "r,g,b" strings so alpha can be set per use. */
interface Palette {
  rim: string
  glow: string
  highlight: string
  body: string
  aura: [number, number, number] | null
  inner: string[]
}

const PALETTES: Record<Species, Palette> = {
  player: {
    rim: '175,255,235',
    glow: '120,240,220',
    highlight: '200,255,245',
    body: '95,210,200',
    aura: [110, 230, 210],
    inner: ['255,214,170', '255,170,190', '200,240,255'],
  },
  grazer: {
    rim: '150,205,255',
    glow: '110,170,240',
    highlight: '200,225,255',
    body: '80,140,210',
    aura: null,
    inner: ['210,230,255', '180,255,220'],
  },
  // A daughter budded off by Unstable Mitosis: the player's colours, a little faded.
  offspring: {
    rim: '150,225,210',
    glow: '110,200,190',
    highlight: '190,240,230',
    body: '80,170,165',
    aura: null,
    inner: ['255,214,170', '200,240,255'],
  },
  engulfer: {
    rim: '255,160,195',
    glow: '240,110,160',
    highlight: '255,215,230',
    body: '200,80,135',
    aura: [240, 90, 140],
    inner: ['255,190,150', '255,120,160', '230,150,255', '255,220,190', '255,140,120'],
  },
}

/** Thrust multiplier per species; engulfers are big and lazy. */
const THRUST_SCALE: Record<Species, number> = { player: 1, grazer: 0.85, engulfer: 0.8, offspring: 0.85 }
export const NUTRIENT_RGB: Record<Kind, string> = {
  organic: '170,255,160',
  lipid: '255,200,110',
  mineral: '170,180,255',
}

/**
 * A protocell (the player or any other): a ring of membrane points held in shape by shape-matching springs.
 * Drag is applied per point and is heavier on the side facing the flow, and thrust pushes
 * mostly from the rear, so the body flattens, stretches and wobbles as it swims.
 */
export class Protocell {
  readonly pts: Body[] = []
  readonly inner: Blob[] = []
  readonly digesting: Blob[] = []
  readonly species: Species
  readonly palette: Palette
  /** Size in units of the player's starting biomass. Radius ∝ sqrt(biomass). */
  biomass: number
  R: number
  targetR: number
  /** Set when a bigger cell has started engulfing this one. */
  engulfedBy: Protocell | null = null
  engulfT = 0
  /** Fully absorbed (or ruptured); remove from the world. */
  gone = false
  /** One of the player's cells during the Great Transition. */
  colony = false
  brain: Brain | null = null
  /** Temporary thrust multiplier (an engulfer's lunge). */
  boost = 1
  readonly traits = new Set<TraitId>()
  flagellum: Flagellum | null = null
  /** Thick membrane: 1 = intact and able to repel an engulf; regrows from 0 after it cracks. */
  armor = 0
  /** Seconds during which engulf attempts just bounce off (right after the membrane cracks). */
  shielded = 0
  /** Engulfing: where the pseudopod should reach (unit vector) and whether there's something to reach for. */
  reachDirX = 0
  reachDirY = 0
  reachWant = 0
  /** 0..1 how far the pseudopod is currently extended. */
  reach = 0
  /** Seconds of sluggish digestion left after swallowing a cell. */
  digest = 0
  /** Body facing (rest angle 0), updated each step; a flagellum pushes this way. */
  facingX = 1
  facingY = 0
  /** Burst jet recovery time left. */
  dashCooldown = 0
  /** Seconds before spikes can tear this cell again. */
  spikeImmune = 0
  readonly mutations = new Set<MutationId>()
  /** Unstable Mitosis: seconds until the next bud pops, and the bulge where it's forming. */
  budTimer = Infinity
  bud = 0
  private budDirX = 1
  private budDirY = 0
  /** Venom: seconds of poisoning left (slowed, wasting away). */
  poison = 0
  /** Set each step by the zone the cell is in (see biomes.ts): water drag and sunlight multipliers. */
  envDrag = 1
  envLight = 1
  /** 0..1 how badly a hazard is hurting the cell right now, and its colour, for the sizzle. */
  hazard = 0
  hazardRgb = '255,140,70'
  /** Seconds alive, for idle animation. */
  private age = 0
  /** Direction of the last applied thrust, and where it pushes on the water. */
  steerX = 0
  steerY = 0
  jetX = 0
  jetY = 0
  cx = 0
  cy = 0
  cvx = 0
  cvy = 0
  /** Thrust applied on the last step, used to drive the fluid jet. */
  thrust = 0

  private readonly restX = new Float32Array(POINTS)
  private readonly restY = new Float32Array(POINTS)
  private readonly nx = new Float32Array(POINTS)
  private readonly ny = new Float32Array(POINTS)
  private readonly weight = new Float32Array(POINTS)
  private readonly sx = new Float32Array(POINTS)
  private readonly sy = new Float32Array(POINTS)
  private readonly aura: HTMLCanvasElement | null
  private static photoGlow: HTMLCanvasElement | undefined
  private flash = 0
  private engulfStartR = 0

  constructor(x: number, y: number, biomass: number, species: Species) {
    this.species = species
    this.palette = PALETTES[species]
    this.aura = this.palette.aura ? glowSprite(...this.palette.aura) : null
    this.biomass = biomass
    const r = (this.R = this.targetR = radiusFor(biomass))
    for (let i = 0; i < POINTS; i++) {
      const a = (i / POINTS) * TAU
      this.restX[i] = Math.cos(a)
      this.restY[i] = Math.sin(a)
      this.pts.push({ x: x + this.restX[i] * r, y: y + this.restY[i] * r, vx: 0, vy: 0 })
    }
    const innerCount = species === 'engulfer' ? 5 : species === 'grazer' ? 2 : 3
    for (let i = 0; i < innerCount; i++) {
      const rgb = this.palette.inner[i % this.palette.inner.length]
      this.inner.push({
        x: x + rand(-0.3, 0.3) * r,
        y: y + rand(-0.3, 0.3) * r,
        vx: 0,
        vy: 0,
        r: species === 'engulfer' ? rand(0.1, 0.15) : rand(0.14, 0.19),
        rgb,
        life: Infinity,
        maxLife: Infinity,
        seed: rand(0, 100),
      })
    }
    this.updateCentroid()
  }

  get screenAlpha() {
    return this.engulfedBy ? Math.max(0, 1 - this.engulfT / ENGULF_TIME) : 1
  }

  grow(amount: number) {
    // Burning, leaking and poison can only waste a cell away so far.
    this.biomass = Math.max(this.biomass + amount, scale.biomass * 0.02)
    this.targetR = radiusFor(this.biomass)
  }

  addTrait(id: TraitId) {
    this.traits.add(id)
    if (id === 'sealed') this.mutations.delete('porous')
    if (id === 'flagellum') this.flagellum = new Flagellum()
    if (id === 'membrane') this.armor = 1
    if (id === 'photosynthesis') {
      for (let i = 0; i < 4; i++) {
        this.inner.push({
          x: this.cx + rand(-0.3, 0.3) * this.R,
          y: this.cy + rand(-0.3, 0.3) * this.R,
          vx: this.cvx,
          vy: this.cvy,
          r: rand(0.07, 0.1),
          rgb: CHLOROPLAST_RGB,
          life: Infinity,
          maxLife: Infinity,
          seed: rand(0, 100),
        })
      }
    }
    this.flash = 1
  }

  /** Burst jet: one hard snap of the tail along the body's facing. Returns false while recovering. */
  dash() {
    if (!this.traits.has('burst') || this.dashCooldown > 0 || this.engulfedBy) return false
    for (const p of this.pts) {
      p.vx += this.facingX * BURST_SPEED
      p.vy += this.facingY * BURST_SPEED
    }
    if (this.flagellum) this.flagellum.beat = 1.8
    this.dashCooldown = BURST_COOLDOWN
    return true
  }

  addMutation(id: MutationId) {
    this.mutations.add(id)
    if (id === 'giantFlagellum' && this.flagellum) this.flagellum.size = GIANT_FLAGELLUM_LENGTH
    if (id === 'gigantism') this.grow(this.biomass * GIGANTISM_GROWTH)
    if (id === 'miniaturization') this.grow(-this.biomass * MINI_LOSS)
    if (id === 'mitosis') this.resetBud()
    this.flash = 1
  }

  /** Unstable Mitosis: start growing the next bud on a random side. */
  resetBud() {
    this.budTimer = rand(...MITOSIS_INTERVAL)
    this.bud = 0
    const a = rand(0, TAU)
    this.budDirX = Math.cos(a)
    this.budDirY = Math.sin(a)
  }

  /** Where the current bud sits (unit vector from the centre). */
  get budDir(): [number, number] {
    return [this.budDirX, this.budDirY]
  }

  /** How close prey's centre must come to be swallowed; pseudopods extend it toward the target. */
  get grabRadius() {
    return this.R * (1 + PSEUDOPOD_REACH * this.reach)
  }

  /** Multiplier on how far away predators notice this cell. */
  /** Colony cells sit close together, so their glows are dimmed to keep the stack from blowing out. */
  private get glowScale() {
    return this.colony ? 0.3 : 1
  }

  get conspicuous() {
    return this.traits.has('photosynthesis') ? PHOTO_CONSPICUOUS : 1
  }

  /** Can this cell swallow `other` whole? */
  canEat(other: Protocell) {
    return other.biomass <= this.biomass * (this.traits.has('engulfing') ? ENGULF_RATIO : EAT_RATIO)
  }

  startEngulf(by: Protocell) {
    this.engulfedBy = by
    this.engulfT = 0
    this.engulfStartR = this.R
  }

  /** `ix, iy` is a unit steering direction, `mag` its 0..1 strength. */
  step(dt: number, fluid: Fluid, ix: number, iy: number, mag: number, time: number, vents: Vent[]) {
    this.flash = Math.max(0, this.flash - dt * 2.5)
    this.age += dt
    this.updateCentroid()
    const eater = this.engulfedBy
    if (eater) {
      // Being swallowed: no more swimming, shrink, and get hauled toward the eater's centre.
      this.engulfT += dt
      ix = iy = mag = 0
      this.R = this.engulfStartR * Math.max(0.15, 1 - this.engulfT / ENGULF_TIME)
      const pullX = wrapDelta(eater.cx - this.cx, WORLD) * 14 - (this.cvx - eater.cvx) * 6
      const pullY = wrapDelta(eater.cy - this.cy, WORLD) * 14 - (this.cvy - eater.cvy) * 6
      for (const p of this.pts) {
        p.vx += pullX * dt
        p.vy += pullY * dt
      }
      if (this.engulfT >= ENGULF_TIME) this.gone = true
    } else {
      this.R += (this.targetR - this.R) * Math.min(1, dt * 1.5)
    }
    const thick = this.traits.has('membrane')
    if (thick && this.armor < 1) this.armor = Math.min(1, this.armor + dt / MEMBRANE_RESEAL)
    this.shielded = Math.max(0, this.shielded - dt)
    this.digest = Math.max(0, this.digest - dt)
    this.spikeImmune = Math.max(0, this.spikeImmune - dt)
    if (this.dashCooldown > 0) {
      this.dashCooldown = Math.max(0, this.dashCooldown - dt)
      if (this.dashCooldown === 0) this.flash = Math.max(this.flash, 0.5) // ready again
    }
    this.reach += (this.reachWant - this.reach) * Math.min(1, dt * 5)
    const muts = this.mutations
    if (muts.has('mitosis') && !eater) {
      this.budTimer -= dt
      this.bud = clamp(1 - this.budTimer / MITOSIS_WARNING, 0, 1)
    }
    if (!eater && muts.has('hypermetabolism')) this.grow(-scale.biomass * HYPER_BURN * dt)
    if (this.poison > 0) {
      this.poison = Math.max(0, this.poison - dt)
      this.grow(-this.biomass * 0.03 * dt)
    }
    if (this.traits.has('photosynthesis') && !eater) {
      // Light becomes biomass; it works best when the cell is still.
      const still = mag < 0.1 ? PHOTO_STILL_BONUS : 1
      this.grow(scale.biomass * PHOTO_RATE * still * this.envLight * dt)
    }
    const { cx, cy, cvx, cvy, R, pts, restX, restY, nx, ny, weight } = this

    // Best-fit rotation of the rest circle onto the current points (2D shape matching),
    // so the body can be spun by shear in the current instead of snapping back upright.
    let num = 0
    let den = 0
    for (let i = 0; i < POINTS; i++) {
      const rx = pts[i].x - cx
      const ry = pts[i].y - cy
      num += restX[i] * ry - restY[i] * rx
      den += restX[i] * rx + restY[i] * ry
    }
    const rot = Math.atan2(num, den)
    const cos = Math.cos(rot)
    const sin = Math.sin(rot)
    this.facingX = cos
    this.facingY = sin

    // Weak, rhythmic propulsion — a protocell squirms more than it swims.
    const pulse = 1 - tuning.pulse * (0.5 - 0.5 * Math.sin(time * tuning.pulseRate * TAU))
    // Heavier cells accelerate less; lighter ones don't get a bonus, or small prey would outrun everything.
    // Relative to the current scale, so handling is the same at 1x and 1000x.
    const massFactor = Math.min(1, Math.pow(this.biomass / scale.biomass, MASS_EXPONENT - 1))
    const base =
      tuning.thrust *
      THRUST_SCALE[this.species] *
      this.boost *
      massFactor *
      mag *
      (thick ? MEMBRANE_THRUST : 1) *
      (this.digest > 0 ? DIGEST_THRUST : 1) *
      (muts.has('hypermetabolism') ? HYPER_THRUST : 1) *
      (muts.has('gigantism') ? GIGANTISM_THRUST : 1) *
      (muts.has('miniaturization') ? MINI_THRUST : 1) *
      (this.poison > 0 ? 0.5 : 1)
    const stiffness = tuning.stiffness * (thick ? MEMBRANE_STIFFNESS : 1)
    const damping = tuning.wobbleDamping * (thick ? 1.3 : 1)
    const dragScale = (thick ? MEMBRANE_DRAG : 1) * (muts.has('sticky') ? STICKY_DRAG : 1) * this.envDrag
    let tx = ix * base * pulse
    let ty = iy * base * pulse

    // With a flagellum the real push comes from the tail and only points the way the body faces
    // (rest angle 0, opposite the tail). Steering becomes torque: the body has to swing around.
    let turn = 0
    let tailEffort = 0
    const tail = this.flagellum
    if (tail && mag > 0) {
      const fx = cos
      const fy = sin
      const err = Math.atan2(fx * iy - fy * ix, fx * ix + fy * iy)
      const align = Math.max(0, Math.cos(err))
      turn = tuning.flagellumTurn * clamp(err * 1.5, -1, 1) * mag
      // A lopsided giant tail always drags you round one way.
      if (muts.has('giantFlagellum')) turn += tuning.flagellumTurn * GIANT_FLAGELLUM_BIAS * mag
      tailEffort = mag * align
      const push =
        base *
        tuning.flagellumPower *
        (muts.has('giantFlagellum') ? GIANT_FLAGELLUM_POWER : 1) *
        align *
        align *
        tail.growth
      // The cell's own squirm is weak next to the tail.
      tx = tx * 0.3 + fx * push
      ty = ty * 0.3 + fy * push
    }
    const thrust = Math.hypot(tx, ty)
    this.thrust = thrust
    const dirX = thrust > 0 ? tx / thrust : 0
    const dirY = thrust > 0 ? ty / thrust : 0
    this.steerX = dirX
    this.steerY = dirY

    let wsum = 0
    for (let i = 0; i < POINTS; i++) {
      nx[i] = restX[i] * cos - restY[i] * sin
      ny[i] = restX[i] * sin + restY[i] * cos
      weight[i] = 0.35 + Math.max(0, -(nx[i] * dirX + ny[i] * dirY))
      wsum += weight[i]
    }

    for (let i = 0; i < POINTS; i++) {
      const p = pts[i]
      // Hypermetabolism breathes fast and shallow.
      const pace = muts.has('hypermetabolism') ? 2.6 : 1
      let shape = 1 + 0.03 * Math.sin(time * 1.7 * pace + i * 0.9) + 0.015 * Math.sin(time * 3.1 * pace - i * 2.3)
      if (this.bud > 0) {
        // Unstable Mitosis: a daughter swelling out of one side.
        const facing = Math.max(0, nx[i] * this.budDirX + ny[i] * this.budDirY)
        shape += 0.45 * this.bud * facing ** 6
      }
      if (this.reach > 0.01) {
        // Pseudopod: the membrane facing the target bulges out toward it.
        const facing = Math.max(0, nx[i] * this.reachDirX + ny[i] * this.reachDirY)
        shape += PSEUDOPOD_REACH * this.reach * facing ** 4
      }
      let ax = stiffness * (cx + nx[i] * R * shape - p.x) - damping * (p.vx - cvx)
      let ay = stiffness * (cy + ny[i] * R * shape - p.y) - damping * (p.vy - cvy)

      // Drag against the surrounding water, sampled just outside the body so the cell's own wake
      // doesn't count. The side facing the oncoming flow takes most of it, which flattens the front.
      fluid.sample(cx + nx[i] * R * 1.6, cy + ny[i] * R * 1.6)
      const rvx = p.vx - fluid.su
      const rvy = p.vy - fluid.sv
      const rl = Math.hypot(rvx, rvy)
      const facing = rl > 1e-3 ? Math.max(0, (nx[i] * rvx + ny[i] * rvy) / rl) : 0
      const k = tuning.drag * dragScale * (0.4 + tuning.frontDrag * facing)
      ax -= rvx * k
      ay -= rvy * k

      const share = (thrust * POINTS * weight[i]) / wsum
      ax += dirX * share + -ny[i] * turn
      ay += dirY * share + nx[i] * turn

      p.vx += ax * dt
      p.vy += ay * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      for (const vent of vents) vent.pushOut(p, 0)
    }

    this.updateCentroid()
    if (tail) {
      const m = pts[REAR]
      tail.step(dt, fluid, m.x, m.y, nx[REAR], ny[REAR], this.R, tailEffort)
      this.jetX = tail.jetX
      this.jetY = tail.jetY
    } else {
      this.jetX = this.cx - dirX * this.R * 1.3
      this.jetY = this.cy - dirY * this.R * 1.3
    }
    for (const b of this.inner) this.stepBlob(b, dt, time)
    for (let i = this.digesting.length - 1; i >= 0; i--) {
      const b = this.digesting[i]
      b.life -= dt
      if (b.life <= 0) this.digesting.splice(i, 1)
      else this.stepBlob(b, dt, time)
    }
    this.separateBlobs()
    this.wrap()
  }

  /** Take in a particle: it keeps its momentum, gets digested, and dents the membrane where it entered. */
  ingest(kind: Kind, x: number, y: number, vx: number, vy: number) {
    if (this.digesting.length > 40) this.digesting.shift()
    const life = kind === 'organic' ? rand(0.8, 1.4) : rand(1.6, 2.6)
    this.digesting.push({
      x,
      y,
      vx,
      vy,
      r: kind === 'lipid' ? 0.09 : kind === 'mineral' ? 0.08 : 0.05,
      rgb: NUTRIENT_RGB[kind],
      life,
      maxLife: life,
      seed: rand(0, 100),
    })
    this.flash = Math.min(1, this.flash + 0.5)

    let nearest = 0
    let best = Infinity
    for (let i = 0; i < POINTS; i++) {
      const d = (this.pts[i].x - x) ** 2 + (this.pts[i].y - y) ** 2
      if (d < best) {
        best = d
        nearest = i
      }
    }
    for (const [offset, strength] of [
      [0, 1],
      [-1, 0.5],
      [1, 0.5],
    ]) {
      const p = this.pts[(nearest + offset + POINTS) % POINTS]
      const dx = p.x - this.cx
      const dy = p.y - this.cy
      const d = Math.hypot(dx, dy) || 1
      p.vx -= (dx / d) * this.R * 1.2 * strength
      p.vy -= (dy / d) * this.R * 1.2 * strength
    }
  }

  /** Finish swallowing another cell: its body becomes chunks being digested. */
  ingestCell(prey: Protocell) {
    this.grow(prey.biomass * 0.8)
    if (this.traits.has('engulfing')) this.digest = DIGEST_TIME * Math.min(1, prey.biomass / this.biomass)
    const chunks = 3 + Math.round((prey.biomass / this.biomass) * 6)
    for (let i = 0; i < chunks; i++) {
      const life = rand(1.5, 3)
      this.digesting.push({
        x: this.cx + rand(-0.3, 0.3) * this.R,
        y: this.cy + rand(-0.3, 0.3) * this.R,
        vx: prey.cvx,
        vy: prey.cvy,
        r: rand(0.07, 0.12),
        rgb: prey.palette.rim,
        life,
        maxLife: life,
        seed: rand(0, 100),
      })
    }
    this.flash = 1
  }

  /** Shrink this cell toward (ox, oy) by k: the world is being rescaled around the player. */
  rescale(ox: number, oy: number, k: number) {
    const ncx = ox + wrapDelta(this.cx - ox, WORLD) * k
    const ncy = oy + wrapDelta(this.cy - oy, WORLD) * k
    for (const b of [...this.pts, ...this.inner, ...this.digesting]) {
      b.x = ncx + (b.x - this.cx) * k
      b.y = ncy + (b.y - this.cy) * k
      b.vx *= k
      b.vy *= k
    }
    this.flagellum?.rescale(this.cx, this.cy, ncx, ncy, k)
    this.cx = ncx
    this.cy = ncy
    this.cvx *= k
    this.cvy *= k
    this.R *= k
    this.targetR *= k
    this.engulfStartR *= k
  }

  /** Squishy contact: push this cell's membrane points out of `other`'s body. */
  pushOutOf(other: Protocell) {
    const r = other.R * 0.95
    for (const p of this.pts) {
      const dx = wrapDelta(p.x - other.cx, WORLD)
      const dy = wrapDelta(p.y - other.cy, WORLD)
      const d2 = dx * dx + dy * dy
      if (d2 >= r * r) continue
      const d = Math.sqrt(d2) || 0.001
      const nx = dx / d
      const ny = dy / d
      // Split the overlap (the other cell does the same from its side); a thick membrane barely gives.
      const share = this.traits.has('membrane')
        ? MEMBRANE_YIELD
        : other.traits.has('membrane')
          ? 1 - MEMBRANE_YIELD
          : 0.5
      p.x += nx * (r - d) * share
      p.y += ny * (r - d) * share
      const vn = (p.vx - other.cvx) * nx + (p.vy - other.cvy) * ny
      if (vn < 0) {
        p.vx -= vn * nx
        p.vy -= vn * ny
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, view: View) {
    const cx = view.sx(this.cx)
    const cy = view.sy(this.cy)
    const R = this.R * view.zoom
    if (!view.onScreen(cx, cy, R * (this.flagellum ? 3.5 : 2.5))) return
    const pal = this.palette
    const alpha = this.screenAlpha
    ctx.globalAlpha = alpha
    const { sx, sy } = this
    for (let i = 0; i < POINTS; i++) {
      // Offsets from the centre, so only the centre is wrapped and the outline can't split across the seam.
      sx[i] = cx + (this.pts[i].x - this.cx) * view.zoom
      sy[i] = cy + (this.pts[i].y - this.cy) * view.zoom
    }
    // Smooth closed curve through the membrane points.
    const path = new Path2D()
    path.moveTo((sx[POINTS - 1] + sx[0]) / 2, (sy[POINTS - 1] + sy[0]) / 2)
    for (let i = 0; i < POINTS; i++) {
      const j = (i + 1) % POINTS
      path.quadraticCurveTo(sx[i], sy[i], (sx[i] + sx[j]) / 2, (sy[i] + sy[j]) / 2)
    }
    path.closePath()

    // The tail sits behind the body, so it seems to grow out from under the membrane.
    this.flagellum?.draw(ctx, this.cx, this.cy, cx, cy, view.zoom, this.R, pal.rim)

    if (this.aura) {
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = (0.22 + this.flash * 0.15) * alpha * this.glowScale
      ctx.drawImage(this.aura, cx - R * 2.4, cy - R * 2.4, R * 4.8, R * 4.8)
      ctx.globalAlpha = alpha
      ctx.globalCompositeOperation = 'source-over'
    }

    if (this.traits.has('photosynthesis')) {
      // The giveaway glow that makes photosynthesisers easy to spot.
      Protocell.photoGlow ??= glowSprite(120, 240, 110)
      ctx.globalCompositeOperation = 'lighter'
      // A lure pulses: slow, bright, hypnotic.
      const lure = this.traits.has('lure')
      const pulse = lure ? 0.32 + 0.18 * Math.sin(this.age * 2.2) : 0.2 + 0.05 * Math.sin(this.age * 1.3)
      const size = R * (lure ? 7 : 6)
      ctx.globalAlpha = pulse * alpha * this.glowScale
      ctx.drawImage(Protocell.photoGlow, cx - size / 2, cy - size / 2, size, size)
      ctx.globalAlpha = alpha
      ctx.globalCompositeOperation = 'source-over'
    }

    const body = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.05, cx, cy, R * 1.05)
    body.addColorStop(0, `rgba(${pal.highlight},0.20)`)
    body.addColorStop(0.6, `rgba(${pal.body},0.10)`)
    body.addColorStop(1, `rgba(${pal.body},0.30)`)
    ctx.fillStyle = body
    ctx.fill(path)

    ctx.save()
    ctx.clip(path)
    for (const b of this.inner) this.drawBlob(ctx, view.zoom, cx, cy, b, 0.9)
    for (const b of this.digesting) {
      const t = b.life / b.maxLife
      this.drawBlob(ctx, view.zoom, cx, cy, b, 0.85 * Math.min(1, t * 2), Math.sqrt(t))
    }
    ctx.restore()

    const thick = this.traits.has('membrane')
    const cracked = thick && this.armor < 1
    ctx.lineJoin = 'round'
    ctx.lineWidth = R * (thick ? 0.32 : 0.2)
    ctx.strokeStyle = `rgba(${pal.glow},${0.08 + this.flash * 0.08})`
    ctx.stroke(path)
    // A cracked thick membrane shows as a broken rim until it reseals.
    if (cracked) ctx.setLineDash([R * (0.25 + 0.5 * this.armor), R * 0.18 * (1 - this.armor) + 1])
    ctx.lineWidth = Math.max(1.5, R * (thick ? 0.11 : 0.055))
    ctx.strokeStyle = `rgba(${pal.rim},${(cracked ? 0.45 : 0.6) + this.flash * 0.3})`
    ctx.stroke(path)
    ctx.setLineDash([])
    if (thick) {
      // Inner layer of the membrane.
      ctx.save()
      ctx.translate(cx, cy)
      ctx.scale(0.84, 0.84)
      ctx.translate(-cx, -cy)
      ctx.lineWidth = Math.max(1, R * 0.04) / 0.84
      ctx.strokeStyle = `rgba(${pal.rim},${0.3 * this.armor + 0.1})`
      ctx.stroke(path)
      ctx.restore()
    }

    if (this.traits.has('spikes')) {
      // Barbs along the outward normal of every other membrane point.
      ctx.beginPath()
      for (let i = 0; i < POINTS; i += 2) {
        const dx = sx[i] - cx
        const dy = sy[i] - cy
        const d = Math.hypot(dx, dy) || 1
        const nx = dx / d
        const ny = dy / d
        const w = R * 0.07
        ctx.moveTo(sx[i] - ny * w, sy[i] + nx * w)
        ctx.lineTo(sx[i] + nx * R * 0.24, sy[i] + ny * R * 0.24)
        ctx.lineTo(sx[i] + ny * w, sy[i] - nx * w)
      }
      if (this.mutations.has('hollowSpines')) {
        ctx.lineWidth = Math.max(1, R * 0.03)
        ctx.strokeStyle = `rgba(${pal.rim},0.9)`
        ctx.stroke()
      } else {
        ctx.fillStyle = `rgba(${pal.rim},0.85)`
        ctx.fill()
      }
    }

    if (this.mutations.has('sticky')) {
      // Grit stuck to the membrane.
      ctx.fillStyle = 'rgba(190,200,170,0.55)'
      for (let i = 1; i < POINTS; i += 3) {
        ctx.beginPath()
        ctx.arc(sx[i] + (sx[i] - cx) * 0.06, sy[i] + (sy[i] - cy) * 0.06, Math.max(0.8, R * 0.035), 0, TAU)
        ctx.fill()
      }
    }
    if (this.hazard > 0.02) {
      // Sizzling at the edges: something in the water is eating the membrane.
      ctx.lineWidth = R * 0.14
      ctx.strokeStyle = `rgba(${this.hazardRgb},${this.hazard * (0.35 + 0.3 * Math.sin(this.age * 22))})`
      ctx.stroke(path)
    }
    if (this.mutations.has('hypermetabolism') || this.poison > 0) {
      // Running hot (orange), or poisoned (violet).
      ctx.lineWidth = R * 0.12
      ctx.strokeStyle = this.poison > 0 ? 'rgba(190,110,255,0.35)' : 'rgba(255,140,90,0.22)'
      ctx.stroke(path)
    }

    // Specular highlight.
    ctx.beginPath()
    ctx.arc(cx - R * 0.08, cy - R * 0.08, R * 0.7, Math.PI * 1.08, Math.PI * 1.42)
    ctx.lineCap = 'round'
    ctx.lineWidth = R * 0.07
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  /** `cx, cy` is the cell centre on screen. */
  private drawBlob(
    ctx: CanvasRenderingContext2D,
    zoom: number,
    cx: number,
    cy: number,
    b: Blob,
    alpha: number,
    scale = 1,
  ) {
    const r = b.r * scale * this.R * zoom
    if (r < 0.3) return
    const x = cx + (b.x - this.cx) * zoom
    const y = cy + (b.y - this.cy) * zoom
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(${b.rgb},${alpha})`)
    g.addColorStop(0.6, `rgba(${b.rgb},${alpha * 0.6})`)
    g.addColorStop(1, `rgba(${b.rgb},0)`)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, TAU)
    ctx.fill()
  }

  /** Cytoplasm: blobs lag behind the cell's motion (so they slosh) and wander gently. */
  private stepBlob(b: Blob, dt: number, time: number) {
    const { cx, cy, cvx, cvy, R } = this
    b.vx += ((cvx - b.vx) * 2.2 + (cx - b.x) * 1.2 + Math.sin(time * 0.9 + b.seed) * R * 0.4) * dt
    b.vy += ((cvy - b.vy) * 2.2 + (cy - b.y) * 1.2 + Math.cos(time * 0.7 + b.seed * 1.3) * R * 0.4) * dt
    b.x += b.vx * dt
    b.y += b.vy * dt
    const dx = b.x - cx
    const dy = b.y - cy
    const d = Math.hypot(dx, dy)
    const max = R * (0.68 - b.r)
    if (d > max && d > 0) {
      const nx = dx / d
      const ny = dy / d
      b.x = cx + nx * max
      b.y = cy + ny * max
      const vn = (b.vx - cvx) * nx + (b.vy - cvy) * ny
      if (vn > 0) {
        b.vx -= vn * nx * 1.5
        b.vy -= vn * ny * 1.5
      }
    }
  }

  private separateBlobs() {
    const all = this.inner.length + this.digesting.length
    const get = (i: number) => (i < this.inner.length ? this.inner[i] : this.digesting[i - this.inner.length])
    for (let a = 0; a < all; a++) {
      const ba = get(a)
      for (let b = a + 1; b < all; b++) {
        const bb = get(b)
        const dx = bb.x - ba.x
        const dy = bb.y - ba.y
        const min = (ba.r + bb.r) * this.R
        const d2 = dx * dx + dy * dy
        if (d2 >= min * min) continue
        const d = Math.sqrt(d2) || 0.001
        const push = (min - d) * 0.5
        ba.x -= (dx / d) * push
        ba.y -= (dy / d) * push
        bb.x += (dx / d) * push
        bb.y += (dy / d) * push
      }
    }
  }

  private updateCentroid() {
    let x = 0
    let y = 0
    let vx = 0
    let vy = 0
    for (const p of this.pts) {
      x += p.x
      y += p.y
      vx += p.vx
      vy += p.vy
    }
    this.cx = x / POINTS
    this.cy = y / POINTS
    this.cvx = vx / POINTS
    this.cvy = vy / POINTS
  }

  /** Keep coordinates inside the torus so precision never drifts. */
  private wrap() {
    const shiftX = this.cx < 0 ? WORLD : this.cx >= WORLD ? -WORLD : 0
    const shiftY = this.cy < 0 ? WORLD : this.cy >= WORLD ? -WORLD : 0
    if (!shiftX && !shiftY) return
    for (const b of [...this.pts, ...this.inner, ...this.digesting]) {
      b.x += shiftX
      b.y += shiftY
    }
    this.cx += shiftX
    this.cy += shiftY
    this.flagellum?.shift(shiftX, shiftY)
  }
}
