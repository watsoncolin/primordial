import { Protocell, type Species } from './protocell'
import type { Fluid } from './fluid'
import { View } from './view'
import './field-guide.css'

const ROLES: { species: Species; name: string; action: string; detail: string }[] = [
  {
    species: 'grazer',
    name: 'Drifting protocell',
    action: 'Follow the food',
    detail: 'A soft, drifting sac. It gathers molecules and flees larger cells. Catch one small enough to swallow.',
  },
  {
    species: 'engulfer',
    name: 'Flagellated hunter',
    action: 'Dodge across its path',
    detail:
      'A tapered hunter with a muscular tail. Forward chevrons warn of its lunge; its recovery is your chance to escape.',
  },
  {
    species: 'scavenger',
    name: 'Armored scavenger',
    action: 'Watch the plates',
    detail:
      'A slow, shelled feeder near vent lipids. Its armor repels one engulfing attempt, then needs time to reseal.',
  },
  {
    species: 'producer',
    name: 'Light colony',
    action: 'Explore the shallows',
    detail:
      'A rosette that grows in sunlight and releases organics. The colony tolerates UV; an unadapted visitor does not.',
  },
  {
    species: 'filter',
    name: 'Filter feeder',
    action: 'Read the current',
    detail:
      'An anchored fan beside a vent. Its fringe gathers passing organics and folds away when bumped. It can still be swallowed if small enough.',
  },
]

/** Actual game bodies, settled in still water, rather than unrelated illustrations. */
function specimen(species: Species): HTMLCanvasElement {
  const cell = new Protocell(500, 500, 1, species)
  cell.glows = false
  if (species === 'scavenger') cell.addTrait('membrane')
  if (species === 'producer') cell.addTrait('photosynthesis')
  const water = { su: 0, sv: 0, sample() {} } as unknown as Fluid
  for (let i = 0; i < 90; i++) {
    cell.aim(1, 0)
    cell.step(1 / 60, water, 1, 0, 0.15, i / 60, [])
    cell.clearAim()
  }
  const canvas = document.createElement('canvas')
  canvas.width = 440
  canvas.height = 280
  canvas.setAttribute('aria-label', `${ROLES.find(r => r.species === species)!.name} body`)
  canvas.setAttribute('role', 'img')
  const ctx = canvas.getContext('2d')!
  ctx.scale(2, 2)
  const view = new View()
  view.w = 220
  view.h = 140
  view.zoom = 1.6
  view.x = cell.cx - (species === 'engulfer' ? cell.R * 0.7 : 0)
  view.y = cell.cy
  cell.draw(ctx, view, 1.5)
  return canvas
}

export class FieldGuide {
  private readonly dialog = document.createElement('dialog')
  private readonly release: () => void
  private readonly canOpen: () => boolean
  get isOpen() {
    return this.dialog.open
  }

  constructor(release: () => void, canOpen: () => boolean) {
    this.release = release
    this.canOpen = canOpen
    const button = document.createElement('button')
    button.id = 'life-guide-btn'
    button.type = 'button'
    button.textContent = 'life guide'
    button.setAttribute('aria-haspopup', 'dialog')
    button.addEventListener('click', () => this.open())
    this.dialog.id = 'life-guide'
    this.dialog.setAttribute('aria-labelledby', 'life-guide-title')
    this.dialog.innerHTML =
      '<header><div><p class="eyebrow">PAUSED · FIELD NOTES</p><h1 id="life-guide-title">Life around you</h1></div><button type="button" autofocus>Close · Esc</button></header><p class="intro">Size decides who can swallow whom. Learn the bodies, then watch how they move.</p><div class="specimens"></div>'
    this.dialog.querySelector('button')!.addEventListener('click', () => this.dialog.close())
    this.dialog.addEventListener('close', () => this.release())
    this.dialog.addEventListener('keydown', e => e.stopPropagation())
    for (const role of ROLES) {
      const card = document.createElement('article')
      card.append(specimen(role.species))
      const name = document.createElement('h2')
      name.textContent = role.name
      const action = document.createElement('p')
      action.className = 'action'
      action.textContent = role.action
      const detail = document.createElement('p')
      detail.textContent = role.detail
      card.append(name, action, detail)
      this.dialog.querySelector('.specimens')!.append(card)
    }
    document.body.append(button, this.dialog)
  }

  open() {
    if (this.isOpen || !this.canOpen()) return
    this.release()
    this.dialog.showModal()
  }
}
