import { MUTATIONS, type MutationId } from './mutations'
import { type RunRecord, type Save, UNLOCKS, type UnlockId, heritableChoices, writeSave } from './save'
import { TRAITS } from './traits'
import { lineageFor } from './transition'

const BRANCH_RGB: Record<string, string> = {
  mobility: '120,200,255',
  defense: '175,255,235',
  predation: '255,150,180',
  light: '150,240,120',
  senses: '220,190,255',
  hybrid: '255,215,140',
  none: '200,215,215',
}

const W = 400
const GEN_GAP = 96
const PAD_TOP = 70
const PAD_BOTTOM = 70
const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * The Tree of Life: your personal evolutionary history. The trunk climbs through your generations;
 * each established lineage branches off it as a named species, and extinct runs are withered twigs.
 * Alongside it, DNA buys permanent unlocks that widen what future runs can become.
 */
export class TreeOfLife {
  private readonly svg: SVGSVGElement
  private readonly detail: HTMLElement
  private readonly shop: HTMLElement
  private readonly header: HTMLElement
  private selected: RunRecord | null = null
  private readonly root: HTMLElement
  private readonly save: Save
  private readonly onClose: () => void

  /** `onClose` runs when the overlay is dismissed. */
  constructor(root: HTMLElement, save: Save, onClose: () => void) {
    this.root = root
    this.save = save
    this.onClose = onClose
    this.svg = root.querySelector('svg')!
    this.detail = root.querySelector('.detail')!
    this.shop = root.querySelector('.shop')!
    this.header = root.querySelector('.summary')!
    root.querySelector('[data-action="close"]')!.addEventListener('click', () => this.close())
    const copy = root.querySelector<HTMLButtonElement>('[data-action="copy"]')!
    copy.addEventListener('click', async () => {
      // Every run with its telemetry, as JSON, for playtest notes and analysis.
      try {
        await navigator.clipboard.writeText(JSON.stringify(this.save.runs, null, 2))
        copy.textContent = 'Copied'
      } catch {
        copy.textContent = 'Copy failed'
      }
      setTimeout(() => (copy.textContent = 'Copy run data'), 1500)
    })
  }

  get isOpen() {
    return this.root.classList.contains('shown')
  }

  open() {
    this.selected = [...this.save.runs].reverse().find(r => r.outcome === 'lineage') ?? null
    this.render()
    this.root.classList.add('shown')
    // Newest growth is at the top.
    this.root.querySelector('.canvas')!.scrollTop = 0
  }

  close() {
    if (!this.isOpen) return
    this.root.classList.remove('shown')
    this.onClose()
  }

  render() {
    const { save } = this
    const lineages = save.runs.filter(r => r.outcome === 'lineage').length
    this.header.textContent =
      `Generation ${save.generation} · ${lineages} ${lineages === 1 ? 'lineage' : 'lineages'} · ` +
      `${save.runs.length - lineages} extinct · ${save.dna} DNA`
    this.drawTree()
    this.renderDetail()
    this.renderShop()
  }

  // ── The tree ───────────────────────────────────────────────────────────────

  private drawTree() {
    const { save, svg } = this
    const gens = save.generation
    const H = PAD_TOP + PAD_BOTTOM + gens * GEN_GAP
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
    svg.style.height = `${H}px`
    svg.replaceChildren()
    const cx = W / 2
    const yOf = (g: number) => H - PAD_BOTTOM - g * GEN_GAP

    // Trunk: from the root up to the current generation's bud, swaying a little.
    let d = `M ${cx} ${H - PAD_BOTTOM + 20}`
    for (let g = 1; g <= gens; g++) {
      const sway = Math.sin(g * 1.7) * 14
      d += ` S ${cx + sway} ${yOf(g) + GEN_GAP * 0.5}, ${cx + sway * 0.4} ${yOf(g)}`
    }
    this.path(d, 'rgba(175,255,235,0.35)', 5)
    this.text(cx, H - PAD_BOTTOM + 44, 'LIFE', 'root')

    for (let g = 1; g <= gens; g++) {
      const y = yOf(g)
      const trunkX = cx + Math.sin(g * 1.7) * 14 * 0.4
      const runs = save.runs.filter(r => r.generation === g)
      // Extinct attempts: short faded twigs off the trunk segment leading up to this generation.
      runs
        .filter(r => r.outcome === 'extinct')
        .forEach((r, i) => {
          const side = i % 2 ? -1 : 1
          const along = y + GEN_GAP * (0.25 + 0.5 * ((i * 0.37) % 1))
          const len = 26 + ((i * 13) % 22)
          const tx = trunkX + side * len
          const ty = along - len * 0.55
          this.path(
            `M ${trunkX} ${along} Q ${trunkX + side * len * 0.4} ${along - 4}, ${tx} ${ty}`,
            'rgba(160,170,170,0.25)',
            1.5,
          )
          this.node(tx, ty, 2.5, 'rgba(160,170,170,0.45)', r)
        })
      const lineage = runs.find(r => r.outcome === 'lineage')
      if (lineage) {
        // An established species branches off and persists as a named leaf.
        const side = g % 2 ? 1 : -1
        const lx = trunkX + side * 92
        const ly = y - 18
        const rgb = BRANCH_RGB[lineageFor(lineage.traits).branch]
        this.path(
          `M ${trunkX} ${y + 10} C ${trunkX + side * 30} ${y}, ${lx - side * 30} ${ly + 8}, ${lx} ${ly}`,
          `rgba(${rgb},0.6)`,
          3,
        )
        this.node(lx, ly, this.selected === lineage ? 9 : 7, `rgba(${rgb},0.95)`, lineage)
        const label = this.text(lx + side * 14, ly + 4, lineage.name, 'name')
        label.setAttribute('text-anchor', side > 0 ? 'start' : 'end')
        const gen = this.text(lx + side * 14, ly + 18, `gen ${g}`, 'gen')
        gen.setAttribute('text-anchor', side > 0 ? 'start' : 'end')
      } else {
        // This generation is still living: a glowing bud at the tip.
        const bud = this.node(trunkX, y, 6, 'rgba(175,255,235,0.9)', null)
        bud.classList.add('bud')
        this.text(trunkX, y - 14, 'you are here', 'here')
      }
    }
  }

  private path(d: string, stroke: string, width: number) {
    const p = document.createElementNS(SVG_NS, 'path')
    p.setAttribute('d', d)
    p.setAttribute('fill', 'none')
    p.setAttribute('stroke', stroke)
    p.setAttribute('stroke-width', String(width))
    p.setAttribute('stroke-linecap', 'round')
    this.svg.append(p)
    return p
  }

  private node(x: number, y: number, r: number, fill: string, run: RunRecord | null) {
    const c = document.createElementNS(SVG_NS, 'circle')
    c.setAttribute('cx', String(x))
    c.setAttribute('cy', String(y))
    c.setAttribute('r', String(r))
    c.setAttribute('fill', fill)
    if (run) {
      c.classList.add('pick')
      c.addEventListener('click', () => {
        this.selected = run
        this.render()
      })
    }
    this.svg.append(c)
    return c
  }

  private text(x: number, y: number, content: string, cls: string) {
    const t = document.createElementNS(SVG_NS, 'text')
    t.setAttribute('x', String(x))
    t.setAttribute('y', String(y))
    t.setAttribute('text-anchor', 'middle')
    t.classList.add(cls)
    t.textContent = content
    this.svg.append(t)
    return t
  }

  // ── Side panel ─────────────────────────────────────────────────────────────

  private renderDetail() {
    const r = this.selected
    if (!r) {
      this.detail.innerHTML =
        '<p class="empty">No lineages yet. Reach the Great Transition to establish your first species.</p>'
      return
    }
    const time = `${Math.floor(r.seconds / 60)}:${String(r.seconds % 60).padStart(2, '0')}`
    const traits = r.traits.map(t => TRAITS[t].name).join(', ') || 'none'
    const muts = r.mutations.map(m => MUTATIONS[m].name).join(', ') || 'none'
    this.detail.innerHTML = ''
    const h = document.createElement('h3')
    h.textContent = r.outcome === 'lineage' ? r.name : 'Extinct protocell'
    const form = document.createElement('p')
    form.className = 'form'
    form.textContent = r.outcome === 'lineage' ? `Became ${r.form}.` : 'Died before it could establish a lineage.'
    const facts = document.createElement('dl')
    for (const [k, v] of [
      ['Generation', String(r.generation)],
      ['Time', time],
      ['Peak biomass', `×${r.peakBiomass.toFixed(1)}`],
      ['Cells absorbed', String(r.cellsEaten)],
      ['Adaptations', traits],
      ['Mutations', muts],
      ['DNA earned', String(r.dna)],
      ...(r.stats
        ? [
            ['Ended by', r.stats.cause],
            ['First evolution', r.stats.firstEvolutionAt === null ? 'none' : `${r.stats.firstEvolutionAt}s`],
            ['Ready to transition', r.stats.transitionReadyAt === null ? 'never' : `${r.stats.transitionReadyAt}s`],
          ]
        : []),
    ]) {
      const dt = document.createElement('dt')
      dt.textContent = k
      const dd = document.createElement('dd')
      dd.textContent = v
      facts.append(dt, dd)
    }
    this.detail.append(h, form, facts)
  }

  private renderShop() {
    const { save } = this
    this.shop.innerHTML = '<h3>Unlocks</h3>'
    for (const u of Object.values(UNLOCKS)) {
      const owned = save.unlocks.includes(u.id)
      const row = document.createElement('div')
      row.className = 'unlock' + (owned ? ' owned' : '')
      const name = document.createElement('strong')
      name.textContent = u.name
      const detail = document.createElement('span')
      detail.textContent = u.detail
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = owned ? 'Unlocked' : `${u.cost} DNA`
      btn.disabled = owned || save.dna < u.cost
      btn.addEventListener('click', () => this.buy(u.id))
      row.append(name, detail, btn)
      if (owned && u.id === 'heritableMutation') row.append(this.heritableSelect())
      this.shop.append(row)
    }
  }

  private heritableSelect() {
    const select = document.createElement('select')
    const choices = heritableChoices(this.save)
    const none = new Option(choices.length ? 'No inherited mutation' : 'No mutations in any lineage yet', '')
    select.append(none, ...choices.map(m => new Option(MUTATIONS[m].name, m)))
    select.value = this.save.inherited ?? ''
    select.addEventListener('change', () => {
      this.save.inherited = (select.value || null) as MutationId | null
      writeSave(this.save)
    })
    return select
  }

  private buy(id: UnlockId) {
    const u = UNLOCKS[id]
    if (this.save.unlocks.includes(id) || this.save.dna < u.cost) return
    this.save.dna -= u.cost
    this.save.unlocks.push(id)
    writeSave(this.save)
    this.render()
  }
}
