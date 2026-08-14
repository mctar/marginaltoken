import type { PriceModel } from './types'

export const SHORTLIST_MIN_PRICE = 0.1
export const SHORTLIST_MAX_PRICE = 100

export type ShortlistSlot = {
  id: string
  tier: string
  provider: string
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
// production status have been reviewed. Older keys remain as safe fallbacks.
export const SHORTLIST_COLUMNS: readonly ShortlistColumn[] = [
  {
    id: 'anthropic',
    title: 'Anthropic',
    slots: [
      { id: 'anthropic-fable', tier: 'Fable', provider: 'anthropic', candidates: ['anthropic/claude-fable-5'] },
      { id: 'anthropic-opus', tier: 'Opus', provider: 'anthropic', candidates: ['anthropic/claude-opus-5'] },
      { id: 'anthropic-sonnet', tier: 'Sonnet', provider: 'anthropic', candidates: ['anthropic/claude-sonnet-5'] },
      { id: 'anthropic-haiku', tier: 'Haiku', provider: 'anthropic', candidates: ['anthropic/claude-haiku-4.5'] },
    ],
  },
  {
    id: 'openai',
    title: 'OpenAI',
    slots: [
      { id: 'openai-sol', tier: 'Sol', provider: 'openai', candidates: ['openai/gpt-5.6-sol'] },
      { id: 'openai-terra', tier: 'Terra', provider: 'openai', candidates: ['openai/gpt-5.6-terra'] },
      { id: 'openai-luna', tier: 'Luna', provider: 'openai', candidates: ['openai/gpt-5.6-luna'] },
    ],
  },
  {
    id: 'google',
    title: 'Google',
    slots: [
      {
        id: 'google-pro',
        tier: 'Pro',
        provider: 'google',
        candidates: ['google/gemini-3.1-pro-preview', 'google/gemini-2.5-pro'],
      },
      {
        id: 'google-flash',
        tier: 'Flash',
        provider: 'google',
        candidates: ['google/gemini-3.6-flash', 'google/gemini-3.5-flash'],
      },
      {
        id: 'google-flash-lite',
        tier: 'Flash-Lite',
        provider: 'google',
        candidates: ['google/gemini-3.5-flash-lite', 'google/gemini-3.1-flash-lite', 'google/gemini-2.5-flash-lite'],
      },
    ],
  },
  {
    id: 'other-frontier',
    title: 'Other frontier',
    slots: [
      { id: 'xai-frontier', tier: 'xAI', provider: 'x-ai', candidates: ['x-ai/grok-4.5', 'x-ai/grok-4.3'] },
      {
        id: 'mistral-frontier',
        tier: 'Mistral',
        provider: 'mistralai',
        candidates: ['mistralai/mistral-medium-3.5', 'mistralai/mistral-medium-3-5'],
      },
      {
        id: 'deepseek-frontier',
        tier: 'DeepSeek',
        provider: 'deepseek',
        candidates: ['deepseek/deepseek-v4-pro', 'deepseek/deepseek-v3.2'],
      },
      { id: 'kimi-frontier', tier: 'Kimi', provider: 'moonshotai', candidates: ['moonshotai/kimi-k3', 'moonshotai/kimi-k2.6'] },
      { id: 'qwen-frontier', tier: 'Qwen', provider: 'qwen', candidates: ['qwen/qwen3.7-max', 'qwen/qwen3-max'] },
    ],
  },
]

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
      model: slot.candidates.map((key) => byKey.get(key)).find(Boolean) ?? null,
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
