import { clamp, rand } from './math'
import type { Kind } from './nutrients'

const STORAGE_KEY = 'primordial.muted'

/**
 * All sound is synthesised with Web Audio: no assets. The context can only start after a user
 * gesture, so everything is a no-op until the first tap or key press.
 * Pan values are -1 (left) to 1 (right).
 */
export class Sound {
  muted: boolean
  private ctx: AudioContext | null = null
  private master!: GainNode
  private noise!: AudioBuffer
  private rumble!: GainNode
  private volume = 0.7
  private readonly last = new Map<string, number>()

  constructor() {
    this.muted = readMuted()
    const unlock = () => this.unlock()
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
  }

  get running() {
    return this.ctx?.state === 'running'
  }

  setVolume(v: number) {
    this.volume = v
    this.applyVolume()
  }

  toggleMute() {
    this.muted = !this.muted
    try {
      localStorage.setItem(STORAGE_KEY, this.muted ? '1' : '0')
    } catch {
      // Storage can be unavailable (private mode); muting still works for this session.
    }
    this.applyVolume()
    return this.muted
  }

  /** Called every frame: `rumble` 0..1 is how strongly something big is looming nearby. */
  update(rumble: number) {
    if (!this.ctx) return
    this.rumble.gain.setTargetAtTime(clamp(rumble, 0, 1) * 0.5, this.ctx.currentTime, 0.4)
  }

  // ── Events ────────────────────────────────────────────────────────────────

  absorb(kind: Kind, pan: number) {
    if (!this.ready('absorb', 35)) return
    if (kind === 'organic') {
      const f = rand(850, 1250)
      this.tone('sine', f, f * 1.5, 0.08, 0.05, pan)
    } else if (kind === 'lipid') {
      this.tone('sine', 480, 700, 0.14, 0.09, pan)
      this.tone('sine', 960, 1300, 0.08, 0.02, pan)
    } else {
      // Minerals: glassy, with inharmonic partials.
      this.tone('triangle', 1400, 1400, 0.25, 0.05, pan)
      this.tone('sine', 2230, 2230, 0.18, 0.025, pan)
    }
  }

  gulp(pan: number) {
    this.tone('sine', 260, 70, 0.32, 0.28, pan, 0.01)
    this.noiseBurst('lowpass', 700, 200, 1, 0.22, 0.08, pan)
  }

  thud(strength: number, pan: number) {
    if (!this.ready('thud', 90)) return
    const s = clamp(strength, 0.1, 1)
    this.noiseBurst('lowpass', 220, 120, 1, 0.12, 0.22 * s, pan)
    this.tone('sine', 95, 50, 0.14, 0.18 * s, pan)
  }

  tear(pan: number) {
    if (!this.ready('tear', 60)) return
    this.noiseBurst('bandpass', 1800, 900, 2, 0.13, 0.22, pan)
    this.tone('square', 320, 110, 0.06, 0.04, pan)
  }

  clang(pan: number) {
    for (const [f, peak] of [
      [520, 0.12],
      [1337, 0.05],
      [2211, 0.03],
    ]) {
      this.tone('triangle', f, f * 0.99, 0.7, peak, pan, 0.002)
    }
  }

  whoosh(pan: number) {
    this.noiseBurst('bandpass', 380, 1700, 1.5, 0.36, 0.2, pan, 0.05)
  }

  evolve() {
    ;[523, 659, 784, 1046].forEach((f, i) => this.tone('sine', f, f, 1.2, 0.07, 0, 0.02, i * 0.09))
  }

  mutation() {
    this.tone('sawtooth', 180, 250, 0.9, 0.035, 0, 0.05, 0, 900)
    this.tone('sawtooth', 191, 232, 0.9, 0.035, 0, 0.05, 0, 900)
    this.tone('sine', 466, 420, 0.7, 0.04, 0, 0.1, 0.15)
  }

  rupture(pan: number) {
    this.noiseBurst('lowpass', 1400, 150, 1, 0.9, 0.35, pan)
    this.tone('sine', 130, 32, 1.1, 0.35, pan, 0.005)
  }

  colonyLost(pan: number) {
    this.tone('sine', 640, 240, 0.28, 0.09, pan)
  }

  transitionBegin() {
    this.tone('sine', 110, 440, 1.6, 0.1, 0, 0.3)
    this.tone('sine', 165, 660, 1.6, 0.06, 0, 0.3)
    this.noiseBurst('bandpass', 300, 2400, 2, 1.4, 0.06, 0, 0.4)
  }

  transitionComplete() {
    ;[261.6, 329.6, 392, 523.3, 659.3].forEach((f, i) => this.tone('sine', f, f, 3.2, 0.06, 0, 0.35, i * 0.12))
  }

  // ── Plumbing ──────────────────────────────────────────────────────────────

  private unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return
    }
    try {
      this.ctx = new AudioContext()
    } catch {
      return // no Web Audio: play silently
    }
    const ctx = this.ctx
    const compressor = ctx.createDynamicsCompressor()
    compressor.connect(ctx.destination)
    this.master = ctx.createGain()
    this.master.connect(compressor)
    this.applyVolume()

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const data = this.noise.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1

    this.startAmbience()
  }

  /** A low, slowly breathing drone with filtered water noise, plus a sub-bass rumble for big things. */
  private startAmbience() {
    const ctx = this.ctx!
    const pad = ctx.createBiquadFilter()
    pad.type = 'lowpass'
    pad.frequency.value = 260
    const padGain = ctx.createGain()
    padGain.gain.value = 0.05
    pad.connect(padGain).connect(this.master)
    for (const f of [55, 82.6, 110.3]) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = f
      osc.connect(pad)
      osc.start()
    }
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.07
    const lfoDepth = ctx.createGain()
    lfoDepth.gain.value = 120
    lfo.connect(lfoDepth).connect(pad.frequency)
    lfo.start()

    const water = ctx.createBufferSource()
    water.buffer = this.noise
    water.loop = true
    const waterFilter = ctx.createBiquadFilter()
    waterFilter.type = 'lowpass'
    waterFilter.frequency.value = 380
    const waterGain = ctx.createGain()
    waterGain.gain.value = 0.035
    water.connect(waterFilter).connect(waterGain).connect(this.master)
    water.start()

    this.rumble = ctx.createGain()
    this.rumble.gain.value = 0
    this.rumble.connect(this.master)
    for (const f of [36, 43]) {
      const osc = ctx.createOscillator()
      osc.frequency.value = f
      osc.connect(this.rumble)
      osc.start()
    }
  }

  private applyVolume() {
    if (!this.ctx) return
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.05)
  }

  /** Rate-limit a sound so bursts of events don't stack into noise. */
  private ready(key: string, ms: number) {
    if (!this.ctx || this.muted) return false
    const now = performance.now()
    if (now - (this.last.get(key) ?? 0) < ms) return false
    this.last.set(key, now)
    return true
  }

  private out(pan: number) {
    const p = this.ctx!.createStereoPanner()
    p.pan.value = clamp(pan, -1, 1)
    p.connect(this.master)
    return p
  }

  private tone(
    type: OscillatorType,
    from: number,
    to: number,
    dur: number,
    peak: number,
    pan: number,
    attack = 0.005,
    delay = 0,
    lowpass = 0,
  ) {
    const ctx = this.ctx
    if (!ctx || this.muted) return
    const t = ctx.currentTime + delay
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(from, t)
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(peak, t + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur)
    let node: AudioNode = osc
    if (lowpass) {
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = lowpass
      node = node.connect(f)
    }
    node.connect(g).connect(this.out(pan))
    osc.start(t)
    osc.stop(t + attack + dur + 0.05)
  }

  private noiseBurst(
    type: BiquadFilterType,
    from: number,
    to: number,
    q: number,
    dur: number,
    peak: number,
    pan: number,
    attack = 0.004,
  ) {
    const ctx = this.ctx
    if (!ctx || this.muted) return
    const t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const f = ctx.createBiquadFilter()
    f.type = type
    f.Q.value = q
    f.frequency.setValueAtTime(from, t)
    f.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(peak, t + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur)
    src.connect(f).connect(g).connect(this.out(pan))
    src.start(t, Math.random() * 1.5)
    src.stop(t + attack + dur + 0.05)
  }
}

function readMuted() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/** Vibrate where supported (most Android browsers; not iOS Safari). */
export function haptic(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    // Some browsers throw if vibration is blocked; it's only a nicety.
  }
}
