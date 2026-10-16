import test from 'node:test'
import assert from 'node:assert/strict'
import { marketNotes, marketNoteCalculatorPath } from '../src/lib/market-notes.ts'
import { openModels, openShortlist } from '../src/lib/decisions.ts'
import { feedItems } from '../scripts/feeds.mjs'
import type { PriceModel, DecisionsFeed } from '../src/lib/types.ts'

const key = 'nvidia/nemotron-3.5-super-vl'
const repository = 'nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-BF16'

test('Super VL is visible only with current exact weights verification and gains no curated slot', () => {
  const model: PriceModel = { key, provider: 'nvidia', display: 'Nemotron 3.5 Super VL', source: 'openrouter', input_mtok: .15, output_mtok: .5, context: 1048576, releaseStage: 'stable', huggingFaceId: repository }
  const feed: DecisionsFeed = { version: 1, generatedAt: new Date().toISOString(), asOf: '2026-10-16', models: [{ key, weights: {
    repository, sourceUrl: `https://huggingface.co/${repository}`, licenseUrl: `https://huggingface.co/${repository}`, license: 'other', licenseName: 'openmdw-1.1', licenseClass: 'custom', weightsAvailable: true, gated: false, status: 'fresh', verifiedAt: new Date().toISOString(),
  } }] }
  assert.deepEqual(openModels([model], feed), [model])
  assert.deepEqual(openModels([{ ...model, huggingFaceId: 'nvidia/NVIDIA-Nemotron-3.5-Super-VL' }], feed), [])
  assert.deepEqual(openModels([model], null), [])
  assert.deepEqual(openShortlist([model], feed), [])
})

test('the local-cost note selects Super VL custom deployment without importing Bolt hardware assumptions', () => {
  const note = marketNotes.find(n => n.slug === 'nemotron-super-vl-bolt-packs-light')!
  const url = new URL(marketNoteCalculatorPath(note), 'https://marginaltoken.com')
  assert.equal(url.pathname, '/infrastructure/')
  assert.equal(url.searchParams.get('mode'), 'custom')
  assert.equal(url.searchParams.get('model'), key)
  assert.equal(url.searchParams.get('quote'), 'tape')
  for (const name of ['weightsGB', 'gpuMemoryGB', 'throughput']) assert.equal(url.searchParams.has(name), false)
  assert.deepEqual(feedItems([note], [], { models: {} })[0].keys, [key])
})

test('existing API comparison notes retain their model pair and explicit plan selections', () => {
  const note = marketNotes.find(n => n.slug === 'muse-spark-open-rider')!
  const url = new URL(marketNoteCalculatorPath(note), 'https://marginaltoken.com')
  assert.equal(url.pathname, '/compare/')
  assert.deepEqual(url.searchParams.getAll('model'), ['meta/muse-spark-open', 'openai/gpt-6.1-sol'])
  assert.deepEqual(JSON.parse(url.searchParams.get('assumptions')!), { 'meta/muse-spark-open': { quote: 'tape' }, 'openai/gpt-6.1-sol': { quote: 'lab:standard' } })
})
