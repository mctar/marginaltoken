import type { PriceModel } from './types'

export function shareImageFilename(slug: string): string {
  const safe = slug
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return `marginal-token-${safe || 'share'}.png`
}

export function shareSourceLabel(model: Pick<PriceModel, 'source'>): string {
  return model.source === 'firstparty' ? 'First-party pricing' : 'OpenRouter routed listing'
}
