import assert from 'node:assert/strict'
import test from 'node:test'
import { quotesFor } from '../src/lib/quotes.ts'
import { calculateBill, defaultAssumptions } from '../src/lib/economics.ts'
import type { DecisionsFeed, PriceModel } from '../src/lib/types.ts'

const now = Date.parse('2026-10-29T09:00:00Z')
const model: PriceModel = { key: 'particle-ai/particle-1', provider: 'particle-ai', display: 'Particle-1', source: 'openrouter', input_mtok: .25, output_mtok: 1, context: 1048576 }
const feed: DecisionsFeed = { version: 1, generatedAt: new Date(now).toISOString(), asOf: '2026-10-29', models: [{ key: model.key, billing: {
  sourceUrl: 'https://docs.particle.ai/usage-billing', verifiedAt: new Date(now).toISOString(), status: 'fresh', plans: [
    { id: 'standard', label: 'Direct peak', input_mtok: .25, cached_input_mtok: .03, output_mtok: 1 },
    { id: 'off-peak', label: 'Direct off-peak', input_mtok: .125, cached_input_mtok: .015, output_mtok: .5 },
    { id: 'flex', label: 'Direct peak · Flex', input_mtok: .125, cached_input_mtok: .015, output_mtok: .5 },
    { id: 'off-peak-flex', label: 'Direct off-peak · Flex', input_mtok: .0625, cached_input_mtok: .0075, output_mtok: .25 },
  ],
} }] }
const workload = { calls: 1000, inputTokens: 10000, outputTokens: 1000, reasoningTokens: 500, cacheReadPct: 50, cacheWritePct: 0, reviewHourly: 50 }

test('Particle direct discounts remain explicit alternatives to the routed Tape quote', () => {
  const quotes = quotesFor(model, feed, null, now)
  assert.deepEqual(quotes.map(q => q.id), ['tape','lab:standard','lab:off-peak','lab:flex','lab:off-peak-flex'])
  assert.equal(quotes[0].source, 'OpenRouter tape')
  assert.equal(quotes[0].plan.cached_input_mtok, undefined)
  assert.equal(defaultAssumptions.quote, 'tape')
  for (const q of quotes.slice(1)) assert.equal(q.sourceUrl, 'https://docs.particle.ai/usage-billing')
  // Crossing New York's time window never silently changes a stored plan.
  assert.equal(quotesFor(model, feed, null, now + 10 * 3600000)[1].plan.input_mtok, .25)
  assert.equal(quotesFor(model, feed, null, now + 8 * 86400000).length, 1)
})

test('Particle cache and total output cost halve and quarter without double counting reasoning', () => {
  const quotes = quotesFor(model, feed, null, now).slice(1)
  const totals = quotes.map(q => calculateBill(q.plan, workload, defaultAssumptions))
  totals.forEach((bill, i) => {
    assert.equal(bill.complete, true)
    assert.ok(Math.abs(bill.monthlyTotal - [2.9,1.45,1.45,.725][i]) < 1e-9)
  })
  // 1500 total output tokens means 1000 answer + 500 reasoning, or 1500 total + zero extra.
  const same = calculateBill(quotes[0].plan, { ...workload, outputTokens: 1500, reasoningTokens: 0 }, defaultAssumptions)
  assert.equal(same.monthlyTotal, totals[0].monthlyTotal)
})
