import GUI from 'lil-gui'
import './style.css'

// Phase 0 stub: a single cell you can drag around, so the loop, canvas sizing and
// touch input are proven on a phone before the real prototype goes in.

const canvas = document.querySelector<HTMLCanvasElement>('#game')!
const ctx = canvas.getContext('2d')!

const tuning = {
  thrust: 1200,
  drag: 2.5,
}

const gui = new GUI({ title: 'Tuning' })
gui.add(tuning, 'thrust', 0, 5000)
gui.add(tuning, 'drag', 0, 10)
gui.close()

const player = { x: 0, y: 0, vx: 0, vy: 0, radius: 20 }
let pointer: { x: number; y: number } | null = null

function resize() {
  const dpr = window.devicePixelRatio || 1
  canvas.width = canvas.clientWidth * dpr
  canvas.height = canvas.clientHeight * dpr
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}
window.addEventListener('resize', resize)
resize()

canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId)
  pointer = { x: e.clientX, y: e.clientY }
})
canvas.addEventListener('pointermove', e => {
  if (pointer) pointer = { x: e.clientX, y: e.clientY }
})
canvas.addEventListener('pointerup', () => (pointer = null))
canvas.addEventListener('pointercancel', () => (pointer = null))

function update(dt: number) {
  if (pointer) {
    // Screen centre is the player, so the pointer offset is the steering direction.
    const dx = pointer.x - canvas.clientWidth / 2
    const dy = pointer.y - canvas.clientHeight / 2
    const len = Math.hypot(dx, dy)
    if (len > 1) {
      player.vx += (dx / len) * tuning.thrust * dt
      player.vy += (dy / len) * tuning.thrust * dt
    }
  }
  const damping = Math.exp(-tuning.drag * dt)
  player.vx *= damping
  player.vy *= damping
  player.x += player.vx * dt
  player.y += player.vy * dt
}

function draw() {
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  ctx.fillStyle = '#04121a'
  ctx.fillRect(0, 0, w, h)

  ctx.save()
  ctx.translate(w / 2 - player.x, h / 2 - player.y)

  // Reference grid so movement is visible while there's nothing else in the world.
  const grid = 80
  ctx.strokeStyle = '#0b2a36'
  ctx.lineWidth = 1
  const left = Math.floor((player.x - w / 2) / grid) * grid
  const top = Math.floor((player.y - h / 2) / grid) * grid
  ctx.beginPath()
  for (let x = left; x < player.x + w / 2; x += grid) {
    ctx.moveTo(x, player.y - h / 2)
    ctx.lineTo(x, player.y + h / 2)
  }
  for (let y = top; y < player.y + h / 2; y += grid) {
    ctx.moveTo(player.x - w / 2, y)
    ctx.lineTo(player.x + w / 2, y)
  }
  ctx.stroke()

  ctx.fillStyle = '#7fe0c4'
  ctx.beginPath()
  ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

let last = performance.now()
function frame(now: number) {
  const dt = Math.min((now - last) / 1000, 1 / 20)
  last = now
  update(dt)
  draw()
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
