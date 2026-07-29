import type { ChangesFeed, FeedData, HistoryFeed, MetaFeed, PricesFeed } from './types'

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: 'no-store' })
  if (!response.ok) throw new Error(`${path} returned ${response.status}`)
  return response.json() as Promise<T>
}

export async function loadFeed(): Promise<FeedData> {
  const [prices, history, changes, meta] = await Promise.all([
    fetchJson<PricesFeed>('/data/prices.json'),
    fetchJson<HistoryFeed>('/data/history.json'),
    fetchJson<ChangesFeed>('/data/changes.json'),
    fetchJson<MetaFeed>('/data/meta.json'),
  ])
  if (!Array.isArray(prices.models) || !Array.isArray(meta.indexHistory)) {
    throw new Error('The published feed is incomplete')
  }
  return { prices, history, changes, meta }
}
