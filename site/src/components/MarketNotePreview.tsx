import { longDate } from '../lib/format'
import { marketNotes, marketNotePath } from '../lib/market-notes'

export default function MarketNotePreview() {
  const note = marketNotes[0]
  if (!note) return null

  return (
    <aside className="market-note-preview" aria-labelledby="market-note-preview-title">
      <div className="market-note-meta">
        <p className="section-kicker">Market notes</p>
        <time dateTime={note.date}>{longDate(note.date)}</time>
        <span>{note.author}</span>
      </div>
      <div>
        <h2 id="market-note-preview-title"><a href={marketNotePath(note)}>{note.title}</a></h2>
        <p>{note.summary}</p>
        <div className="market-note-links">
          <a className="text-link" href={marketNotePath(note)}>Read the note →</a>
          <a className="text-link" href="/notes/">All market notes →</a>
        </div>
      </div>
    </aside>
  )
}
