import { validDecisions } from './decisions.ts'
import type { DecisionsFeed, BriefFeed, ChangesFeed, DeploymentFeed, FeedData, HistoryFeed, MetaFeed, OffersFeed, PricesFeed, ProvenanceFeed } from './types'

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: 'no-store' })
  if (!response.ok) throw new Error(`${path} returned ${response.status}`)
  return response.json() as Promise<T>
}

async function fetchOptionalJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(path, { cache: 'no-store' })
    if (!response.ok) return null
    return await response.json() as T
  } catch {
    return null
  }
}

async function readCore() {
  return Promise.all([
    fetchJson<PricesFeed>('/data/prices.json'),
    fetchJson<HistoryFeed>('/data/history.json'),
    fetchJson<ChangesFeed>('/data/changes.json'),
    fetchJson<MetaFeed>('/data/meta.json'),
  ])
}

async function consistentCore() {
  for (let attempt = 0; attempt < 2; attempt++) {
    const core = await readCore()
    const [prices, history, changes, meta] = core
    if (!Array.isArray(prices.models) || !Array.isArray(history.points) ||
        !Array.isArray(changes.changes) || !Array.isArray(meta.indexHistory) || !prices.generatedAt) {
      throw new Error('The published feed is incomplete')
    }
    if (core.every(feed => feed.generatedAt === prices.generatedAt)) return core
  }
  throw new Error('The ledger is refreshing. Reload to read a consistent set of prices.')
}

export async function loadFeed(includeOffers = false, includeDeployment = false): Promise<FeedData> {
  const [[prices, history, changes, meta], candidateBrief, candidateProvenance, candidateOffers, candidateDeployment, candidateDecisions] = await Promise.all([
    consistentCore(),
    fetchOptionalJson<BriefFeed>('/data/brief.json'),
    fetchOptionalJson<ProvenanceFeed>('/data/provenance.json'),
    includeOffers ? fetchOptionalJson<OffersFeed>('/data/offers.json') : Promise.resolve(null),
    includeDeployment ? fetchOptionalJson<DeploymentFeed>('/data/deployment.json') : Promise.resolve(null),
    fetchOptionalJson<DecisionsFeed>('/data/decisions.json'),
  ])
  const brief = candidateBrief
    && typeof candidateBrief.generatedAt === 'string'
    && typeof candidateBrief.headline === 'string'
    && typeof candidateBrief.note === 'string'
    && typeof candidateBrief.sourceEventCount === 'number'
    ? candidateBrief
    : null
  const provenance = candidateProvenance
    && candidateProvenance.generatedAt === prices.generatedAt
    && ['healthy', 'attention', 'degraded'].includes(candidateProvenance.status)
    && Array.isArray(candidateProvenance.providers)
    && Array.isArray(candidateProvenance.conflicts)
    && (candidateProvenance.reviewCandidates === undefined || Array.isArray(candidateProvenance.reviewCandidates))
    ? candidateProvenance
    : null
  const offers = candidateOffers
    && typeof candidateOffers.generatedAt === 'string'
    && typeof candidateOffers.asOf === 'string'
    && candidateOffers.comparisonPolicy?.version === 1
    && Array.isArray(candidateOffers.models)
    ? candidateOffers
    : null
  const deployment = candidateDeployment
    && candidateDeployment.source === 'nvidia-nim'
    && Array.isArray(candidateDeployment.models)
    && candidateDeployment.models.every((model) => (
      typeof model.key === 'string'
      && typeof model.sourceUrl === 'string'
      && Array.isArray(model.profiles)
      && model.profiles.every((profile) => (
        typeof profile.id === 'string'
        && Number.isInteger(profile.tensorParallelism)
        && profile.tensorParallelism > 0
        && Array.isArray(profile.verifiedGpus)
      ))
    ))
    ? candidateDeployment
    : null
  return { prices, history, changes, meta, brief, provenance, offers, deployment, decisions: validDecisions(candidateDecisions) ? candidateDecisions : null }
}
