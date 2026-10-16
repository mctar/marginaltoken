import assert from 'node:assert/strict'
import test from 'node:test'
import { quotesFor } from '../src/lib/quotes.ts'
import { calculateBill, defaultAssumptions, parseAssumptions } from '../src/lib/economics.ts'
import type { DecisionsFeed, PriceModel } from '../src/lib/types.ts'

const now = Date.parse('2026-10-16T06:00:00Z')
const model: PriceModel = { key: 'anthropic/claude-opus-5.5', display: 'Claude Opus 5.5', provider: 'anthropic', source: 'firstparty', verificationStatus: 'fresh', input_mtok: 4, output_mtok: 20, context: 1000000 }
const feed: DecisionsFeed = {
  version: 1, asOf: '2026-10-16', generatedAt: new Date(now).toISOString(),
  models: [{ key: model.key, billing: {
    verifiedAt: new Date(now).toISOString(), status: 'fresh', sourceUrl: 'https://platform.claude.com/docs/en/about-claude/pricing',
    plans: [
      { id: 'standard', label: 'Standard', input_mtok: 4, output_mtok: 20, cached_input_mtok: .2, cache_write_mtok: 5, cacheWriteHour_mtok: 8 },
      { id: 'batch', label: 'Batch', input_mtok: 2, output_mtok: 10, cached_input_mtok: .1, cache_write_mtok: 2.5, cacheWriteHour_mtok: 4 },
      { id: 'fast', label: 'Fast', input_mtok: 8, output_mtok: 40, cached_input_mtok: .4, cache_write_mtok: 10, cacheWriteHour_mtok: 16 },
    ],
  } }],
}
const workload = { calls: 10000, inputTokens: 2000, outputTokens: 500, reasoningTokens: 0, cacheReadPct: 0, cacheWritePct: 0, reviewHourly: 50 }

test('Fast is opt-in and preserves Standard and Batch bills and shareable selection', () => {
  const quotes = quotesFor(model, feed, null, now)
  assert.deepEqual(quotes.map(q => q.id), ['tape', 'lab:standard', 'lab:batch', 'lab:fast'])
  assert.equal(defaultAssumptions.quote, 'tape')
  const totals = quotes.map(q => calculateBill(q.plan, workload, defaultAssumptions).monthlyTotal)
  totals.forEach((total, i) => assert.ok(Math.abs(total - [180, 180, 90, 360][i]) < 1e-9))
  const share = new URLSearchParams({ assumptions: JSON.stringify({ [model.key]: { quote: 'lab:fast' } }) })
  assert.equal(parseAssumptions(share.get('assumptions'))[model.key].quote, 'lab:fast')
})

test('Fast charges the selected cache duration and never combines with Batch discounts', () => {
  const fast = quotesFor(model, feed, null, now).find(q => q.id === 'lab:fast')!.plan
  const cached = { ...workload, cacheReadPct: 60, cacheWritePct: 20 }
  const fiveMinutes = calculateBill(fast, cached, defaultAssumptions)
  const oneHour = calculateBill(fast, cached, { ...defaultAssumptions, cacheDuration: '1h' })
  assert.equal(fiveMinutes.complete, true)
  assert.ok(Math.abs(fiveMinutes.monthlyTotal - 276.8) < 1e-9)
  assert.ok(Math.abs(oneHour.monthlyTotal - 300.8) < 1e-9)
  assert.equal(quotesFor(model, feed, null, now + 8 * 86400000).some(q => q.id === 'lab:fast'), false)
})
