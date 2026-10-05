import { hybridAllowed, PATHS, PATH_BRANCHES, pathForm, type PathId } from './paths'
import { TRAITS, availableTraits, type TraitId } from './traits'
import { MUTATIONS, type MutationId } from './mutations'
import { traitPreview, pathPreview } from './preview'
import './evolution-tree.css'

interface TreeState {
  path: PathId | null
  traits: Set<TraitId>
  mutations: Set<MutationId>
  canChoose: boolean
  progress: string
}
/** Run adaptation tree, distinct from the permanent Tree of Life history. */
export class EvolutionTree {
  private dialog = document.createElement('dialog')
  private selected: PathId = 'pursuer'
  private read: () => TreeState
  private pick: (id: TraitId) => void
  private release: () => void
  get isOpen() {
    return this.dialog.open
  }
  constructor(read: () => TreeState, pick: (id: TraitId) => void, release: () => void) {
    this.read = read
    this.pick = pick
    this.release = release
    this.dialog.id = 'evolution-tree'
    this.dialog.setAttribute('aria-label', 'Evolution tree')
    this.dialog.addEventListener('keydown', e => e.stopPropagation())
    this.dialog.addEventListener('close', () => release())
    const button = document.createElement('button')
    button.id = 'evolution-tree-btn'
    button.textContent = 'evolution tree'
    button.setAttribute('aria-haspopup', 'dialog')
    button.addEventListener('click', () => this.open())
    document.body.append(button, this.dialog)
  }
  open() {
    if (this.isOpen) return
    this.selected = this.read().path ?? 'pursuer'
    this.release()
    this.render()
    this.dialog.showModal()
  }
  private render() {
    const state = this.read()
    this.dialog.replaceChildren()
    const header = document.createElement('header')
    header.innerHTML = '<div><small>PAUSED · EVOLUTION</small><h1>Your evolutionary tree</h1></div>'
    const close = document.createElement('button')
    close.textContent = 'Close · Esc'
    close.onclick = () => this.dialog.close()
    header.append(close)
    this.dialog.append(header)
    const progress = document.createElement('p')
    progress.textContent = state.canChoose
      ? 'Choose any ready adaptation. One selection uses this evolution; minerals remain cumulative progress.'
      : `${state.progress} · Browse your routes. Ready adaptations can be selected when your next evolution arrives.`
    this.dialog.append(progress)
    const nav = document.createElement('nav')
    nav.setAttribute('aria-label', 'Evolution paths')
    for (const path of Object.values(PATHS)) {
      const tab = document.createElement('button')
      tab.textContent = path.name + (state.path === path.id ? ' · your path' : '')
      tab.setAttribute('aria-pressed', String(this.selected === path.id))
      tab.onclick = () => {
        this.selected = path.id
        this.render()
      }
      nav.append(tab)
    }
    this.dialog.append(nav)
    const path = PATHS[this.selected]
    const identity = document.createElement('section')
    identity.className = 'tree-identity'
    const img = document.createElement('img')
    img.src = pathPreview(path.id)
    img.alt = `${path.name} base body`
    const text = document.createElement('div')
    const title = document.createElement('h2')
    title.textContent = state.path === path.id ? pathForm(path.id, state.traits) : path.name
    const detail = document.createElement('p')
    detail.textContent = path.tagline
    const note = document.createElement('p')
    note.textContent =
      state.path && state.path !== path.id
        ? 'Hybrid route: gain these adaptations while keeping your original body lineage.'
        : 'Complete a branch to develop its form. Combine branches to build a hybrid.'
    text.append(title, detail, note)
    identity.append(img, text)
    this.dialog.append(identity)
    const ready = new Set(availableTraits(state.traits, state.mutations, state.path).map(t => t.id))
    const branches = document.createElement('div')
    branches.className = 'tree-branches'
    for (const branch of PATH_BRANCHES[path.id]) {
      const section = document.createElement('section')
      const heading = document.createElement('h3')
      heading.textContent = branch.name
      const strategy = document.createElement('p')
      strategy.textContent = branch.strategy
      section.append(heading, strategy)
      for (const [i, id] of branch.chain.entries()) {
        if (i) {
          const arrow = document.createElement('div')
          arrow.className = 'tree-arrow'
          arrow.textContent = '↓'
          section.append(arrow)
        }
        section.append(this.node(id, state, ready))
      }
      branches.append(section)
    }
    this.dialog.append(branches)
    const shared = document.createElement('section')
    shared.className = 'tree-shared'
    const label = document.createElement('h3')
    label.textContent = 'Shared survival & mutation branches'
    shared.append(label)
    const explanation = document.createElement('p')
    explanation.textContent =
      'These adaptations are available across paths. Porous Membrane branches into a cure or toxic leakage; choosing either closes the other.'
    shared.append(explanation)
    for (const id of [
      'chemoreception',
      'mechanoreception',
      'thermophile',
      'membrane',
      'acidResistance',
      'photosynthesis',
      'pigment',
      'sealed',
      'toxic',
    ] as TraitId[])
      shared.append(this.node(id, state, ready))
    this.dialog.append(shared)
  }
  private node(id: TraitId, state: TreeState, ready: Set<TraitId>) {
    const trait = TRAITS[id]
    const owned = state.traits.has(id)
    const button = document.createElement('button')
    button.className = 'tree-node'
    button.dataset.state = owned ? 'owned' : ready.has(id) ? 'ready' : 'locked'
    const img = document.createElement('img')
    img.src = traitPreview(id, state.traits, state.path ?? this.selected)
    img.alt = ''
    const title = document.createElement('strong')
    title.textContent = trait.name
    const status = document.createElement('small')
    status.textContent = owned ? 'Acquired' : ready.has(id) ? 'Ready' : 'Locked'
    const description = document.createElement('span')
    description.textContent = trait.detail
    const requirements = document.createElement('small')
    const needs = [
      trait.requires ? TRAITS[trait.requires].name : '',
      trait.requiresMutation ? `${MUTATIONS[trait.requiresMutation].name} mutation` : '',
    ].filter(Boolean)
    requirements.textContent = needs.length ? `Requires ${needs.join(' + ')}` : 'No prerequisite adaptation'
    if (!hybridAllowed(state.path, state.traits, id))
      requirements.textContent = 'Hybrid limit: your foreign body system is already chosen.'
    if (id === 'sealed' || id === 'toxic') requirements.textContent += ' · mutually exclusive'
    button.append(img, title, status, description, requirements)
    button.disabled = !state.canChoose || owned || !ready.has(id)
    button.onclick = () => {
      this.dialog.close()
      this.pick(id)
    }
    return button
  }
}
