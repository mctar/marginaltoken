import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyRateOverrides,
  attemptEconomics,
  billComparisonPath,
  calculateBill,
  defaultAssumptions,
  parseAssumptions,
  type BillWorkload,
} from '../src/lib/economics.ts'
const workload: BillWorkload = {
  calls: 1000,
  inputTokens: 10000,
  outputTokens: 1000,
  reasoningTokens: 500,
  cacheReadPct: 50,
  cacheWritePct: 10,
  reviewHourly: 60,
}
const plan = {
  id: 'standard',
  label: 'Standard',
  input_mtok: 2,
  output_mtok: 10,
  cached_input_mtok: 0.2,
  cache_write_mtok: 2.5,
}
const close = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`)

test('cache read, write, uncached input and additional reasoning are billed exactly once', () => {
  const bill = calculateBill(plan, workload, defaultAssumptions)
  assert.equal(bill.complete, true)
  close(bill.monthlyInput, 11.5)
  close(bill.monthlyOutput, 15)
  close(bill.monthlyTotal, 26.5)
})
test('missing cache rates and incompatible context make the bill incomplete', () => {
  assert.equal(
    calculateBill(
      { ...plan, cached_input_mtok: undefined },
      workload,
      defaultAssumptions,
    ).complete,
    false,
  )
  assert.equal(
    calculateBill(plan, { ...workload, cacheReadPct: 95 }, defaultAssumptions)
      .complete,
    false,
  )
  assert.equal(
    calculateBill(
      { ...plan, maximumPromptTokens: 9999 },
      workload,
      defaultAssumptions,
    ).complete,
    false,
  )
  assert.equal(
    calculateBill(plan, workload, {
      ...defaultAssumptions,
      cacheDuration: '1h',
    }).complete,
    false,
  )
})
test('bounded retries charge failures and review while leaving terminal failures in the denominator', () => {
  const bill = calculateBill(
    plan,
    workload,
    {
      ...defaultAssumptions,
      successPct: '50',
      maxAttempts: '2',
      reviewPct: '100',
      reviewMinutes: '1',
    },
    true,
  )
  close(bill.attempts, 1500)
  close(bill.acceptedTasks!, 750)
  close(bill.monthlyApi, 39.75)
  close(bill.monthlyReview, 1500)
  close(bill.costPerSuccess!, 1539.75 / 750)
})
test('zero, certain, missing, and tiny success rates remain numerically stable', () => {
  assert.deepEqual(attemptEconomics(0, 3), { attempts: 3, accepted: 0 })
  assert.deepEqual(attemptEconomics(100, 3), { attempts: 1, accepted: 1 })
  const bill = calculateBill(
    plan,
    workload,
    { ...defaultAssumptions, successPct: '0', maxAttempts: '3' },
    true,
  )
  assert.equal(bill.costPerSuccess, null)
  assert.equal(bill.complete, true)
  assert.equal(
    calculateBill(plan, workload, defaultAssumptions, true).complete,
    false,
  )
  close(attemptEconomics(0.00000001, 3).attempts, 3)
})
test('storage is charged once per month and manual zero rates are preserved', () => {
  const assumptions = {
    ...defaultAssumptions,
    storageMillionTokenHours: '2',
    successPct: '50',
    maxAttempts: '2',
    cachedInputRate: '0',
    cacheStorageRate: '4',
  }
  const adjusted = applyRateOverrides(plan, assumptions)
  assert.equal(adjusted.cached_input_mtok, 0)
  close(calculateBill(adjusted, workload, assumptions, true).monthlyStorage, 8)
})
test('scenario URL round trips model-specific success and rate assumptions without keeping removed models', () => {
  const a = {
    ...defaultAssumptions,
    quote: 'lab:batch',
    successPct: '87.5',
    maxAttempts: '3',
    inputRate: '0.2',
  }
  const path = billComparisonPath(
    ['x/model'],
    workload,
    { 'x/model': a, 'gone/model': defaultAssumptions },
    true,
  )
  const params = new URL(path, 'https://marginaltoken.com').searchParams
  assert.deepEqual(
    { ...parseAssumptions(params.get('assumptions')) },
    { 'x/model': a },
  )
  assert.equal(params.get('outcomes'), '1')
  assert.equal(params.get('cache_read'), '50')
  assert.deepEqual(parseAssumptions('null'), {})
  assert.deepEqual(
    parseAssumptions('{"x/model":{"successPct":"no"}}')['x/model'].successPct,
    '',
  )
})
