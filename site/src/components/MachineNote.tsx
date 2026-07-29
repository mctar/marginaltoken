import type { BriefFeed } from '../lib/types'

type Props = {
  brief: BriefFeed | null
  revision: string
}

export default function MachineNote({ brief, revision }: Props) {
  if (!brief || brief.generatedAt !== revision) return null

  return (
    <section className="machine-note" aria-labelledby="machine-note-title">
      <div className="machine-note-label">
        <p className="section-kicker">Machine note</p>
        <span>{brief.sourceEventCount} verified {brief.sourceEventCount === 1 ? 'event' : 'events'}</span>
      </div>
      <div className="machine-note-copy">
        <h2 id="machine-note-title">{brief.headline}</h2>
        <p>{brief.note}</p>
        <div className="machine-note-credit">
          <span>Generated locally on hugin with Gemma 4 26B.</span>
        </div>
      </div>
    </section>
  )
}
