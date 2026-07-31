import type { PriceModel } from './types'

export type CheaperMatch = {
  model: PriceModel
  inputSavingsPct: number
  outputSavingsPct: number
  minimumSavingsPct: number
}

const capabilityFields = [
  'supportsReasoning',
  'supportsTools',
  'supportsStructuredOutput',
] as const

function includesEvery(candidate: string[] | undefined, required: string[] | undefined): boolean {
  if (!required?.length) return true
  const available = new Set(candidate ?? [])
  return required.every((value) => available.has(value))
}

function preservesRecordedSpecs(current: PriceModel, candidate: PriceModel): boolean {
  if ((candidate.releaseStage ?? 'stable') !== 'stable') return false
  if (candidate.context < current.context) return false
  if (!includesEvery(candidate.inputModalities, current.inputModalities)) return false
  if (!includesEvery(candidate.outputModalities, current.outputModalities)) return false
  return capabilityFields.every((field) => !current[field] || candidate[field])
}

export function cheaperMatches(current: PriceModel, models: PriceModel[], limit = 3): CheaperMatch[] {
  const ranked = models
    .filter((candidate) => (
      candidate.key !== current.key
      && candidate.input_mtok < current.input_mtok
      && candidate.output_mtok < current.output_mtok
      && preservesRecordedSpecs(current, candidate)
    ))
    .map((model) => {
      const inputSavingsPct = ((current.input_mtok - model.input_mtok) / current.input_mtok) * 100
      const outputSavingsPct = ((current.output_mtok - model.output_mtok) / current.output_mtok) * 100
      return {
        model,
        inputSavingsPct,
        outputSavingsPct,
        minimumSavingsPct: Math.min(inputSavingsPct, outputSavingsPct),
      }
    })
    .sort((left, right) => (
      right.minimumSavingsPct - left.minimumSavingsPct
      || (right.inputSavingsPct + right.outputSavingsPct) - (left.inputSavingsPct + left.outputSavingsPct)
      || Number(right.model.source === 'firstparty') - Number(left.model.source === 'firstparty')
      || left.model.display.localeCompare(right.model.display)
      || left.model.key.localeCompare(right.model.key)
    ))
  const maximum = Math.max(0, limit)
  const selected: CheaperMatch[] = []
  const selectedKeys = new Set<string>()
  const selectedProviders = new Set<string>()

  for (const match of ranked) {
    if (selected.length >= maximum) break
    if (selectedProviders.has(match.model.provider)) continue
    selected.push(match)
    selectedKeys.add(match.model.key)
    selectedProviders.add(match.model.provider)
  }
  for (const match of ranked) {
    if (selected.length >= maximum) break
    if (selectedKeys.has(match.model.key)) continue
    selected.push(match)
    selectedKeys.add(match.model.key)
  }
  return selected
}
