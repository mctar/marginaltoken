type Meter = { label: string; quantity: number; per: number; usd: number }
type MeteredExample = {
  title: string
  source: string
  checked: string
  detail: string
  boundary: string
  meters: Meter[]
}

// Dated illustrations of specific tariffs, independent of the live text ledger.
export const examples: Record<'voice' | 'images', MeteredExample> = {
  voice: {
    title: 'GPT-Live 1.1 session',
    checked: '2026-11-20',
    source: '/notes/gpt-live-11-active-standby-backend-costs/',
    detail: 'Ten minutes talking and five minutes on standby. Both meters count seconds.',
    boundary:
      'Standby requires paused WebRTC inference. Add any backend model calls and tool fees.',
    meters: [
      { label: 'Active seconds', quantity: 600, per: 60, usd: 0.05 },
      { label: 'Standby seconds', quantity: 300, per: 60, usd: 0.02 },
    ],
  },
  images: {
    title: 'MiniMax H3-Image Standard',
    checked: '2026-11-11',
    source: '/notes/minimax-h3-image-api-pricing-weights-license/',
    detail:
      'Illustrative token usage for an image edit. Replace these counts with the usage returned by your API.',
    boundary:
      'Uses the published Standard list tariff. Resolution and input images affect the metered quantities.',
    meters: [
      { label: 'Text input tokens', quantity: 100, per: 1000000, usd: 2.3 },
      { label: 'Image input tokens', quantity: 4000, per: 1000000, usd: 1.5 },
      { label: 'Image output tokens', quantity: 8000, per: 1000000, usd: 3.8 },
    ],
  },
}

export function readQuantity(text: string) {
  const value = Number(text)
  return text.trim() && Number.isSafeInteger(value) && value >= 0 ? value : null
}

export function meteredTotal(meters: Meter[], values: string[]) {
  if (meters.length !== values.length) return null
  let total = 0
  for (const [i, meter] of meters.entries()) {
    const value = readQuantity(values[i])
    if (value === null) return null
    total += (value * meter.usd) / meter.per
  }
  return total
}
