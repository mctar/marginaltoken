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
  inputModalities?: string[]
  outputModalities?: string[]
  supportsReasoning?: boolean
  supportsTools?: boolean
  supportsStructuredOutput?: boolean
  releaseStage?: 'stable' | 'preview' | 'experimental'
  maxOutputTokens?: number
  knowledgeCutoff?: string
  expirationDate?: string
  huggingFaceId?: string
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

export type ProviderSourceStatus = {
  provider: string
  status: 'fresh' | 'last_good' | 'stale' | 'manual' | 'skipped'
  sourceUrl: string
  lastVerified: string | null
  modelCount: number
  detail?: string
}

export type SourceConflict = {
  key: string
  field: 'input_mtok' | 'output_mtok'
  firstparty: number
  openrouter: number
}

export type ProvenanceFeed = {
  generatedAt: string
  asOf: string
  status: 'healthy' | 'attention' | 'degraded'
  degradedProviderCount: number
  conflictCount: number
  providers: ProviderSourceStatus[]
  conflicts: SourceConflict[]
}

export type OfferPriceRange = {
  min: number
  max: number
  spreadPct?: number
}

export type VenueOffer = {
  venue: string
  tag: string
  source?: 'openrouter-endpoints' | 'together-catalog' | 'fireworks-pricing'
  sourceUrl?: string
  configurationSource?: 'openrouter-endpoints'
  verifiedFields?: string[]
  reportedUnknowns?: string[]
  input_mtok: number
  output_mtok: number
  cached_input_mtok?: number
  cache_write_mtok?: number
  reasoning_mtok?: number
  context: number
  quantization?: string
  maxOutputTokens?: number
  supportedParameters: string[]
  supportsReasoning: boolean
  supportsTools: boolean
  supportsStructuredOutput: boolean
  configurationKey: string
}

export type OfferSource = {
  key: 'openrouter-endpoints' | 'together-catalog' | 'fireworks-pricing'
  label: string
  sourceUrl: string
  modelCount?: number
  offerCount?: number
  catalogModelCount?: number
  verifiedOfferCount?: number
  addedOfferCount?: number
}

export type OfferComparisonGroup = {
  key: string
  confidence: 'declared' | 'nominal' | 'incomplete'
  comparable: boolean
  offerCount: number
  venueCount: number
  quantization: string
  context: number
  maxOutputTokens?: number
  supportsReasoning: boolean
  supportsTools: boolean
  supportsStructuredOutput: boolean
  input_mtok: OfferPriceRange
  output_mtok: OfferPriceRange
}

export type OfferModel = {
  key: string
  canonicalKey: string
  sourceUrl: string
  sources?: OfferSource[]
  configurationCount: number
  comparableGroupCount: number
  comparisonGroups: OfferComparisonGroup[]
  offers: VenueOffer[]
}

export type OffersFeed = {
  generatedAt: string
  asOf: string
  source: 'openrouter-endpoints' | 'multi-source'
  sources?: OfferSource[]
  targetModelCount: number
  modelCount: number
  offerCount: number
  venueCount: number
  comparableModelCount: number
  comparableGroupCount: number
  declaredComparableGroupCount: number
  nominalComparableGroupCount: number
  comparisonPolicy: {
    version: number
    scope: string
    matchingFields: string[]
  }
  models: OfferModel[]
}

export type DeploymentLifecycle = 'nim' | 'certified-feature' | 'certified-production'

export type DeploymentProfile = {
  id: string
  tensorParallelism: number
  precision: string
  lora: boolean
  verifiedGpus: string[]
  optimization?: string
}

export type DeploymentModel = {
  key: string
  display: string
  nvidiaModelId: string
  lifecycle: DeploymentLifecycle
  sourceUrl: string
  catalogUrl: string
  profileSourceUrl: string
  profileModel: string
  verifiedAt: string
  status: 'fresh' | 'last_good' | 'stale'
  profilesVerifiedAt: string
  profilesStatus: 'fresh' | 'last_good' | 'stale'
  profiles: DeploymentProfile[]
}

export type DeploymentFeed = {
  generatedAt: string
  asOf: string
  source: 'nvidia-nim'
  status: 'fresh' | 'attention' | 'stale'
  modelCount: number
  profileCount: number
  sources: Array<{
    label: string
    sourceUrl: string
  }>
  models: DeploymentModel[]
}

export type FeedData = {
  prices: PricesFeed
  history: HistoryFeed
  changes: ChangesFeed
  meta: MetaFeed
  brief: BriefFeed | null
  provenance: ProvenanceFeed | null
  offers: OffersFeed | null
  deployment: DeploymentFeed | null
}
