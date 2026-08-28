import assert from 'node:assert/strict'
import test from 'node:test'
import {
  comparableOfferCount,
  comparableOfferGroups,
  filterSpreadRows,
  marketSpreadRows,
  offersForGroup,
  widestOutputSpread,
} from '../src/lib/offers.ts'
import type { OfferComparisonGroup, OfferModel, PriceModel, VenueOffer } from '../src/lib/types.ts'

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

function priceModel(overrides: Partial<PriceModel> = {}): PriceModel {
  return {
    key: 'lab/model',
    display: 'Model Prime',
    provider: 'lab',
    input_mtok: 1,
    output_mtok: 4,
    context: 128_000,
    source: 'openrouter',
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

test('builds market rows only for priced models with non-zero comparable gaps', () => {
  const rows = marketSpreadRows(
    [priceModel()],
    [
      model({
        comparisonGroups: [
          group({ key: 'wide', input_mtok: { min: 1, max: 4, spreadPct: 300 } }),
          group({ key: 'same', input_mtok: { min: 1, max: 1, spreadPct: 0 }, output_mtok: { min: 4, max: 4, spreadPct: 0 } }),
          group({ key: 'not-comparable', comparable: false }),
        ],
        offers: [
          offer({ venue: 'Venue A', configurationKey: 'wide' }),
          offer({ venue: 'Venue B', tag: 'venue-b/fp8', configurationKey: 'wide' }),
        ],
      }),
      model({ key: 'missing/from-prices' }),
    ],
  )

  assert.equal(rows.length, 1)
  assert.equal(rows[0].group.key, 'wide')
  assert.equal(rows[0].widestSpreadPct, 300)
  assert.deepEqual(rows[0].venues, ['Venue A', 'Venue B'])
})

test('filters market rows by confidence and model, venue, route, or precision terms', () => {
  const declared = model({
    comparisonGroups: [group({ key: 'declared', output_mtok: { min: 4, max: 8, spreadPct: 100 } })],
    offers: [offer({ venue: 'Nebula Cloud', tag: 'nebula/fp8', configurationKey: 'declared' })],
  })
  const nominal = model({
    key: 'other/model',
    comparisonGroups: [group({
      key: 'nominal',
      confidence: 'nominal',
      quantization: 'undisclosed',
      input_mtok: { min: 1, max: 6, spreadPct: 500 },
    })],
    offers: [offer({ venue: 'Other Cloud', tag: 'route/nominal', configurationKey: 'nominal' })],
  })
  const rows = marketSpreadRows(
    [priceModel(), priceModel({ key: 'other/model', display: 'Other Model', provider: 'other' })],
    [declared, nominal],
  )

  assert.deepEqual(
    filterSpreadRows(rows, { query: '', confidence: 'declared', sort: 'widest' }).map((row) => row.model.key),
    ['lab/model'],
  )
  assert.deepEqual(
    filterSpreadRows(rows, { query: 'nebula fp8', confidence: 'all', sort: 'widest' }).map((row) => row.model.key),
    ['lab/model'],
  )
  assert.deepEqual(
    filterSpreadRows(rows, { query: 'route nominal', confidence: 'all', sort: 'widest' }).map((row) => row.model.key),
    ['other/model'],
  )
})

test('ranks market rows by the selected input or output gap', () => {
  const rows = marketSpreadRows(
    [priceModel(), priceModel({ key: 'other/model', display: 'Other Model' })],
    [
      model({ comparisonGroups: [group({ input_mtok: { min: 1, max: 5, spreadPct: 400 }, output_mtok: { min: 4, max: 5, spreadPct: 25 } })] }),
      model({
        key: 'other/model',
        comparisonGroups: [group({ key: 'other', input_mtok: { min: 1, max: 2, spreadPct: 100 }, output_mtok: { min: 4, max: 12, spreadPct: 200 } })],
      }),
    ],
  )

  assert.deepEqual(filterSpreadRows(rows, { query: '', confidence: 'all', sort: 'input' }).map((row) => row.model.key), ['lab/model', 'other/model'])
  assert.deepEqual(filterSpreadRows(rows, { query: '', confidence: 'all', sort: 'output' }).map((row) => row.model.key), ['other/model', 'lab/model'])
})
