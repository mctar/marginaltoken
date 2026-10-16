import reviewedNotes from '../content/market-notes.json' with { type: 'json' }

export type MarketNote = {
  slug: string
  date: string
  checked: string
  author: string
  title: string
  summary: string
  paragraphs: string[]
  modelKey: string
  comparisonModelKey?: string
  calculatorKind?: 'infrastructure'
  calculatorQuote: string
  calculatorTitle: string
  calculatorGuidance: string
  sources: Array<{ label: string; href: string }>
}

// Reviewed editorial content has its own dates and survives price-feed revisions.
export const marketNotes: readonly MarketNote[] = reviewedNotes.map((note): MarketNote => ({
  ...note,
  calculatorKind: note.calculatorKind === 'infrastructure' ? 'infrastructure' : undefined,
})).sort(
  (a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug),
)

export function marketNotePath(note: Pick<MarketNote, 'slug'>): string {
  return `/notes/${encodeURIComponent(note.slug)}/`
}

export function marketNoteCalculatorPath(note: Pick<MarketNote, 'modelKey' | 'comparisonModelKey' | 'calculatorQuote' | 'calculatorKind'>): string {
  if (note.calculatorKind === 'infrastructure') {
    return `/infrastructure/?${new URLSearchParams({ mode: 'custom', model: note.modelKey, quote: note.calculatorQuote })}`
  }
  const params = new URLSearchParams()
  params.append('model', note.modelKey)
  if (note.comparisonModelKey) params.append('model', note.comparisonModelKey)
  params.set('assumptions', JSON.stringify({
    [note.modelKey]: { quote: note.calculatorQuote },
    ...(note.comparisonModelKey ? { [note.comparisonModelKey]: { quote: 'lab:standard' } } : {}),
  }))
  return `/compare/?${params.toString()}`
}
