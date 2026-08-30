import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateInfrastructure,
  infrastructurePath,
  monthlyQuote,
  selectQuote,
  type InfrastructureAssumptions,
} from '../src/lib/infrastructure.ts'
import type { PriceModel } from '../src/lib/types.ts'

const model: PriceModel = {
  key: 'openai/gpt-oss-20b',
  display: 'gpt-oss-20b',
  provider: 'openai',
  input_mtok: 1,
  output_mtok: 2,
  context: 128_000,
  source: 'openrouter',
}

const assumptions: InfrastructureAssumptions = {
  inputMillions: 1_000,
  outputMillions: 100,
  gpuHourly: 2,
  gpusPerReplica: 1,
  outputTokensPerSecond: 100,
  utilizationPct: 50,
  licensePerGpuYear: 1_200,
}

test('costs API tokens in displayed millions', () => {
  assert.equal(monthlyQuote(1, 2, 1_000, 100), 1_200)
})

test('interpolates the median for an even route set', () => {
  const quote = selectQuote([
    { label: 'A', monthly: 10, input_mtok: 1, output_mtok: 2 },
    { label: 'B', monthly: 20, input_mtok: 3, output_mtok: 4 },
  ], 'median', model, assumptions)
  assert.equal(quote.label, 'Median of 2 posted routes')
  assert.equal(quote.monthly, 15)
  assert.equal(quote.input_mtok, 2)
  assert.equal(quote.output_mtok, 3)
})

test('calculates deployment capacity and rejects a break-even beyond capacity', () => {
  const result = calculateInfrastructure(model, null, 'tape', assumptions)
  assert.equal(result.apiMonthly, 1_200)
  assert.equal(result.costPerReplica, 1_560)
  assert.equal(result.replicas, 1)
  assert.equal(result.outputCapacityPerReplica, 131.4)
  assert.equal(result.breakEvenWithinCapacity, true)

  const constrained = calculateInfrastructure(model, null, 'tape', {
    ...assumptions,
    outputTokensPerSecond: 1,
  })
  assert.equal(constrained.breakEvenWithinCapacity, false)
  assert.equal(constrained.replicas, 77)
})

test('serializes every planning assumption into a shareable URL', () => {
  const path = infrastructurePath(model.key, 'median', assumptions)
  const url = new URL(path, 'https://marginaltoken.com')
  assert.equal(url.pathname, '/infrastructure/')
  assert.equal(url.searchParams.get('model'), model.key)
  assert.equal(url.searchParams.get('basis'), 'median')
  assert.equal(url.searchParams.get('throughput'), '100')
  assert.equal(url.searchParams.get('license'), '1200')
})
