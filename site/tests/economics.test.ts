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

test('OpenAI cache retention rates are not substituted for 5m or 1h writes', () => {
  const p = { ...plan, cache_write_mtok: undefined, cacheWrite30Minute_mtok: 2.5, cacheWrite12Hour_mtok: 5 }
  const w = { ...workload, calls: 1, inputTokens: 1000000, outputTokens: 0, reasoningTokens: 0, cacheReadPct: 0, cacheWritePct: 100 }
  for (const duration of ['5m', '1h']) assert.equal(calculateBill(p, w, {...defaultAssumptions, cacheDuration:duration}).complete, false)
  for (const [duration, rate] of [['30m',2.5], ['12h',5]] as const) {
    const a = {...defaultAssumptions, cacheDuration:duration}
    const result = calculateBill(p, w, a)
    assert.equal(result.complete, true)
    close(result.monthlyTotal, rate)
    const custom = {...a, cacheWriteRate:'7'}
    close(calculateBill(applyRateOverrides(p,custom),w,custom).monthlyTotal,7)
  }
})


test('Kimi cache writes replace input for that fraction, and TTLs have separate prices', () => {
  const kimi = {id:'standard',label:'Standard',input_mtok:2,output_mtok:10,cached_input_mtok:.2,cache_write_mtok:2,cacheWriteHour_mtok:4}
  const w = {...workload,calls:1,inputTokens:1000000,outputTokens:0,reasoningTokens:0,cacheReadPct:50,cacheWritePct:50}
  const five = calculateBill(kimi,w,defaultAssumptions)
  const hour = calculateBill(kimi,w,{...defaultAssumptions,cacheDuration:'1h'})
  assert.equal(five.complete,true)
  assert.equal(hour.complete,true)
  close(five.monthlyTotal,1.1)
  close(hour.monthlyTotal,2.1)
  // A full initial write has the normal miss cost at the default 5m TTL.
  close(calculateBill(kimi,{...w,cacheReadPct:0,cacheWritePct:100},defaultAssumptions).monthlyTotal,2)
})


test('Terra changes the full-request rate above 272K and keeps retention rates distinct', () => {
  const standard = { id: 'standard', label: 'Standard', input_mtok: 1, output_mtok: 5,
    cached_input_mtok: .05, cacheWrite30Minute_mtok: 1.25, cacheWrite12Hour_mtok: 2.5,
    maximumPromptTokens: 272000 }
  const long = { ...standard, id: 'standard-long-context', input_mtok: 2, output_mtok: 7.5,
    cacheWrite30Minute_mtok: 2.5, cacheWrite12Hour_mtok: 5,
    maximumPromptTokens: undefined, minimumPromptTokens: 272001 }
  const request = { ...workload, calls: 1, inputTokens: 272000, outputTokens: 1000,
    reasoningTokens: 0, cacheReadPct: 0, cacheWritePct: 0 }
  close(calculateBill(standard, request, defaultAssumptions).monthlyTotal, .277)
  const over = { ...request, inputTokens: 272001 }
  assert.equal(calculateBill(standard, over, defaultAssumptions).complete, false)
  assert.equal(calculateBill(long, request, defaultAssumptions).complete, false)
  close(calculateBill(long, over, defaultAssumptions).monthlyTotal, .551502)
  const writes = { ...over, inputTokens: 300000, cacheWritePct: 100 }
  close(calculateBill(long, writes, { ...defaultAssumptions, cacheDuration: '12h' }).monthlyTotal, 1.5075)
  close(calculateBill(long, writes, { ...defaultAssumptions, cacheDuration: '30m' }).monthlyTotal, .7575)
})
