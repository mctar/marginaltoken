import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateCost, comparisonPath, nonNegativeNumber } from '../src/lib/compare.ts'

test('calculates per-request and monthly model cost', () => {
  const result = calculateCost(
    { input_mtok: 2.5, output_mtok: 15 },
    { calls: 10_000, inputTokens: 2_000, outputTokens: 500 },
  )
  assert.equal(result.inputPerRequest, 0.005)
  assert.equal(result.outputPerRequest, 0.0075)
  assert.equal(result.totalPerRequest, 0.0125)
  assert.equal(result.monthlyInput, 50)
  assert.equal(result.monthlyOutput, 75)
  assert.equal(result.monthlyTotal, 125)
})

test('clamps invalid workload values to zero', () => {
  assert.equal(nonNegativeNumber('-5'), 0)
  assert.equal(nonNegativeNumber('not-a-number'), 0)
  assert.equal(nonNegativeNumber('2.5'), 2.5)
})

test('builds a bounded, shareable comparison URL', () => {
  const path = comparisonPath(
    ['anthropic/opus', 'openai/sol', 'anthropic/opus', 'google/gemini', 'x-ai/grok', 'deepseek/v4'],
    { calls: 1_000, inputTokens: 1_500, outputTokens: 250 },
  )
  const url = new URL(path, 'https://marginaltoken.com')
  assert.deepEqual(url.searchParams.getAll('model'), [
    'anthropic/opus',
    'openai/sol',
    'google/gemini',
    'x-ai/grok',
  ])
  assert.equal(url.searchParams.get('calls'), '1000')
  assert.equal(url.searchParams.get('input'), '1500')
  assert.equal(url.searchParams.get('output'), '250')
})
