import { useState } from 'react'
import { profiles, tasks } from '../lib/field-guide'
import { longDate } from '../lib/format'
import { marketNotes, marketNotePath, marketNoteCalculatorPath, noteKindLabel } from '../lib/market-notes'
import { modelPath } from '../lib/models'
import WeeklyReviewBody from '../components/WeeklyReviewBody'

export default function NotesPage({ pathname }: { pathname: string }) {
  const [query, setQuery] = useState('')
  const [topic, setTopic] = useState('')
  const visibleNotes = marketNotes.filter(note => {
    const matchesTopic = !topic || (topic === 'weekly' ? note.kind === 'weekly' :
      profiles.some(profile => profile.note === note.slug && profile.tasks.some(task => task === topic)))
    return matchesTopic && (note.title + ' ' + note.summary).toLowerCase().includes(query.trim().toLowerCase())
  })
  const normalized = pathname.endsWith('/') ? pathname : `${pathname}/`
  if (normalized === '/notes/') {
    return (
      <main id="main" className="notes-page mx-auto max-w-publication px-4 pt-10 sm:px-6 sm:pt-14">
        <p className="section-kicker">Editorial archive</p>
        <h1 className="notes-title">Market notes</h1>
        <p className="notes-intro">Weekly release reviews and short notes on the cost of buying and running AI. Verified changes, practical implications, and the tools to act on them.</p>
        <a className="text-link" href="/feeds/notes.xml">Subscribe via RSS →</a>
        <div className="reader-controls"><label>Search all notes<input type="search" value={query} onChange={e => setQuery(e.target.value)} /></label>
          <label>Reading paths<select value={topic} onChange={e => setTopic(e.target.value)}><option value="">All notes</option><option value="weekly">Weekly reviews</option>
          {tasks.map(t => <option key={t.id} value={t.id}>{t.label} · field guide</option>)}</select></label></div>
        <p role="status">{visibleNotes.length} matching {visibleNotes.length === 1 ? 'note' : 'notes'}</p>
        <ol className="notes-list">
          {visibleNotes.map((note) => (
            <li key={note.slug}>
              <div className="market-note-meta">
                <span className="section-kicker">{noteKindLabel(note)}</span>
                <time dateTime={note.date}>{longDate(note.date)}</time>
                <span>{note.author}</span>
              </div>
              <div>
                <h2><a href={marketNotePath(note)}>{note.title}</a></h2>
                <p>{note.summary}</p>
                <a className="text-link" href={marketNotePath(note)}>Read the note →</a>
              </div>
            </li>
          ))}
        </ol>
      </main>
    )
  }

  const note = marketNotes.find((candidate) => marketNotePath(candidate) === normalized)
  if (!note) {
    return (
      <main id="main" className="notes-page mx-auto max-w-publication px-4 pt-10 sm:px-6 sm:pt-14">
        <h1 className="notes-title">This note could not be found.</h1>
        <a className="text-link" href="/notes/">Browse market notes →</a>
      </main>
    )
  }

  const profile = profiles.find(p => p.note === note.slug)
  return (
    <main id="main" className="notes-page mx-auto max-w-publication px-4 pt-10 sm:px-6 sm:pt-14">
      <article className={`market-note-article${note.kind === 'weekly' ? ' weekly-article' : ''}`}>
        <a className="text-link" href="/notes/">← Market notes</a>
        <header>
          <p className="section-kicker">{noteKindLabel(note)}</p>
          <h1 className="notes-title">{note.title}</h1>
          <p className="notes-intro">{note.summary}</p>
          <div className="market-note-byline">
            <span>{note.author}</span>
            <time dateTime={note.date}>{longDate(note.date)}</time>
          </div>
        </header>
        {note.kind === 'weekly' ? <WeeklyReviewBody note={note} /> : <><div className="market-note-body">
          {note.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </div>
        {note.kind !== 'standalone' && <aside className="market-note-calculator" aria-labelledby="note-calculator-title">
          <h2 id="note-calculator-title">{note.calculatorTitle}</h2>
          <p>{note.calculatorGuidance}</p>
          <div className="market-note-links">
            <a className="text-link" href={marketNoteCalculatorPath(note)}>{note.calculatorKind === 'infrastructure' ? 'Compare rent vs run →' : 'Open the workload calculator →'}</a>
            <a className="text-link" href={modelPath(note.modelKey)}>Model card →</a>
          </div>
        </aside>}</>}
        <div className="reader-links">{profile && <a href={'/explore/?task='+profile.tasks[0]}>Explore models for this task →</a>}
          <a href="/understand/#cost">How to read model costs →</a></div>
        <footer className="market-note-sources">
          <p className="section-kicker">Sources · Checked {longDate(note.checked)}</p>
          <ul>{note.sources.map((source) => <li key={source.href}><a href={source.href}>{source.label}</a></li>)}</ul>
        </footer>
      </article>
    </main>
  )
}
