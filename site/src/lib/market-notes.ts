import reviewedNotes from '../content/market-notes.json' with { type: 'json' }

export type EditorialLink = { label: string; href: string }

type NoteBase = {
  slug: string
  date: string
  checked: string
  author: string
  title: string
  summary: string
  paragraphs: string[]
  sources: EditorialLink[]
}

export type ModelNote = NoteBase & {
  kind?: 'model'
  modelKey: string
  comparisonModelKey?: string
  calculatorKind?: 'infrastructure'
  calculatorQuote: string
  calculatorTitle: string
  calculatorGuidance: string
}

export type WeeklyEntry = {
  name: string
  date: string
  access: string
  terms: string
  implication: string
  links: EditorialLink[]
}

export type WeeklyReview = NoteBase & {
  kind: 'weekly'
  periodStart: string
  periodEnd: string
  cutoff: string
  editionStatus: 'week-so-far' | 'complete'
  modelKeys: string[]
  releases: WeeklyEntry[]
  updates: Array<{ title: string; text: string; links: EditorialLink[] }>
  watching: Array<{ title: string; text: string; links: EditorialLink[] }>
  takeaways: Array<{ title: string; text: string; links: EditorialLink[] }>
  coverage: string
}

export type MarketNote = ModelNote | WeeklyReview

// Reviewed editorial content has its own dates and survives price-feed revisions.
export const marketNotes: readonly MarketNote[] = (reviewedNotes as MarketNote[]).slice().sort(
  (a, b) => b.date.localeCompare(a.date) || Number(b.kind === 'weekly') - Number(a.kind === 'weekly') || a.slug.localeCompare(b.slug),
)

export function noteKindLabel(note: MarketNote): string {
  return note.kind === 'weekly' ? 'Weekly review' : 'Market note'
}

// A weekly edition leads for two weeks, then yields to fresher reporting.
export function frontPageStories(notes: readonly MarketNote[], now = new Date()) {
  const published = notes.filter((note) => note.date <= now.toISOString().slice(0, 10))
  const weekly = published.find((note) => note.kind === 'weekly'
    && now.getTime() - Date.parse(`${note.periodEnd}T23:59:59Z`) <= 14 * 86_400_000)
  const lead = weekly ?? published[0]
  return { lead, recent: published.filter((note) => note.slug !== lead?.slug).slice(0, 2) }
}

export function marketNotePath(note: Pick<MarketNote, 'slug'>): string {
  return `/notes/${encodeURIComponent(note.slug)}/`
}

export function marketNoteCalculatorPath(note: Pick<ModelNote, 'modelKey' | 'comparisonModelKey' | 'calculatorQuote' | 'calculatorKind'>): string {
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
