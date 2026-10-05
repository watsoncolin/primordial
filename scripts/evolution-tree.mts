import assert from 'node:assert/strict'
import { PATHS, PATH_BRANCHES, pathForm } from '../src/paths.ts'
import { TRAITS, availableTraits, type TraitId } from '../src/traits.ts'
import type { MutationId } from '../src/mutations.ts'

// Every advertised branch names real traits and can be completed with its stated mutations.
for (const path of Object.values(PATHS)) {
  for (const branch of PATH_BRANCHES[path.id]) {
    const traits = new Set<TraitId>([path.starter])
    const mutations = new Set<MutationId>(['hollowSpines', 'porous'])
    for (const id of branch.chain) {
      assert(TRAITS[id], `Unknown branch adaptation ${id}`)
      if (!traits.has(id)) {
        assert(
          availableTraits(traits, mutations).some(t => t.id === id),
          `${branch.name}: inaccessible ${id}`,
        )
        traits.add(id)
      }
    }
    assert.notEqual(pathForm(path.id, traits), path.name, 'Completed branch should have a developed form name')
  }
}
const armor = new Set<TraitId>(['membrane'])
assert(availableTraits(armor, new Set()).some(t => t.id === 'spikes'))
assert(!availableTraits(new Set([...armor, 'spikes']), new Set()).some(t => t.id === 'venom'))
assert(availableTraits(new Set([...armor, 'spikes']), new Set(['hollowSpines'])).some(t => t.id === 'venom'))
assert(!availableTraits(new Set(['sealed']), new Set(['porous'])).some(t => t.id === 'toxic'))
assert(!availableTraits(new Set(['toxic']), new Set(['porous'])).some(t => t.id === 'sealed'))
console.log(
  'Passed: 12 reachable branches, developed form names, venom prerequisites, and exclusive mutation branches.',
)
