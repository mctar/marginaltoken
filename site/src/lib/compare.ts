import type { PriceModel } from './types'

export type Workload = {
  calls: number
  inputTokens: number
  outputTokens: number
}

export type CostBreakdown = {
  inputPerRequest: number
  outputPerRequest: number
  totalPerRequest: number
  monthlyInput: number
  monthlyOutput: number
  monthlyTotal: number
}

export const defaultWorkload: Workload = {
  calls: 10_000,
  inputTokens: 2_000,
  outputTokens: 500,
}

export function nonNegativeNumber(value: string | number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

export function calculateCost(
  model: Pick<PriceModel, 'input_mtok' | 'output_mtok'>,
  workload: Workload,
): CostBreakdown {
  const calls = nonNegativeNumber(workload.calls)
  const inputTokens = nonNegativeNumber(workload.inputTokens)
  const outputTokens = nonNegativeNumber(workload.outputTokens)
  const inputPerRequest = (inputTokens / 1_000_000) * model.input_mtok
  const outputPerRequest = (outputTokens / 1_000_000) * model.output_mtok
  const totalPerRequest = inputPerRequest + outputPerRequest

  return {
    inputPerRequest,
    outputPerRequest,
    totalPerRequest,
    monthlyInput: inputPerRequest * calls,
    monthlyOutput: outputPerRequest * calls,
    monthlyTotal: totalPerRequest * calls,
  }
}

export function comparisonPath(modelKeys: string[], workload?: Workload): string {
  const params = new URLSearchParams()
  for (const key of [...new Set(modelKeys.filter(Boolean))].slice(0, 4)) params.append('model', key)
  if (workload) {
    params.set('calls', String(nonNegativeNumber(workload.calls)))
    params.set('input', String(nonNegativeNumber(workload.inputTokens)))
    params.set('output', String(nonNegativeNumber(workload.outputTokens)))
  }
  const query = params.toString()
  return `/compare/${query ? `?${query}` : ''}`
}

export function modelComparisonPath(modelKey: string): string {
  return comparisonPath([modelKey])
}
