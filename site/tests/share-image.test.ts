import assert from 'node:assert/strict'
import test from 'node:test'
import {
  shareImageFilename,
  shareSourceLabel,
} from '../src/lib/share.ts'

test('creates bounded portable PNG filenames', () => {
  assert.equal(shareImageFilename('Claude Opus 5 / pricing'), 'marginal-token-claude-opus-5-pricing.png')
  assert.equal(shareImageFilename('   '), 'marginal-token-share.png')
  assert.ok(shareImageFilename('x'.repeat(200)).length < 110)
})

test('labels price provenance explicitly', () => {
  assert.equal(shareSourceLabel({ source: 'firstparty' }), 'First-party pricing')
  assert.equal(shareSourceLabel({ source: 'openrouter' }), 'OpenRouter routed listing')
})
