export type PriceModel = {
  key: string
  display: string
  provider: string
  input_mtok: number
  output_mtok: number
  context: number
  source: 'openrouter' | 'firstparty'
  sourceUrl?: string
  checked?: string
  rateNote?: string
  indexEligible?: boolean
}

export type PricesFeed = {
  generatedAt: string
  asOf: string
  models: PriceModel[]
}

export type HistoryPoint = {
  key: string
  date: string
  input_mtok: number
  output_mtok: number
}

export type HistoryFeed = {
  generatedAt: string
  points: HistoryPoint[]
}

export type PriceChange = {
  type: 'price'
  date: string
  key: string
  display: string
  field: 'input_mtok' | 'output_mtok'
  from: number
  to: number
  pct: number | null
}

export type ListingChange = {
  type: 'listed' | 'delisted'
  date: string
  key: string
  display: string
  field: 'listed' | 'delisted'
}

export type BasketChange = {
  type: 'basket'
  date: string
  key: 'index'
  display: string
  field: 'basket'
  from: string[]
  to: string[]
}

export type ChangeEvent = PriceChange | ListingChange | BasketChange

export type ChangesFeed = {
  generatedAt: string
  changes: ChangeEvent[]
}

export type IndexPoint = {
  date: string
  value: number
}

export type MetaFeed = {
  generatedAt: string
  asOf: string
  modelCount: number
  indexValue: number
  indexBase: number
  indexBaseDate: string
  indexBaseMean: number
  basket: string[]
  indexHistory: IndexPoint[]
}

export type BriefFeed = {
  generatedAt: string
  asOf: string
  model: string
  headline: string
  note: string
  sourceEventCount: number
}

export type FeedData = {
  prices: PricesFeed
  history: HistoryFeed
  changes: ChangesFeed
  meta: MetaFeed
  brief: BriefFeed | null
}
