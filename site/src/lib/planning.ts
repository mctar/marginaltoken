import { calculateBill, defaultAssumptions, percent, type BillWorkload } from './economics.ts'
import type { Quote } from './quotes.ts'
import type { PriceModel } from './types'

export const planningWorkload: BillWorkload = { calls: 10000, inputTokens: 2000, outputTokens: 500, reasoningTokens: 0, cacheReadPct: 0, cacheWritePct: 0, reviewHourly: 50 }

export function quoteBill(model: PriceModel, quote: Quote, workload: BillWorkload) {
  const bill = calculateBill(quote.plan, workload, defaultAssumptions)
  const problems = [...bill.problems]
  if (!quote.context) problems.push('This quote has no reported context limit.')
  else if (workload.inputTokens + workload.outputTokens + workload.reasoningTokens > quote.context)
    problems.push('Input and generated tokens exceed this quote’s context limit.')
  if (quote.maxOutput && workload.outputTokens + workload.reasoningTokens > quote.maxOutput)
    problems.push('Generated tokens exceed this quote’s output limit.')
  if (model.lifecycle?.status === 'retired' || model.lifecycle?.status === 'deprecated')
    problems.push('This model ID is retired or deprecated; use its recorded successor.')
  if (quote.id === 'tape') {
    const limit = model.rateNote?.match(/up to ([\d,]+) (?:input |prompt )?tokens/i)
    if (limit && workload.inputTokens > Number(limit[1].replaceAll(',', '')))
      problems.push('The tape carries the lower context tier. Choose a published long-context plan.')
    if (model.verificationStatus === 'stale' || model.verificationStatus === 'manual')
      problems.push('This first-party quote is awaiting current price verification.')
  }
  return { ...bill, problems, complete: problems.length === 0 }
}

export type FleetAssumptions = { escalationPct: number; firstAcceptedPct: number; secondAcceptedPct: number; firstReviewPct: number; secondReviewPct: number; reviewMinutes: number }
export function calculateFleet(first: ReturnType<typeof quoteBill>, second: ReturnType<typeof quoteBill>, workload: BillWorkload, a: FleetAssumptions) {
  const e = percent(a.escalationPct) / 100
  const accepted = workload.calls * ((1 - e) * percent(a.firstAcceptedPct) / 100 + e * percent(a.secondAcceptedPct) / 100)
  const review = workload.calls * (percent(a.firstReviewPct) / 100 + e * percent(a.secondReviewPct) / 100) * a.reviewMinutes * workload.reviewHourly / 60
  const api = first.monthlyApi + e * second.monthlyApi
  return { api, review, total: api + review, accepted, escalated: workload.calls * e,
    costPerSuccess: accepted > 0 ? (api + review) / accepted : null,
    complete: first.complete && (e === 0 || second.complete),
    problems: [...first.problems, ...(e > 0 ? second.problems : [])] }
}

export function wilson(accepted: number, total: number) {
  const z = 1.96, p = accepted / total, d = 1 + z * z / total
  const middle = (p + z * z / (2 * total)) / d
  const radius = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / d
  return { low: Math.max(0, middle - radius), high: Math.min(1, middle + radius) }
}
