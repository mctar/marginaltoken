import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SHORTLIST_COLUMNS,
  SHORTLIST_SLOT_COUNT,
  logPricePosition,
  selectShortlist,
} from '../src/lib/shortlist.ts'
import type { PriceModel } from '../src/lib/types.ts'

function model(key: string): PriceModel {
  return {
    key,
    display: key,
    provider: key.split('/')[0],
    input_mtok: 1,
    output_mtok: 10,
    context: 128_000,
    source: 'firstparty',
    releaseStage: 'stable',
  }
}

test('keeps the enterprise shelf bounded at fifteen unique slots', () => {
  const slots = SHORTLIST_COLUMNS.flatMap((column) => column.slots)
  assert.equal(SHORTLIST_SLOT_COUNT, 15)
  assert.equal(new Set(slots.map((slot) => slot.id)).size, 15)
  assert.equal(SHORTLIST_COLUMNS.length, 4)
})

test('selects the first available reviewed successor and falls back safely', () => {
  const columns = selectShortlist([
    model('anthropic/claude-fable-5'),
    model('anthropic/claude-fable-5.1'),
    model('openai/gpt-5.6-sol'),
    model('openai/gpt-6-astra'),
    model('google/gemini-3.6-flash'),
    model('google/gemini-3.8-flash'),
    model('google/gemini-2.5-pro'),
    model('google/gemini-3.1-pro-preview'),
    model('qwen/qwen3-max'),
  ])
  const selections = columns.flatMap((column) => column.selections)
  assert.equal(selections.find((slot) => slot.id === 'anthropic-fable')?.model?.key, 'anthropic/claude-fable-5.1')
  assert.equal(selections.find((slot) => slot.id === 'openai-frontier')?.model?.key, 'openai/gpt-6-astra')
  assert.equal(selections.find((slot) => slot.id === 'google-flash')?.model?.key, 'google/gemini-3.8-flash')
  assert.equal(selections.find((slot) => slot.id === 'google-pro')?.model?.key, 'google/gemini-3.1-pro-preview')
  assert.equal(selections.find((slot) => slot.id === 'qwen-frontier')?.model?.key, 'qwen/qwen3-max')
  assert.equal(selections.find((slot) => slot.id === 'anthropic-opus')?.model, null)
})

test('maps prices consistently onto a base-ten logarithmic axis', () => {
  assert.equal(logPricePosition(0.1), 0)
  assert.ok(Math.abs(logPricePosition(1) - 100 / 3) < 0.000001)
  assert.ok(Math.abs(logPricePosition(10) - 200 / 3) < 0.000001)
  assert.equal(logPricePosition(100), 100)
  assert.equal(logPricePosition(0), 0)
  assert.equal(logPricePosition(1_000), 100)
})
