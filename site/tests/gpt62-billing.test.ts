import assert from 'node:assert/strict'
import test from 'node:test'
import { validDecisions } from '../src/lib/decisions.ts'
import { quotesFor } from '../src/lib/quotes.ts'
import type { BillingPlan, DecisionsFeed, PriceModel } from '../src/lib/types.ts'

test('Ultrafast changes every meter at midnight Pacific and preserves dated quote links', () => {
  const before = Date.parse('2027-03-01T07:59:59Z')
  const switchAt = '2027-03-01T08:00:00Z'
  const model: PriceModel = {
    key: 'openai/gpt-6.2-sol', display: 'GPT-6.2 Sol', provider: 'openai',
    source: 'firstparty', input_mtok: 2, output_mtok: 10, context: 1050000,
  }
  const plan: BillingPlan = {
    id: 'ultrafast', label: 'Ultrafast', input_mtok: 6, output_mtok: 30,
    cached_input_mtok: .3, cacheWrite30Minute_mtok: 7.5, cacheWrite12Hour_mtok: 15,
    scheduledRates: [{
      effectiveFrom: switchAt, input_mtok: 12, output_mtok: 60,
      cached_input_mtok: .6, cacheWrite30Minute_mtok: 15, cacheWrite12Hour_mtok: 30,
    }],
  }
  const feed: DecisionsFeed = {
    version: 1, asOf: '2027-03-01', generatedAt: new Date(before).toISOString(),
    models: [{key: model.key, billing: {
      verifiedAt: new Date(before).toISOString(), status: 'fresh',
      sourceUrl: 'https://developers.openai.com/api/docs/pricing', plans: [plan],
    }}],
  }
  assert.ok(validDecisions(feed))
  const promo = quotesFor(model, feed, null, before)
  assert.equal(promo.find(q => q.id === 'lab:ultrafast')?.plan.cacheWrite12Hour_mtok, 15)
  const future = promo.find(q => q.id === 'lab:ultrafast-from-' + switchAt)
  assert.equal(future?.source, 'Scheduled lab plan')
  assert.equal(future.plan.cacheWrite30Minute_mtok, 15)
  const active = quotesFor(model, feed, null, before + 1000).filter(q => q.id.startsWith('lab:'))
  assert.equal(active.length, 1)
  assert.equal(active[0].source, 'Published lab plan')
  assert.deepEqual([
    active[0].plan.input_mtok, active[0].plan.output_mtok, active[0].plan.cached_input_mtok,
    active[0].plan.cacheWrite30Minute_mtok, active[0].plan.cacheWrite12Hour_mtok,
  ], [12, 60, .6, 15, 30])
  const invalid = structuredClone(feed)
  invalid.models[0].billing!.plans[0].scheduledRates![0].effectiveFrom = '2027-02-30T08:00:00Z'
  assert.equal(validDecisions(invalid), false)
})
