import test from 'node:test'
import assert from 'node:assert/strict'
import { modelRegister, serviceAccessEvents } from '../src/lib/register.ts'
import { feedItems } from '../scripts/feeds.mjs'

test('Kimi service closure remains distinct from routed availability and model retirement', () => {
  const key = 'moonshotai/kimi-k2.6'
  const [notice] = serviceAccessEvents(key)
  assert.equal(notice.date, '2026-10-31')
  assert.match(notice.label, /closed to newly registered users/)
  assert.match(notice.label, /existing users are unaffected by this initial closure/)
  assert.match(notice.label, /end of December 2026; no exact shutdown date/)
  assert.match(notice.label, /does not establish withdrawal of independently hosted routes or public weights/)
  assert.equal(modelRegister[key].lifecycle, undefined)
  assert.deepEqual(serviceAccessEvents('moonshotai/kimi-k3.1-pro'), [])
  assert.deepEqual(serviceAccessEvents('moonshotai/kimi-k3'), [])
  assert.deepEqual(serviceAccessEvents('unreviewed/model'), [])
  assert.match(serviceAccessEvents('moonshotai/kimi-k2.5')[0].label, /31 August 2026/)
  const items = feedItems([], [], { models: { [key]: modelRegister[key] } })
  assert.equal(items.length, 1)
  assert.equal(items[0].kind, 'lifecycle')
  assert.match(items[0].description, /Kimi API access/)
  assert.match(items[0].description, /no exact shutdown date/)
})
