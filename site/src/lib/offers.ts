import type { OfferComparisonGroup, OfferModel, PriceModel, VenueOffer } from './types'

export const MAX_VISIBLE_OFFER_GROUPS = 4

export type SpreadConfidence = 'declared' | 'nominal' | 'all'
export type SpreadSort = 'widest' | 'output' | 'input'

export type SpreadRow = {
  model: PriceModel
  offerModel: OfferModel
  group: OfferComparisonGroup
  inputSpreadPct: number
  outputSpreadPct: number
  widestSpreadPct: number
  venues: string[]
}

function spread(group: OfferComparisonGroup): number {
  return Math.max(group.output_mtok.spreadPct ?? 0, group.input_mtok.spreadPct ?? 0)
}

export function comparableOfferGroups(model: OfferModel): OfferComparisonGroup[] {
  return model.comparisonGroups
    .filter((group) => group.comparable && group.confidence !== 'incomplete')
    .sort((left, right) => (
      Number(right.confidence === 'declared') - Number(left.confidence === 'declared')
      || spread(right) - spread(left)
      || right.offerCount - left.offerCount
      || left.key.localeCompare(right.key)
    ))
}

export function offersForGroup(model: OfferModel, groupKey: string): VenueOffer[] {
  return model.offers
    .filter((offer) => offer.configurationKey === groupKey)
    .sort((left, right) => (
      left.output_mtok - right.output_mtok
      || left.input_mtok - right.input_mtok
      || left.venue.localeCompare(right.venue)
      || left.tag.localeCompare(right.tag)
    ))
}

export function comparableOfferCount(groups: OfferComparisonGroup[]): number {
  return groups.reduce((total, group) => total + group.offerCount, 0)
}

export function widestOutputSpread(groups: OfferComparisonGroup[]): number {
  return groups.reduce((widest, group) => Math.max(widest, group.output_mtok.spreadPct ?? 0), 0)
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function providerSearchName(provider: string): string {
  const knownNames: Record<string, string> = {
    'x-ai': 'xAI',
    mistralai: 'Mistral',
    moonshotai: 'Moonshot AI',
  }
  return knownNames[provider] ?? provider
}

export function marketSpreadRows(prices: PriceModel[], offerModels: OfferModel[]): SpreadRow[] {
  const pricesByKey = new Map(prices.map((model) => [model.key, model]))
  const rows: SpreadRow[] = []

  for (const offerModel of offerModels) {
    const model = pricesByKey.get(offerModel.key)
    if (!model) continue

    for (const group of comparableOfferGroups(offerModel)) {
      const inputSpreadPct = group.input_mtok.spreadPct ?? 0
      const outputSpreadPct = group.output_mtok.spreadPct ?? 0
      const widestSpreadPct = Math.max(inputSpreadPct, outputSpreadPct)
      if (widestSpreadPct <= 0) continue

      const venues = [...new Set(offersForGroup(offerModel, group.key).map((offer) => offer.venue))]
        .sort((left, right) => left.localeCompare(right))
      rows.push({ model, offerModel, group, inputSpreadPct, outputSpreadPct, widestSpreadPct, venues })
    }
  }

  return sortSpreadRows(rows, 'widest')
}

export function filterSpreadRows(
  rows: SpreadRow[],
  filters: { query: string; confidence: SpreadConfidence; sort: SpreadSort },
): SpreadRow[] {
  const terms = normalizeSearch(filters.query).split(/\s+/).filter(Boolean)
  const filtered = rows.filter((row) => {
    if (filters.confidence !== 'all' && row.group.confidence !== filters.confidence) return false
    if (terms.length === 0) return true
    const offers = offersForGroup(row.offerModel, row.group.key)
    const precision = row.group.quantization === 'undisclosed' ? 'precision undisclosed' : row.group.quantization
    const haystack = normalizeSearch([
      row.model.display,
      row.model.key,
      row.model.provider,
      providerSearchName(row.model.provider),
      row.model.provider.replaceAll('-', ''),
      precision,
      ...row.venues,
      ...offers.map((offer) => offer.tag),
      ...offers.map((offer) => offer.source ?? ''),
    ].join(' '))
    return terms.every((term) => haystack.includes(term))
  })
  return sortSpreadRows(filtered, filters.sort)
}

export function sortSpreadRows(rows: SpreadRow[], sort: SpreadSort): SpreadRow[] {
  const metric = (row: SpreadRow) => {
    if (sort === 'input') return row.inputSpreadPct
    if (sort === 'output') return row.outputSpreadPct
    return row.widestSpreadPct
  }
  return [...rows].sort((left, right) => (
    metric(right) - metric(left)
    || right.widestSpreadPct - left.widestSpreadPct
    || right.group.offerCount - left.group.offerCount
    || left.model.display.localeCompare(right.model.display)
    || left.group.key.localeCompare(right.group.key)
  ))
}
