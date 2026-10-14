import { nonNegativeNumber, type Workload } from './compare.ts'
import type { BillingPlan } from './types'

export type BillWorkload = Workload & {
  reasoningTokens: number
  cacheReadPct: number
  cacheWritePct: number
  reviewHourly: number
}
export type ModelAssumptions = {
  quote: string
  inputRate: string
  outputRate: string
  cachedInputRate: string
  cacheWriteRate: string
  cacheStorageRate: string
  reasoningRate: string
  tokenMultiplier: string
  outputMultiplier: string
  reasoningTokens: string
  cacheDuration: string
  storageMillionTokenHours: string
  rateMultiplier: string
  successPct: string
  maxAttempts: string
  reviewPct: string
  reviewMinutes: string
  extraPerAttempt: string
}
export const defaultAssumptions: ModelAssumptions = {
  quote: 'tape',
  inputRate: '',
  outputRate: '',
  cachedInputRate: '',
  cacheWriteRate: '',
  cacheStorageRate: '',
  reasoningRate: '',
  tokenMultiplier: '1',
  outputMultiplier: '1',
  reasoningTokens: '',
  cacheDuration: '5m',
  storageMillionTokenHours: '0',
  rateMultiplier: '1',
  successPct: '',
  maxAttempts: '1',
  reviewPct: '0',
  reviewMinutes: '0',
  extraPerAttempt: '0',
}
export const workloadPresets = [
  {
    id: 'custom',
    label: 'Custom workload',
    inputTokens: 2000,
    outputTokens: 500,
    reasoningTokens: 0,
    cacheReadPct: 0,
  },
  {
    id: 'extraction',
    label: 'Document extraction',
    inputTokens: 8000,
    outputTokens: 500,
    reasoningTokens: 0,
    cacheReadPct: 0,
  },
  {
    id: 'support',
    label: 'Customer support',
    inputTokens: 4000,
    outputTokens: 600,
    reasoningTokens: 0,
    cacheReadPct: 50,
  },
  {
    id: 'coding',
    label: 'Coding assistant',
    inputTokens: 16000,
    outputTokens: 2000,
    reasoningTokens: 4000,
    cacheReadPct: 50,
  },
  {
    id: 'research',
    label: 'Research agent',
    inputTokens: 24000,
    outputTokens: 3000,
    reasoningTokens: 6000,
    cacheReadPct: 25,
  },
] as const
export function percent(n: string | number): number {
  return Math.min(100, nonNegativeNumber(n))
}
export function optionalNumber(n: string): number | null {
  return n.trim() && Number.isFinite(Number(n)) && Number(n) >= 0
    ? Number(n)
    : null
}
export function attemptEconomics(successPct: number, maxAttempts: number) {
  const p = percent(successPct) / 100
  const limit = Math.max(
    1,
    Math.min(10, Math.floor(nonNegativeNumber(maxAttempts))),
  )
  const accepted = p === 1 ? 1 : -Math.expm1(limit * Math.log1p(-p))
  const attempts = p === 0 ? limit : accepted / p
  return { attempts, accepted }
}
export function calculateBill(
  plan: BillingPlan,
  workload: BillWorkload,
  assumption: ModelAssumptions,
  outcomes = false,
) {
  const input =
    nonNegativeNumber(workload.inputTokens) *
    nonNegativeNumber(assumption.tokenMultiplier)
  const output =
    nonNegativeNumber(workload.outputTokens) *
    nonNegativeNumber(assumption.outputMultiplier)
  const reasoning =
    optionalNumber(assumption.reasoningTokens) ??
    nonNegativeNumber(workload.reasoningTokens)
  const readFraction = percent(workload.cacheReadPct) / 100,
    writeFraction = percent(workload.cacheWritePct) / 100
  const problems: string[] = []
  if (readFraction + writeFraction > 1 + 1e-12)
    problems.push('Cache reads and writes must total at most 100% of input.')
  if (
    plan.cacheMode === 'implicit' &&
    (writeFraction > 0 ||
      nonNegativeNumber(assumption.storageMillionTokenHours) > 0)
  )
    problems.push(
      'This plan supports implicit cache hits only; explicit cache writes and storage are unsupported.',
    )
  if (
    readFraction > 0 &&
    plan.minimumCachePromptTokens !== undefined &&
    input < plan.minimumCachePromptTokens
  )
    problems.push(
      `Implicit caching requires a prompt of at least ${plan.minimumCachePromptTokens.toLocaleString('en-US')} tokens.`,
    )
  if (readFraction > 0 && plan.cached_input_mtok === undefined)
    problems.push(
      'Cache read price is unreported for this quote. Choose a published plan or enter a rate.',
    )
  const writeRate =
    assumption.cacheDuration === '1h'
      ? plan.cacheWriteHour_mtok
      : plan.cache_write_mtok
  if (writeFraction > 0 && writeRate === undefined)
    problems.push(
      'Cache write price is unreported for this duration. Choose a published plan or enter a rate.',
    )
  if (
    plan.minimumPromptTokens !== undefined &&
    input < plan.minimumPromptTokens
  )
    problems.push(
      'This plan requires a longer prompt. Choose the matching context tier.',
    )
  if (
    plan.maximumPromptTokens !== undefined &&
    input > plan.maximumPromptTokens
  )
    problems.push(
      'Prompt exceeds this price tier. Choose the long context plan.',
    )
  const inputCost =
    (input *
      (Math.max(0, 1 - readFraction - writeFraction) * plan.input_mtok +
        readFraction * (plan.cached_input_mtok ?? 0) +
        writeFraction * (writeRate ?? 0))) /
    1e6
  const answerCost = (output * plan.output_mtok) / 1e6,
    reasoningCost =
      (reasoning * (plan.reasoning_mtok ?? plan.output_mtok)) / 1e6
  const multiplier = nonNegativeNumber(assumption.rateMultiplier)
  const perAttempt =
    (inputCost + answerCost + reasoningCost) * multiplier +
    nonNegativeNumber(assumption.extraPerAttempt)
  const success = optionalNumber(assumption.successPct)
  if (
    outcomes &&
    (!Number.isInteger(Number(assumption.maxAttempts)) ||
      Number(assumption.maxAttempts) < 1 ||
      Number(assumption.maxAttempts) > 10)
  )
    problems.push('Maximum attempts must be a whole number from 1 to 10.')
  if (outcomes && (success === null || success > 100))
    problems.push(
      'Enter a success rate between 0 and 100% to cost successful tasks.',
    )
  const retry =
    outcomes && success !== null
      ? attemptEconomics(success, Number(assumption.maxAttempts))
      : { attempts: 1, accepted: 1 }
  const review = outcomes
    ? ((percent(assumption.reviewPct) / 100) *
        nonNegativeNumber(assumption.reviewMinutes) *
        nonNegativeNumber(workload.reviewHourly)) /
      60
    : 0
  const calls = nonNegativeNumber(workload.calls),
    attempts = calls * retry.attempts
  const storage = nonNegativeNumber(assumption.storageMillionTokenHours)
  if (storage > 0 && plan.cache_storage_mtok_hour === undefined)
    problems.push('Cache storage price is unreported for this quote.')
  const monthlyStorage =
    storage * (plan.cache_storage_mtok_hour ?? 0) * multiplier
  const monthlyApi = attempts * perAttempt + monthlyStorage,
    monthlyReview = attempts * review
  const monthlyTotal = monthlyApi + monthlyReview
  const acceptedTasks = outcomes ? calls * retry.accepted : null
  return {
    complete: problems.length === 0,
    problems,
    inputTokens: input,
    outputTokens: output,
    reasoningTokens: reasoning,
    attempts,
    monthlyApi,
    monthlyReview,
    monthlyStorage,
    monthlyTotal,
    acceptedTasks,
    costPerSuccess:
      acceptedTasks && acceptedTasks > 0 ? monthlyTotal / acceptedTasks : null,
    perAttempt,
    monthlyInput: attempts * inputCost * multiplier,
    monthlyOutput: attempts * (answerCost + reasoningCost) * multiplier,
  }
}
export function billComparisonPath(
  keys: string[],
  workload: BillWorkload,
  assumptions: Record<string, ModelAssumptions>,
  outcomes: boolean,
): string {
  const p = new URLSearchParams()
  const selected = [...new Set(keys.filter(Boolean))].slice(0, 4)
  selected.forEach((k) => p.append('model', k))
  for (const [name, value] of Object.entries({
    calls: workload.calls,
    input: workload.inputTokens,
    output: workload.outputTokens,
    reasoning: workload.reasoningTokens,
    cache_read: workload.cacheReadPct,
    cache_write: workload.cacheWritePct,
    review_hourly: workload.reviewHourly,
  }))
    p.set(name, String(nonNegativeNumber(value)))
  if (outcomes) p.set('outcomes', '1')
  const kept = Object.fromEntries(
    selected.filter((k) => assumptions[k]).map((k) => [k, assumptions[k]]),
  )
  if (Object.keys(kept).length) p.set('assumptions', JSON.stringify(kept))
  return '/compare/?' + p.toString()
}
export function parseAssumptions(
  raw: string | null,
): Record<string, ModelAssumptions> {
  try {
    const o = JSON.parse(raw ?? '{}')
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {}
    const result: Record<string, ModelAssumptions> = Object.create(null)
    for (const [key, value] of Object.entries(o).slice(0, 4)) {
      if (!key.includes('/') || !value || typeof value !== 'object') continue
      const a = { ...defaultAssumptions }
      for (const field of Object.keys(a) as (keyof ModelAssumptions)[]) {
        const v = (value as Record<string, unknown>)[field]
        if (
          typeof v === 'string' &&
          v.length <= 250 &&
          (field === 'quote' ||
            field === 'cacheDuration' ||
            v === '' ||
            optionalNumber(v) !== null)
        )
          a[field] = v
      }
      result[key] = a
    }
    return result
  } catch {
    return {}
  }
}

export function applyRateOverrides(
  plan: BillingPlan,
  assumption: ModelAssumptions,
): BillingPlan {
  const result = { ...plan }
  const pairs = [
    ['inputRate', 'input_mtok'],
    ['outputRate', 'output_mtok'],
    ['cachedInputRate', 'cached_input_mtok'],
    [
      'cacheWriteRate',
      assumption.cacheDuration === '1h'
        ? 'cacheWriteHour_mtok'
        : 'cache_write_mtok',
    ],
    ['cacheStorageRate', 'cache_storage_mtok_hour'],
    ['reasoningRate', 'reasoning_mtok'],
  ] as const
  for (const [from, to] of pairs) {
    const value = optionalNumber(assumption[from])
    if (value !== null) result[to] = value
  }
  return result
}
