import { currentVerification, decisionFor } from './decisions.ts'
import { contextSize } from './format.ts'
import type {
  BillingPlan,
  DecisionsFeed,
  OffersFeed,
  PriceModel,
} from './types'
export type Quote = {
  id: string
  plan: BillingPlan
  source: string
  sourceUrl: string
  verifiedAt?: string
  context?: number
  maxOutput?: number
}

export function datedBillingPlans(
  plans: BillingPlan[],
  now = Date.now(),
): BillingPlan[] {
  const today = new Date(now).toISOString().slice(0, 10)
  return plans.flatMap((plan) => {
    const { scheduledRates = [], ...base } = plan
    const schedule = [...scheduledRates].sort((a, b) =>
      a.effectiveFrom.localeCompare(b.effectiveFrom),
    )
    const active = schedule.filter((rate) => rate.effectiveFrom <= today).at(-1)
    const current = active
      ? {
          ...base,
          ...active,
          validThrough: undefined,
          label: `${base.label} · from ${active.effectiveFrom}`,
        }
      : {
          ...base,
          label: base.validThrough
            ? `${base.label} · through ${base.validThrough}`
            : base.label,
        }
    const available = !current.validThrough || today <= current.validThrough
    return [
      ...(available ? [current] : []),
      ...schedule
        .filter((rate) => rate.effectiveFrom > today)
        .map((rate) => ({
          ...base,
          ...rate,
          validThrough: undefined,
          id: `${base.id}-from-${rate.effectiveFrom}`,
          label: `${base.label} · from ${rate.effectiveFrom}`,
        })),
    ]
  })
}

export function quotesFor(
  model: PriceModel,
  decisions: DecisionsFeed | null,
  offers: OffersFeed | null,
  now = Date.now(),
): Quote[] {
  const boundaryText = model.rateNote?.match(
    /up to ([\d,]+) (?:input |prompt )?tokens/i,
  )?.[1]
  const boundary = boundaryText
    ? Number(boundaryText.replaceAll(',', ''))
    : undefined
  const quotes: Quote[] = [
    {
      id: 'tape',
      plan: {
        id: 'tape',
        label: 'Standard tape quote',
        input_mtok: model.input_mtok,
        output_mtok: model.output_mtok,
        maximumPromptTokens: boundary,
      },
      source:
        model.source === 'firstparty' ? 'First-party tape' : 'OpenRouter tape',
      sourceUrl: model.sourceUrl ?? `https://openrouter.ai/${model.key}`,
      context: model.context,
      maxOutput: model.maxOutputTokens,
    },
  ]
  const billing = decisionFor(model, decisions)?.billing
  const plans = datedBillingPlans(billing?.plans ?? [], now)
  const standard = plans.find((p) => p.id === 'standard')
  const inconsistent =
    model.source === 'firstparty' &&
    model.verificationStatus === 'fresh' &&
    standard &&
    (Math.abs(standard.input_mtok - model.input_mtok) > 0.0001 ||
      Math.abs(standard.output_mtok - model.output_mtok) > 0.0001)
  if (billing && currentVerification(billing, now) && !inconsistent)
    for (const plan of plans)
      quotes.push({
        id: 'lab:' + plan.id,
        plan:
          boundary !== undefined &&
          billing.plans.some((p) => p.id.includes('long-context'))
            ? {
                ...plan,
                ...(plan.id.includes('long-context')
                  ? {
                      minimumPromptTokens:
                        plan.minimumPromptTokens ?? boundary + 1,
                    }
                  : {
                      maximumPromptTokens: plan.maximumPromptTokens ?? boundary,
                    }),
              }
            : plan,
        source: `${plan.effectiveFrom && plan.effectiveFrom > new Date(now).toISOString().slice(0, 10) ? 'Scheduled' : 'Published'} lab plan${billing.status === 'last_good' ? ' · Last good' : ''}`,
        sourceUrl: billing.sourceUrl,
        verifiedAt: billing.verifiedAt,
        context: plan.contextWindowTokens ?? model.context,
        maxOutput: plan.maximumOutputTokens ?? model.maxOutputTokens,
      })
  for (const offer of (offers &&
  now - Date.parse(offers.generatedAt) <= 7 * 86400000
    ? offers
    : null
  )?.models.find((row) => row.key === model.key)?.offers ?? [])
    quotes.push({
      id: `venue:${offer.venue}:${offer.tag}`,
      plan: {
        id: offer.tag,
        label: `${offer.venue} · ${offer.quantization ?? 'precision undisclosed'} · ${contextSize(offer.context)}`,
        input_mtok: offer.input_mtok,
        output_mtok: offer.output_mtok,
        cached_input_mtok: offer.cached_input_mtok,
        cache_write_mtok: offer.cache_write_mtok,
        reasoning_mtok: offer.reasoning_mtok,
      },
      source: `${offer.venue} · ${offer.source ?? 'OpenRouter endpoints'}`,
      sourceUrl:
        offer.sourceUrl ?? `https://openrouter.ai/${model.key}/providers`,
      context: offer.context,
      verifiedAt: offers?.generatedAt,
      maxOutput: offer.maxOutputTokens,
    })
  return quotes
}
