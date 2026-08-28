import type { OfferComparisonGroup, OfferModel, VenueOffer } from './types'

export const MAX_VISIBLE_OFFER_GROUPS = 4

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
