import assert from 'node:assert/strict'
import test from 'node:test'
import { loadFeed } from '../src/lib/data.ts'

const coreFeeds: Record<string, object> = {
  '/data/prices.json': { generatedAt: '2026-08-28T00:00:00Z', asOf: '2026-08-28', models: [] },
  '/data/history.json': { generatedAt: '2026-08-28T00:00:00Z', points: [] },
  '/data/changes.json': { generatedAt: '2026-08-28T00:00:00Z', changes: [] },
  '/data/meta.json': {
    generatedAt: '2026-08-28T00:00:00Z',
    asOf: '2026-08-28',
    modelCount: 0,
    indexValue: 100,
    indexBase: 100,
    indexBaseDate: '2026-08-28',
    indexBaseMean: 1,
    basket: [],
    indexHistory: [],
  },
}

test('loads the large offers feed only when a route requests routed-market data', async (context) => {
  const requested: string[] = []
  const originalFetch = globalThis.fetch
  context.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async (input) => {
    const path = String(input)
    requested.push(path)
    if (path === '/data/offers.json') {
      return new Response(JSON.stringify({
        generatedAt: '2026-08-28T00:00:00Z',
        asOf: '2026-08-28',
        comparisonPolicy: { version: 1 },
        models: [],
      }))
    }
    const payload = coreFeeds[path]
    return payload
      ? new Response(JSON.stringify(payload))
      : new Response('', { status: 404 })
  }

  const ordinaryPage = await loadFeed()
  assert.equal(ordinaryPage.offers, null)
  assert.equal(requested.includes('/data/offers.json'), false)

  requested.length = 0
  const modelCard = await loadFeed(true)
  assert.ok(modelCard.offers)
  assert.equal(requested.includes('/data/offers.json'), true)
})
