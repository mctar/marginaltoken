import register from '../../../collector/model-register.json' with { type: 'json' }
import type { PriceModel } from './types'

export const SHORTLIST_MIN_PRICE = 0.1
export const SHORTLIST_MAX_PRICE = 100

export type ShortlistSlot = {
  id: string
  tier: string
  provider: string
  family?: string
  candidates: readonly string[]
}

export type ShortlistColumn = {
  id: string
  title: string
  slots: readonly ShortlistSlot[]
}

export type ShortlistSelection = ShortlistSlot & {
  model: PriceModel | null
}

// This is an editorial set, not a model-name heuristic. Add a newly released
// successor to the front of its slot only after its standard API rate and
// release status have been reviewed. Older keys remain as safe fallbacks.
export const SHORTLIST_COLUMNS: readonly ShortlistColumn[] = register.apiShortlist

export const SHORTLIST_SLOT_COUNT = SHORTLIST_COLUMNS.reduce(
  (count, column) => count + column.slots.length,
  0,
)

export function selectShortlist(models: readonly PriceModel[]): Array<ShortlistColumn & { selections: ShortlistSelection[] }> {
  const byKey = new Map(models.map((model) => [model.key, model]))
  return SHORTLIST_COLUMNS.map((column) => ({
    ...column,
    selections: column.slots.map((slot) => ({
      ...slot,
      model: [...models.filter((m) => m.family === slot.family && m.promotionVerified).sort((a, b) => (b.selectionOrder ?? 0) - (a.selectionOrder ?? 0)), ...slot.candidates.map((key) => byKey.get(key))].find((m) => m && m.lifecycle?.status !== 'deprecated' && m.lifecycle?.status !== 'retired') ?? null,
    })),
  }))
}

export function logPricePosition(value: number): number {
  const safeValue = Number.isFinite(value) && value > 0 ? value : SHORTLIST_MIN_PRICE
  const clamped = Math.min(SHORTLIST_MAX_PRICE, Math.max(SHORTLIST_MIN_PRICE, safeValue))
  const minimum = Math.log10(SHORTLIST_MIN_PRICE)
  const maximum = Math.log10(SHORTLIST_MAX_PRICE)
  return ((Math.log10(clamped) - minimum) / (maximum - minimum)) * 100
}

export function shortlistProviderColor(provider: string): string {
  const colors: Record<string, string> = {
    anthropic: '#6f3d63',
    openai: '#174d48',
    google: '#4878c5',
    'x-ai': '#2b2a28',
    mistralai: '#b76037',
    deepseek: '#315f9c',
    moonshotai: '#7c526f',
    qwen: '#47745f',
  }
  return colors[provider] ?? '#6b645e'
}
