import type { BillWorkload } from './economics'
import type { FeedData, PriceModel } from './types'
import { quoteBill } from './planning.ts'
import { quotesFor } from './quotes.ts'
import { matchesOpenness } from './decisions.ts'
import { canonicalModelKey, modelRegister } from './register.ts'

export const WATCH_STORAGE = 'marginal-token-workload-watches-v1'
export type WatchRequirements = {
  context: number
  tools: boolean
  structured: boolean
  reasoning: boolean
  weights: boolean
}
export type WatchSnapshot = {
  key: string
  display: string
  quote: string
  monthly: number | null
  input: number
  output: number
  stage: string
  lifecycle: string
  context: number
}
export type WorkloadWatch = {
  version: 1
  id: string
  name: string
  savedAt: string
  path: string
  workload: BillWorkload
  requirements: WatchRequirements
  models: WatchSnapshot[]
  alternatives: string[]
}
export function safeScenarioPath(value: string): string {
  const url = new URL(value, 'https://marginaltoken.com')
  if (
    url.origin !== 'https://marginaltoken.com' ||
    !['/plan/', '/compare/', '/infrastructure/'].includes(url.pathname) ||
    value.length > 15000
  )
    throw new Error('Watch has an invalid scenario link.')
  return url.pathname + url.search + url.hash
}
export function parseWatches(text: string): WorkloadWatch[] {
  if (new TextEncoder().encode(text).length > 200000)
    throw new Error('Watch file exceeds 200 KB.')
  const value = JSON.parse(text)
  if (
    value?.version !== 1 ||
    !Array.isArray(value.watches) ||
    value.watches.length > 20
  )
    throw new Error('Expected version 1 with at most 20 watches.')
  const ids = new Set<string>()
  return value.watches.map((w: WorkloadWatch) => {
    if (
      w?.version !== 1 ||
      typeof w.id !== 'string' ||
      !w.id ||
      w.id.length > 100 ||
      ids.has(w.id) ||
      typeof w.name !== 'string' ||
      !w.name.trim() ||
      w.name.length > 100 ||
      typeof w.savedAt !== 'string' ||
      w.savedAt.length > 40 ||
      !Number.isFinite(Date.parse(w.savedAt)) ||
      typeof w.path !== 'string'
    )
      throw new Error('Invalid watch identity or date.')
    ids.add(w.id)
    if (
      !w.workload ||
      ![
        'calls',
        'inputTokens',
        'outputTokens',
        'reasoningTokens',
        'cacheReadPct',
        'cacheWritePct',
        'reviewHourly',
      ].every((key) => {
        const n = w.workload[key as keyof BillWorkload]
        return (
          typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1e15
        )
      }) ||
      w.workload.cacheReadPct + w.workload.cacheWritePct > 100
    )
      throw new Error('Invalid watch workload.')
    if (
      !w.requirements ||
      !Number.isFinite(w.requirements.context) ||
      w.requirements.context < 0 ||
      !['tools', 'structured', 'reasoning', 'weights'].every(
        (key) =>
          typeof w.requirements[key as keyof WatchRequirements] === 'boolean',
      )
    )
      throw new Error('Invalid watch requirements.')
    if (
      !Array.isArray(w.models) ||
      !w.models.length ||
      w.models.length > 4 ||
      !w.models.every(
        (m) =>
          m &&
          typeof m === 'object' &&
          typeof m.key === 'string' &&
          /^[^/\s]+\/[^\s]+$/.test(m.key) &&
          m.key.length < 250 &&
          typeof m.display === 'string' &&
          m.display.length < 250 &&
          typeof m.quote === 'string' &&
          m.quote.length < 500 &&
          [m.input, m.output, m.context].every(
            (n) => Number.isFinite(n) && n >= 0,
          ) &&
          (m.monthly === null ||
            (Number.isFinite(m.monthly) && m.monthly >= 0)) &&
          typeof m.stage === 'string' &&
          m.stage.length < 40 &&
          typeof m.lifecycle === 'string' &&
          m.lifecycle.length < 40,
      )
    )
      throw new Error('Invalid watch model baseline.')
    if (
      !Array.isArray(w.alternatives) ||
      w.alternatives.length > 5 ||
      !w.alternatives.every((k) => typeof k === 'string' && k.length < 250)
    )
      throw new Error('Invalid alternative baseline.')
    return {
      version: 1,
      id: w.id,
      name: w.name,
      savedAt: w.savedAt,
      path: safeScenarioPath(w.path),
      workload: Object.fromEntries(
        [
          'calls',
          'inputTokens',
          'outputTokens',
          'reasoningTokens',
          'cacheReadPct',
          'cacheWritePct',
          'reviewHourly',
        ].map((k) => [k, w.workload[k as keyof BillWorkload]]),
      ) as BillWorkload,
      requirements: {
        context: w.requirements.context,
        tools: w.requirements.tools,
        structured: w.requirements.structured,
        reasoning: w.requirements.reasoning,
        weights: w.requirements.weights,
      },
      models: w.models.map((m) => ({
        key: m.key,
        display: m.display,
        quote: m.quote,
        monthly: m.monthly,
        input: m.input,
        output: m.output,
        stage: m.stage,
        lifecycle: m.lifecycle,
        context: m.context,
      })),
      alternatives: [...w.alternatives],
    }
  })
}
export function eligibleAlternatives(
  data: FeedData,
  workload: BillWorkload,
  requirements: WatchRequirements,
  excluded: string[],
) {
  return data.prices.models
    .filter(
      (m) =>
        !excluded.includes(m.key) &&
        (m.releaseStage ?? modelRegister[m.key]?.stage ?? 'stable') ===
          'stable' &&
        !['deprecated', 'retired'].includes(
          m.lifecycle?.status ?? modelRegister[m.key]?.lifecycle?.status ?? '',
        ) &&
        m.context >= requirements.context &&
        (!requirements.tools || m.supportsTools) &&
        (!requirements.structured || m.supportsStructuredOutput) &&
        (!requirements.reasoning || m.supportsReasoning) &&
        (!requirements.weights ||
          matchesOpenness(m, 'weights', data.decisions)),
    )
    .map((model) => {
      const qs = quotesFor(model, data.decisions ?? null, data.offers ?? null)
      const q = qs.find((v) => v.id === 'lab:standard') ?? qs[0]
      return { model, quote: q, bill: quoteBill(model, q, workload) }
    })
    .filter((r) => r.bill.complete)
    .sort(
      (a, b) =>
        a.bill.monthlyTotal - b.bill.monthlyTotal ||
        a.model.key.localeCompare(b.model.key),
    )
    .slice(0, 5)
}
export function snapshot(
  model: PriceModel,
  quoteId: string,
  workload: BillWorkload,
  data: FeedData,
): WatchSnapshot {
  const q = quotesFor(model, data.decisions ?? null, data.offers ?? null).find(
    (candidate) => candidate.id === quoteId,
  )
  const bill = q ? quoteBill(model, q, workload) : null
  return {
    key: model.key,
    display: model.display,
    quote: quoteId,
    monthly: bill?.complete ? bill.monthlyTotal : null,
    input: q?.plan.input_mtok ?? model.input_mtok,
    output: q?.plan.output_mtok ?? model.output_mtok,
    context: q?.context ?? model.context,
    stage: model.releaseStage ?? modelRegister[model.key]?.stage ?? 'stable',
    lifecycle:
      model.lifecycle?.status ??
      modelRegister[model.key]?.lifecycle?.status ??
      'active',
  }
}
export function checkWatch(watch: WorkloadWatch, data: FeedData) {
  const changes: string[] = [],
    models = watch.models.map((old) => {
      const model = data.prices.models.find(
        (m) => m.key === canonicalModelKey(old.key),
      )
      if (!model) {
        changes.push(`${old.display}: no longer on the current tape.`)
        return { old, current: null }
      }
      const quotes = quotesFor(
        model,
        data.decisions ?? null,
        data.offers ?? null,
      )
      if (!quotes.some((q) => q.id === old.quote)) {
        changes.push(
          `${old.display}: saved quote is unavailable or its verification expired.`,
        )
        return { old, current: null }
      }
      const current = snapshot(model, old.quote, watch.workload, data)
      if (current.input !== old.input || current.output !== old.output)
        changes.push(`${old.display}: posted input/output rates changed.`)
      if (current.monthly !== old.monthly)
        changes.push(
          `${old.display}: workload estimate ${current.monthly === null ? 'is now incomplete' : 'changed'}.`,
        )
      if (current.stage !== old.stage || current.lifecycle !== old.lifecycle)
        changes.push(
          `${old.display}: lifecycle is now ${current.lifecycle} / ${current.stage}.`,
        )
      if (
        current.context < watch.requirements.context ||
        (watch.requirements.tools && !model.supportsTools) ||
        (watch.requirements.structured && !model.supportsStructuredOutput) ||
        (watch.requirements.reasoning && !model.supportsReasoning) ||
        (watch.requirements.weights &&
          !matchesOpenness(model, 'weights', data.decisions))
      )
        changes.push(
          `${old.display}: a saved requirement is no longer verified.`,
        )
      return { old, current }
    })
  const alternatives = eligibleAlternatives(
    data,
    watch.workload,
    watch.requirements,
    watch.models.map((m) => canonicalModelKey(m.key)),
  )
  if (
    JSON.stringify(alternatives.map((r) => r.model.key)) !==
    JSON.stringify(watch.alternatives)
  )
    changes.push('The five lowest-cost eligible alternatives have changed.')
  if (Date.now() - Date.parse(data.prices.generatedAt) > 7 * 86400000)
    changes.push(
      'The price feed is more than seven days old; refresh verification before relying on the comparison.',
    )
  return { changes: [...new Set(changes)], models, alternatives }
}
