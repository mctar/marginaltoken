import assert from 'node:assert/strict'
import test from 'node:test'
import { datedBillingPlans, quotesFor } from '../src/lib/quotes.ts'
import { calculateBill, defaultAssumptions } from '../src/lib/economics.ts'
import { quoteBill } from '../src/lib/planning.ts'
import { validDecisions } from '../src/lib/decisions.ts'
import { selectShortlist } from '../src/lib/shortlist.ts'
import type {
  BillingPlan,
  DecisionsFeed,
  PriceModel,
} from '../src/lib/types.ts'

const plan: BillingPlan = {
  id: 'standard',
  label: 'Standard',
  input_mtok: 2,
  output_mtok: 10,
  cached_input_mtok: 0.1,
  validThrough: '2026-11-30',
  scheduledRates: [
    {
      effectiveFrom: '2026-12-01',
      input_mtok: 4,
      output_mtok: 20,
      cached_input_mtok: 0.2,
    },
  ],
  cacheMode: 'implicit',
  minimumCachePromptTokens: 4096,
  contextWindowTokens: 1048576,
  maximumOutputTokens: 65536,
}
const model: PriceModel = {
  key: 'google/gemini-4-argon',
  provider: 'google',
  display: 'Gemini 4 Argon',
  source: 'firstparty',
  verificationStatus: 'fresh',
  input_mtok: 2,
  output_mtok: 10,
  context: 1048576,
}
const now = Date.parse('2026-11-30T23:59:59Z')
const feed: DecisionsFeed = {
  version: 1,
  asOf: '2026-11-30',
  generatedAt: new Date(now).toISOString(),
  models: [
    {
      key: model.key,
      billing: {
        plans: [plan],
        sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
        status: 'fresh',
        verifiedAt: new Date(now).toISOString(),
      },
    },
  ],
}
const workload = {
  calls: 10000,
  inputTokens: 2000,
  outputTokens: 500,
  reasoningTokens: 0,
  cacheReadPct: 0,
  cacheWritePct: 0,
  reviewHourly: 50,
}

test('future prices are selectable and labelled, while the current quote rolls exactly at the effective date', () => {
  const before = quotesFor(model, feed, null, now)
  const current = before.find((q) => q.id === 'lab:standard')!
  const future = before.find((q) => q.id === 'lab:standard-from-2026-12-01')!
  assert.match(current.plan.label, /through 2026-11-30/)
  assert.ok(
    Math.abs(
      calculateBill(current.plan, workload, defaultAssumptions).monthlyTotal -
        90,
    ) < 1e-9,
  )
  assert.ok(
    Math.abs(
      calculateBill(future.plan, workload, defaultAssumptions).monthlyTotal -
        180,
    ) < 1e-9,
  )
  assert.equal(future.source, 'Scheduled lab plan')
  const after = quotesFor(
    { ...model, input_mtok: 4, output_mtok: 20 },
    feed,
    null,
    now + 1000,
  )
  assert.equal(after.find((q) => q.id === 'lab:standard')!.plan.input_mtok, 4)
  assert.equal(
    after.find((q) => q.id === 'lab:standard')!.plan.cached_input_mtok,
    0.2,
  )
  assert.equal(after.filter((q) => q.id.startsWith('lab:')).length, 1)
  assert.equal(plan.input_mtok, 2) // Resolving dates never mutates the cached feed.
})

test('expired prices with no successor are omitted and stale evidence cannot enable future quotes', () => {
  assert.equal(
    datedBillingPlans([{ ...plan, scheduledRates: undefined }], now + 1000)
      .length,
    0,
  )
  const old = structuredClone(feed)
  old.models[0].billing!.verifiedAt = '2026-11-01T00:00:00Z'
  assert.deepEqual(
    quotesFor(model, old, null, now).map((q) => q.id),
    ['tape'],
  )
})

test('implicit cache constraints apply even when the user supplies write and storage prices', () => {
  const input = { ...workload, inputTokens: 4096, cacheReadPct: 50 }
  assert.equal(calculateBill(plan, input, defaultAssumptions).complete, true)
  assert.equal(
    calculateBill(plan, { ...input, inputTokens: 4095 }, defaultAssumptions)
      .complete,
    false,
  )
  const writes = calculateBill(
    { ...plan, cache_write_mtok: 1 },
    { ...input, cacheWritePct: 10 },
    defaultAssumptions,
  )
  assert.ok(writes.problems.some((p) => p.includes('explicit cache writes')))
  const storage = calculateBill(
    { ...plan, cache_storage_mtok_hour: 0 },
    input,
    { ...defaultAssumptions, storageMillionTokenHours: '1' },
  )
  assert.equal(storage.complete, false)
})

test('Argon lab quotes enforce the shared context and synchronous output limits independently of router metadata', () => {
  const quote = quotesFor(model, feed, null, now).find(
    (q) => q.id === 'lab:standard',
  )!
  assert.equal(quote.maxOutput, 65536)
  assert.equal(
    quoteBill(model, quote, { ...workload, outputTokens: 65536 }).complete,
    true,
  )
  assert.equal(
    quoteBill(model, quote, {
      ...workload,
      outputTokens: 65536,
      reasoningTokens: 1,
    }).complete,
    false,
  )
  assert.equal(
    quoteBill(model, quote, { ...workload, inputTokens: 1048576 }).complete,
    false,
  )
})

test('malformed scheduled billing is rejected', () => {
  assert.equal(validDecisions(feed), true)
  for (const mutate of [
    (p: BillingPlan) => {
      p.scheduledRates![0].input_mtok = -1
    },
    (p: BillingPlan) => {
      p.scheduledRates![0].effectiveFrom = '2026-02-30'
    },
    (p: BillingPlan) => {
      p.scheduledRates!.push({ ...p.scheduledRates![0] })
    },
  ]) {
    const bad = structuredClone(feed)
    mutate(bad.models[0].billing!.plans[0])
    assert.equal(validDecisions(bad), false)
  }
})

test('reviewed Argon and Qwen slots update even before old selected-slot metadata refreshes', () => {
  const oldQwen = {
    ...model,
    key: 'qwen/qwen3.7-max',
    provider: 'qwen',
    source: 'openrouter' as const,
    selectedSlots: ['qwen-frontier'],
    selectionOrder: 100,
  }
  const qwen = {
    ...oldQwen,
    key: 'qwen/qwen3.8-max-0902',
    selectedSlots: undefined,
    selectionOrder: undefined,
  }
  const pro = {
    ...model,
    key: 'google/gemini-3.1-pro-preview',
    selectedSlots: ['google-pro'],
    selectionOrder: 100,
  }
  const slots = selectShortlist([oldQwen, qwen, pro, model]).flatMap(
    (c) => c.selections,
  )
  assert.equal(
    slots.find((s) => s.id === 'google-argon')?.model?.key,
    model.key,
  )
  assert.equal(
    slots.find((s) => s.id === 'qwen-frontier')?.model?.key,
    qwen.key,
  )
  assert.equal(slots.length, 15)
})
