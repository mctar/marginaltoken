import type { ProvenanceFeed } from '../lib/types'
import { providerName } from '../lib/format'

export default function SourceWatch({ provenance }: { provenance: ProvenanceFeed | null }) {
  if (!provenance || provenance.status === 'healthy') return null

  const degraded = provenance.degradedProviderCount
  const conflicts = provenance.conflictCount
  const reviews = provenance.reviewCandidateCount ?? provenance.reviewCandidates?.length ?? 0
  const affected = provenance.providers.filter((source) => !['fresh', 'skipped'].includes(source.status))
  const fallbackModels = affected.reduce((total, source) => total + source.modelCount - (source.freshModelCount ?? 0), 0)
  const headline = degraded > 0
    ? `${fallbackModels} model ${fallbackModels === 1 ? 'price needs' : 'prices need'} verification (${affected.map((source) => providerName(source.provider)).join(', ')}).`
    : reviews > 0
      ? `${reviews} new ${reviews === 1 ? 'model' : 'models'} from tracked first parties ${reviews === 1 ? 'needs' : 'need'} review.`
      : `${conflicts} first-party/OpenRouter price ${conflicts === 1 ? 'field differs' : 'fields differ'}.`
  const detail = degraded > 0
    ? `Only the affected models use dated fallback rates; other models continue to verify independently.${reviews > 0 ? ` ${reviews} OpenRouter discovery ${reviews === 1 ? 'signal is' : 'signals are'} also awaiting review.` : ''}`
    : reviews > 0
      ? 'OpenRouter is the discovery signal; official pricing must be verified before first-party promotion.'
      : 'The verified first-party rate remains authoritative; the disagreement is published for review.'

  return (
    <aside className={`source-watch ${provenance.status}`} aria-label="Price source status">
      <div>
        <span>Source watch</span>
        <strong>{headline}</strong>
        <p>{detail}</p>
      </div>
      <a href="/methodology/#source-health">Inspect sources →</a>
    </aside>
  )
}
