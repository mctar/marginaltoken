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
export function quotesFor(
  model: PriceModel,
  decisions: DecisionsFeed | null,
  offers: OffersFeed | null,
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
  if (billing && currentVerification(billing))
    for (const plan of billing.plans)
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
        source: `Published lab plan${billing.status === 'last_good' ? ' · Last good' : ''}`,
        sourceUrl: billing.sourceUrl,
        verifiedAt: billing.verifiedAt,
        context: model.context,
        maxOutput: model.maxOutputTokens,
      })
  for (const offer of (offers &&
  Date.now() - Date.parse(offers.generatedAt) <= 7 * 86400000
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
