import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decisionFor,
  matchesOpenness,
  validDecisions,
} from '../src/lib/decisions.ts'
import type { DecisionsFeed, PriceModel } from '../src/lib/types.ts'
const model: PriceModel = {
  key: 'x/model',
  display: 'Model',
  provider: 'x',
  input_mtok: 1,
  output_mtok: 2,
  context: 100000,
  source: 'openrouter',
  huggingFaceId: 'x/Model',
}
const feed: DecisionsFeed = {
  version: 1,
  asOf: '2026-10-12',
  generatedAt: '2026-10-12T00:00:00Z',
  models: [
    {
      key: model.key,
      weights: {
        repository: 'x/Model',
        sourceUrl: 'https://huggingface.co/x/Model',
        licenseUrl: 'https://huggingface.co/x/Model',
        license: 'mit',
        licenseName: 'MIT',
        licenseClass: 'permissive',
        weightsAvailable: true,
        gated: false,
        verifiedAt: new Date().toISOString(),
        status: 'fresh',
      },
    },
  ],
}
test('openness is grounded in a matching repository, never a lab name', () => {
  assert.equal(matchesOpenness(model, 'weights', feed), true)
  assert.equal(matchesOpenness(model, 'permissive', feed), true)
  assert.equal(
    matchesOpenness({ ...model, huggingFaceId: 'x/Other' }, 'weights', feed),
    false,
  )
  assert.equal(
    decisionFor({ ...model, huggingFaceId: 'x/Other' }, feed)?.weights,
    undefined,
  )
  assert.equal(matchesOpenness(model, 'unknown', null), true)
})
test('stale and malformed verification is excluded', () => {
  const stale = structuredClone(feed)
  stale.models[0].weights!.status = 'stale'
  assert.equal(matchesOpenness(model, 'weights', stale), false)
  assert.equal(validDecisions(feed), true)
  assert.equal(
    validDecisions({
      ...feed,
      models: [
        {
          key: 'x/model',
          billing: {
            plans: [{ id: 'a', label: 'a', input_mtok: -1, output_mtok: 1 }],
            sourceUrl: 'https://example.com',
            status: 'fresh',
          },
        },
      ],
    }),
    false,
  )
})

test('invalid optional feed rows fail validation without crashing the publication', () => {
  assert.equal(validDecisions({...feed,models:[null]}),false)
  assert.equal(validDecisions({...feed,models:[{key:'x/model',billing:{verifiedAt:'2026-10-12',sourceUrl:'https://example.com',status:'fresh',plans:[null]}}]}),false)
})
