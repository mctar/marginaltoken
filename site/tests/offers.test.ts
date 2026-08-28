import assert from 'node:assert/strict'
import test from 'node:test'
import {
  comparableOfferCount,
  comparableOfferGroups,
  offersForGroup,
  widestOutputSpread,
} from '../src/lib/offers.ts'
import type { OfferComparisonGroup, OfferModel, VenueOffer } from '../src/lib/types.ts'

function group(overrides: Partial<OfferComparisonGroup> = {}): OfferComparisonGroup {
  return {
    key: 'cfg-base',
    confidence: 'declared',
    comparable: true,
    offerCount: 2,
    venueCount: 2,
    quantization: 'fp8',
    context: 128_000,
    maxOutputTokens: 32_000,
    supportsReasoning: true,
    supportsTools: true,
    supportsStructuredOutput: true,
    input_mtok: { min: 1, max: 2, spreadPct: 100 },
    output_mtok: { min: 4, max: 8, spreadPct: 100 },
    ...overrides,
  }
}

function offer(overrides: Partial<VenueOffer> = {}): VenueOffer {
  return {
    venue: 'Venue A',
    tag: 'venue-a/fp8',
    input_mtok: 1,
    output_mtok: 4,
    context: 128_000,
    quantization: 'fp8',
    maxOutputTokens: 32_000,
    supportedParameters: [],
    supportsReasoning: true,
    supportsTools: true,
    supportsStructuredOutput: true,
    configurationKey: 'cfg-base',
    ...overrides,
  }
}

function model(overrides: Partial<OfferModel> = {}): OfferModel {
  return {
    key: 'lab/model',
    canonicalKey: 'lab/model-20260828',
    sourceUrl: 'https://openrouter.ai/api/v1/models/lab/model/endpoints',
    configurationCount: 1,
    comparableGroupCount: 1,
    comparisonGroups: [group()],
    offers: [offer()],
    ...overrides,
  }
}

test('keeps only complete comparable groups and leads with declared precision', () => {
  const groups = comparableOfferGroups(model({
    comparisonGroups: [
      group({ key: 'nominal', confidence: 'nominal', output_mtok: { min: 1, max: 10, spreadPct: 900 } }),
      group({ key: 'declared-small', output_mtok: { min: 4, max: 6, spreadPct: 50 } }),
      group({ key: 'declared-large', output_mtok: { min: 4, max: 8, spreadPct: 100 } }),
      group({ key: 'singleton', comparable: false }),
      group({ key: 'incomplete', confidence: 'incomplete' }),
    ],
  }))

  assert.deepEqual(groups.map((candidate) => candidate.key), ['declared-large', 'declared-small', 'nominal'])
})

test('returns only a configuration’s offers ordered by output then input price', () => {
  const selected = offersForGroup(model({
    offers: [
      offer({ venue: 'Expensive', tag: 'expensive', input_mtok: 1, output_mtok: 9 }),
      offer({ venue: 'Wrong group', tag: 'wrong', configurationKey: 'cfg-other', output_mtok: 1 }),
      offer({ venue: 'Cheapest input', tag: 'input', input_mtok: 1, output_mtok: 4 }),
      offer({ venue: 'Higher input', tag: 'higher', input_mtok: 2, output_mtok: 4 }),
    ],
  }), 'cfg-base')

  assert.deepEqual(selected.map((candidate) => candidate.venue), ['Cheapest input', 'Higher input', 'Expensive'])
})

test('summarizes comparable offer count and widest output spread', () => {
  const groups = [
    group({ offerCount: 3, output_mtok: { min: 4, max: 5, spreadPct: 25 } }),
    group({ key: 'wide', offerCount: 4, output_mtok: { min: 2, max: 8, spreadPct: 300 } }),
  ]

  assert.equal(comparableOfferCount(groups), 7)
  assert.equal(widestOutputSpread(groups), 300)
})
