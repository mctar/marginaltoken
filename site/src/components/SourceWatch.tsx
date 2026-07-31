import type { ProvenanceFeed } from '../lib/types'

export default function SourceWatch({ provenance }: { provenance: ProvenanceFeed | null }) {
  if (!provenance || provenance.status === 'healthy') return null

  const degraded = provenance.degradedProviderCount
  const conflicts = provenance.conflictCount
  const headline = degraded > 0
    ? `${degraded} official ${degraded === 1 ? 'source is' : 'sources are'} using fallback data.`
    : `${conflicts} first-party/OpenRouter price ${conflicts === 1 ? 'field differs' : 'fields differ'}.`
  const detail = degraded > 0
    ? 'Last-good or checked-in rates remain on the tape while automatic verification recovers.'
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
