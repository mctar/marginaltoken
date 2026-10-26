import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decisionFor,
  matchesOpenness,
  validDecisions,
  openShortlist,
  openModels,
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
test('new reviewed open successors propagate by family and order only with exact verified weights', () => {
  const successor={...model,key:'qwen/new-reviewed-27b',provider:'qwen',family:'open-2',identityReviewed:true,selectionOrder:200}
  const d={...feed,models:[{...feed.models[0],key:successor.key}]}
  assert.equal(openShortlist([successor],d)[0]?.key,successor.key)
  assert.equal(openShortlist([{...successor,huggingFaceId:'x/Other'}],d).length,0)
  assert.equal(openShortlist([{...successor,identityReviewed:false}],d).length,0)
})
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
test('preview opt-in preserves verification checks and excludes experimental releases', () => {
  const preview = { ...model, releaseStage: 'preview' as const }
  assert.equal(openModels([preview], feed).length, 0)
  assert.equal(openModels([preview], feed, true).length, 1)
  assert.equal(openModels([model], feed).length, 1)
  assert.equal(openModels([{ ...model, releaseStage: 'experimental' }], feed, true).length, 0)
  assert.equal(openModels([{ ...preview, huggingFaceId: 'x/Other' }], feed, true).length, 0)
  const stale = structuredClone(feed)
  stale.models[0].weights!.status = 'stale'
  assert.equal(openModels([preview], stale, true).length, 0)
  const successor = { ...preview, key: 'qwen/new-preview', provider: 'qwen', family: 'open-2', identityReviewed: true, selectionOrder: 999 }
  const successorFeed = { ...feed, models: [{ ...feed.models[0], key: successor.key }] }
  assert.equal(openModels([successor], successorFeed, true).length, 1)
  assert.equal(openShortlist([successor], successorFeed).length, 0)
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


test('Kimi API successor without downloadable weights leaves K3 on the open shelf', () => {
  const k3: PriceModel={...model,key:'moonshotai/kimi-k3',provider:'moonshotai',huggingFaceId:'moonshotai/Kimi-K3'}
  const pro: PriceModel={...k3,key:'moonshotai/kimi-k3.1-pro',huggingFaceId:undefined,identityReviewed:true,family:'kimi-frontier',selectionOrder:200}
  const d: DecisionsFeed={...feed,models:[{key:k3.key,weights:{...feed.models[0].weights!,repository:k3.huggingFaceId!}}]}
  assert.equal(openShortlist([k3,pro],d).find(m=>m.provider==='moonshotai')?.key,k3.key)
})
