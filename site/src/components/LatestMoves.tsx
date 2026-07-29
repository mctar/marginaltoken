import { longDate, price } from '../lib/format'
import type { ChangeEvent } from '../lib/types'

function eventTone(event: ChangeEvent): string {
  if (event.type !== 'price') return 'neutral'
  return event.to < event.from ? 'cut' : 'rise'
}

function eventText(event: ChangeEvent): string {
  if (event.type === 'price') {
    const side = event.field === 'input_mtok' ? 'Input' : 'Output'
    const verb = event.to < event.from ? 'fell' : 'rose'
    const percent = event.pct === null ? '' : ` ${Math.abs(event.pct).toFixed(1)}%`
    return `${event.display}: ${side.toLowerCase()} ${verb}${percent}, from ${price(event.from)} to ${price(event.to)} per million tokens.`
  }
  if (event.type === 'listed') return `${event.display} entered the tape.`
  if (event.type === 'delisted') return `${event.display} left the tape.`
  return 'The index basket was rebalanced.'
}

export default function LatestMoves({ events, baseDate }: { events: ChangeEvent[]; baseDate: string }) {
  return (
    <section aria-labelledby="latest-moves-title">
      <div className="section-kicker">Cut log</div>
      <h2 id="latest-moves-title" className="section-title">
        Latest moves
      </h2>
      {events.length ? (
        <ol className="move-list">
          {events.slice(0, 5).map((event, index) => (
            <li key={`${event.date}-${event.key}-${event.field}-${index}`} className={`move-item ${eventTone(event)}`}>
              <time dateTime={event.date}>{longDate(event.date)}</time>
              <p>{eventText(event)}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="empty-note">No price changes have been recorded since the index began on {longDate(baseDate)}.</p>
      )}
    </section>
  )
}
