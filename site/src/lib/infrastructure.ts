import type { OfferModel, PriceModel, VenueOffer } from './types'

export type ApiBasis = 'median' | 'cheapest' | 'tape'

export type InfrastructureAssumptions = {
  inputMillions: number
  outputMillions: number
  gpuHourly: number
  gpusPerReplica: number
  outputTokensPerSecond: number
  utilizationPct: number
  licensePerGpuYear: number
  costMode?: 'rent' | 'owned'
  gpuPurchase?: number
  amortizationMonths?: number
  powerWatts?: number
  powerPrice?: number
  staffHours?: number
  staffHourly?: number
  operatingMonthly?: number
  standbyReplicas?: number
  gpuMemoryGB?: number
  weightsGB?: number
  kvGB?: number
  overheadPct?: number
}

export type ApiQuote = {
  label: string
  monthly: number
  input_mtok: number
  output_mtok: number
  venue?: string
}

export type InfrastructureResult = {
  apiMonthly: number
  runMonthly: number
  selectedQuote: ApiQuote
  replicas: number
  costPerReplica: number
  outputCapacityPerReplica: number
  totalCapacityMillions: number
  breakEvenMillions: number | null
  breakEvenWithinCapacity: boolean
  saving: number
  complete: boolean
  problems: string[]
  standbyReplicas: number
  fixedMonthly: number
  memoryRequiredGB: number | null
  memoryAvailableGB: number | null
  memoryFits: boolean | null
  computeMonthly: number
  powerMonthly: number
  softwareMonthly: number
}

export const defaultInfrastructureAssumptions: InfrastructureAssumptions = {
  inputMillions: 50_000,
  outputMillions: 5_000,
  gpuHourly: 3.5,
  gpusPerReplica: 2,
  outputTokensPerSecond: 1_000,
  utilizationPct: 60,
  licensePerGpuYear: 4_500,
}

export function nonNegative(value: string | number, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

export function monthlyQuote(inputRate: number, outputRate: number, inputMillions: number, outputMillions: number): number {
  return inputRate * inputMillions + outputRate * outputMillions
}

function offerQuote(offer: VenueOffer, inputMillions: number, outputMillions: number): ApiQuote {
  return {
    label: offer.venue,
    venue: offer.venue,
    monthly: monthlyQuote(offer.input_mtok, offer.output_mtok, inputMillions, outputMillions),
    input_mtok: offer.input_mtok,
    output_mtok: offer.output_mtok,
  }
}

export function apiQuotes(model: PriceModel, offerModel: OfferModel | null, assumptions: InfrastructureAssumptions): ApiQuote[] {
  const quotes = (offerModel?.offers ?? [])
    .filter((offer) => Number.isFinite(offer.input_mtok) && Number.isFinite(offer.output_mtok))
    .map((offer) => offerQuote(offer, assumptions.inputMillions, assumptions.outputMillions))
    .sort((left, right) => left.monthly - right.monthly)
  if (quotes.length > 0) return quotes
  return [{
    label: model.source === 'firstparty' ? 'First-party Tape rate' : 'OpenRouter Tape rate',
    monthly: monthlyQuote(model.input_mtok, model.output_mtok, assumptions.inputMillions, assumptions.outputMillions),
    input_mtok: model.input_mtok,
    output_mtok: model.output_mtok,
  }]
}

export function selectQuote(quotes: ApiQuote[], basis: ApiBasis, tapeModel: PriceModel, assumptions: InfrastructureAssumptions): ApiQuote {
  if (basis === 'tape') {
    return {
      label: tapeModel.source === 'firstparty' ? 'First-party Tape rate' : 'OpenRouter Tape rate',
      monthly: monthlyQuote(tapeModel.input_mtok, tapeModel.output_mtok, assumptions.inputMillions, assumptions.outputMillions),
      input_mtok: tapeModel.input_mtok,
      output_mtok: tapeModel.output_mtok,
    }
  }
  if (basis === 'cheapest') return quotes[0]
  const upperIndex = Math.floor(quotes.length / 2)
  if (quotes.length % 2 === 1) return quotes[upperIndex]
  const lower = quotes[upperIndex - 1]
  const upper = quotes[upperIndex]
  return {
    label: `Median of ${quotes.length} posted routes`,
    monthly: (lower.monthly + upper.monthly) / 2,
    input_mtok: (lower.input_mtok + upper.input_mtok) / 2,
    output_mtok: (lower.output_mtok + upper.output_mtok) / 2,
  }
}

export function calculateInfrastructure(
  model: PriceModel,
  offerModel: OfferModel | null,
  basis: ApiBasis,
  assumptions: InfrastructureAssumptions,
): InfrastructureResult {
  const quotes = apiQuotes(model, offerModel, assumptions)
  const selectedQuote = selectQuote(quotes, basis, model, assumptions)
  const utilization = Math.min(100, assumptions.utilizationPct) / 100
  const secondsPerMonth = 730 * 60 * 60
  const outputCapacityPerReplica = assumptions.outputTokensPerSecond * secondsPerMonth * utilization / 1_000_000
  const replicas = assumptions.outputMillions > 0 && outputCapacityPerReplica > 0
    ? Math.max(1, Math.ceil(assumptions.outputMillions / outputCapacityPerReplica))
    : 1
  const problems: string[] = []
  if (assumptions.inputMillions > 0 && assumptions.outputMillions === 0) problems.push('Input-only capacity requires a prefill measurement. This planner sizes generated-token throughput.')
  if (!Number.isInteger(assumptions.gpusPerReplica) || assumptions.gpusPerReplica < 1) problems.push('GPU count must be a positive whole number.')
  if (assumptions.outputMillions > 0 && outputCapacityPerReplica <= 0) problems.push('Positive output demand requires positive throughput and utilization.')
  if (assumptions.costMode === 'owned' && !(assumptions.amortizationMonths && assumptions.amortizationMonths > 0)) problems.push('Owned hardware needs a positive amortization period.')
  const computePerGpu = assumptions.costMode === 'owned'
    ? (assumptions.gpuPurchase ?? 0) / Math.max(1, assumptions.amortizationMonths ?? 1)
    : assumptions.gpuHourly * 730
  const powerPerGpu = (assumptions.powerWatts ?? 0) / 1000 * 730 * (assumptions.powerPrice ?? 0)
  const costPerReplica = assumptions.gpusPerReplica * (computePerGpu + powerPerGpu + assumptions.licensePerGpuYear / 12)
  const standbyReplicas = Math.max(0,Math.floor(assumptions.standbyReplicas ?? 0))
  const fixedMonthly = (assumptions.staffHours ?? 0) * (assumptions.staffHourly ?? 0) + (assumptions.operatingMonthly ?? 0)
  const runMonthly = costPerReplica * (replicas + standbyReplicas) + fixedMonthly
  const memoryAvailableGB = assumptions.gpuMemoryGB && assumptions.gpuMemoryGB > 0 ? assumptions.gpuMemoryGB * assumptions.gpusPerReplica : null
  const memoryRequiredGB = assumptions.weightsGB && assumptions.weightsGB > 0 ? (assumptions.weightsGB + (assumptions.kvGB ?? 0)) * (1 + (assumptions.overheadPct ?? 0)/100) : null
  const memoryFits = memoryAvailableGB !== null && memoryRequiredGB !== null ? memoryAvailableGB >= memoryRequiredGB : null
  if (memoryFits === false) problems.push('Weights, KV cache and overhead exceed the entered aggregate GPU memory.')
  const inputShare = assumptions.inputMillions / Math.max(1, assumptions.inputMillions + assumptions.outputMillions)
  const outputShare = 1 - inputShare
  const blendedApiRate = selectedQuote.input_mtok * inputShare + selectedQuote.output_mtok * outputShare
  const breakEvenMillions = blendedApiRate > 0 ? (costPerReplica * (1 + standbyReplicas) + fixedMonthly) / blendedApiRate : null
  const totalCapacityMillions = outputShare > 0 ? outputCapacityPerReplica / outputShare : Number.POSITIVE_INFINITY
  const breakEvenWithinCapacity = outputShare > 0 && !problems.length && breakEvenMillions !== null && breakEvenMillions <= totalCapacityMillions
  return {
    apiMonthly: selectedQuote.monthly,
    runMonthly,
    selectedQuote,
    replicas,
    costPerReplica,
    outputCapacityPerReplica,
    totalCapacityMillions,
    breakEvenMillions,
    breakEvenWithinCapacity,
    saving: selectedQuote.monthly - runMonthly,
    complete: problems.length === 0,
    problems,
    standbyReplicas,
    fixedMonthly,
    memoryAvailableGB,
    memoryRequiredGB,
    memoryFits,
    computeMonthly: assumptions.gpusPerReplica * computePerGpu * (replicas + standbyReplicas),
    powerMonthly: assumptions.gpusPerReplica * powerPerGpu * (replicas + standbyReplicas),
    softwareMonthly: assumptions.gpusPerReplica * assumptions.licensePerGpuYear / 12 * (replicas + standbyReplicas),
  }
}

export function infrastructurePath(
  model: string,
  basis: ApiBasis,
  assumptions: InfrastructureAssumptions,
  deployment?: { hardware: string; profile: string },
): string {
  const params = new URLSearchParams()
  params.set('model', model)
  params.set('basis', basis)
  params.set('input', String(assumptions.inputMillions))
  params.set('output', String(assumptions.outputMillions))
  params.set('gpu', String(assumptions.gpuHourly))
  params.set('count', String(assumptions.gpusPerReplica))
  params.set('throughput', String(assumptions.outputTokensPerSecond))
  params.set('utilization', String(assumptions.utilizationPct))
  params.set('license', String(assumptions.licensePerGpuYear))
  for (const key of ['costMode','gpuPurchase','amortizationMonths','powerWatts','powerPrice','staffHours','staffHourly','operatingMonthly','standbyReplicas','gpuMemoryGB','weightsGB','kvGB','overheadPct'] as const)
    if (assumptions[key] !== undefined) params.set(key,String(assumptions[key]))
  if (deployment?.hardware) params.set('hardware', deployment.hardware)
  if (deployment?.profile) params.set('profile', deployment.profile)
  return `/infrastructure/?${params.toString()}`
}
