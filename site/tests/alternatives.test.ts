import assert from 'node:assert/strict'
import test from 'node:test'
import { cheaperMatches } from '../src/lib/alternatives.ts'
import type { PriceModel } from '../src/lib/types.ts'

function model(overrides: Partial<PriceModel> = {}): PriceModel {
  return {
    key: 'lab/current',
    display: 'Current',
    provider: 'lab',
    input_mtok: 10,
    output_mtok: 20,
    context: 128_000,
    source: 'firstparty',
    inputModalities: ['image', 'text'],
    outputModalities: ['text'],
    supportsReasoning: true,
    supportsTools: true,
    supportsStructuredOutput: true,
    releaseStage: 'stable',
    ...overrides,
  }
}

test('keeps only stable models that are strictly cheaper and preserve recorded specs', () => {
  const current = model()
  const valid = model({ key: 'other/valid', display: 'Valid', input_mtok: 5, output_mtok: 10, context: 256_000 })
  const candidates = [
    current,
    valid,
    model({ key: 'other/input-only', input_mtok: 5, output_mtok: 20 }),
    model({ key: 'other/smaller-context', input_mtok: 5, output_mtok: 10, context: 64_000 }),
    model({ key: 'other/text-only', input_mtok: 5, output_mtok: 10, inputModalities: ['text'] }),
    model({ key: 'other/no-tools', input_mtok: 5, output_mtok: 10, supportsTools: false }),
    model({ key: 'other/preview', input_mtok: 5, output_mtok: 10, releaseStage: 'preview' }),
  ]

  assert.deepEqual(cheaperMatches(current, candidates).map((match) => match.model.key), ['other/valid'])
})

test('ranks by the guaranteed saving across both token rates and respects the limit', () => {
  const current = model()
  const balanced = model({ key: 'other/balanced', display: 'Balanced', input_mtok: 4, output_mtok: 8 })
  const inputHeavy = model({ key: 'other/input-heavy', display: 'Input Heavy', input_mtok: 1, output_mtok: 12 })
  const modest = model({ key: 'other/modest', display: 'Modest', input_mtok: 6, output_mtok: 14 })

  const matches = cheaperMatches(current, [modest, inputHeavy, balanced], 2)
  assert.deepEqual(matches.map((match) => match.model.key), ['other/balanced', 'other/input-heavy'])
  assert.equal(matches[0].minimumSavingsPct, 60)
  assert.equal(matches[0].inputSavingsPct, 60)
  assert.equal(matches[0].outputSavingsPct, 60)
})

test('does not require capabilities or modalities that are not recorded on the current model', () => {
  const current = model({ inputModalities: undefined, outputModalities: undefined, supportsReasoning: false, supportsTools: false })
  const sparse = model({
    key: 'other/sparse',
    input_mtok: 5,
    output_mtok: 10,
    inputModalities: undefined,
    outputModalities: undefined,
    supportsReasoning: false,
    supportsTools: false,
  })

  assert.deepEqual(cheaperMatches(current, [sparse]).map((match) => match.model.key), ['other/sparse'])
})

test('prefers provider diversity before filling remaining slots by rank', () => {
  const current = model()
  const top = model({ key: 'alpha/top', provider: 'alpha', input_mtok: 1, output_mtok: 2 })
  const secondSameProvider = model({ key: 'alpha/second', provider: 'alpha', input_mtok: 2, output_mtok: 4 })
  const otherProvider = model({ key: 'beta/value', provider: 'beta', input_mtok: 5, output_mtok: 10 })

  assert.deepEqual(
    cheaperMatches(current, [secondSameProvider, otherProvider, top], 3).map((match) => match.model.key),
    ['alpha/top', 'beta/value', 'alpha/second'],
  )
})
