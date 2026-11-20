import { useState } from 'react'
import { findProfiles, profiles, tasks } from '../lib/field-guide'
import { longDate } from '../lib/format'
import { modelPath } from '../lib/models'
import { marketNotes, marketNotePath } from '../lib/market-notes'

export default function ExplorePage() {
  const params = new URLSearchParams(location.search)
  const [task, setTask] = useState<string>(tasks.find((t) => t.id === params.get('task'))?.id ?? '')
  const [query, setQuery] = useState(params.get('q') ?? '')
  const visible = findProfiles(task, query)
  function filter(nextTask: string, nextQuery: string) {
    setTask(nextTask)
    setQuery(nextQuery)
    const url = new URL(location.href)
    for (const [key, value] of [
      ['task', nextTask],
      ['q', nextQuery],
    ]) {
      if (value) url.searchParams.set(key, value)
      else url.searchParams.delete(key)
    }
    history.replaceState(null, '', url)
  }
  return (
    <main id="main" className="reader-page">
      <header className="reader-heading">
        <h1>Explore models</h1>
        <p>
          Start with a task. These {profiles.length} examples show what you can try through an API,
          download to run yourself, or use either way.
        </p>
      </header>
      <div className="reader-controls">
        <label>
          What do you want to do?
          <select value={task} onChange={(e) => filter(e.target.value, query)}>
            <option value="">All tasks</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Search the examples
          <input
            type="search"
            value={query}
            onChange={(e) => filter(task, e.target.value)}
            placeholder="Model, task or license"
          />
        </label>
      </div>
      <p role="status" className="reader-meta">
        {visible.length} matching {visible.length === 1 ? 'example' : 'examples'}
      </p>
      {!visible.length && (
        <p>
          Try another task or{' '}
          <button className="text-link" onClick={() => filter('', '')}>
            clear the filters
          </button>
          .
        </p>
      )}
      <div className="profile-grid">
        {visible.map((p) => {
          const note = marketNotes.find((n) => n.slug === p.note)
          return (
            <article key={p.id} id={p.id}>
              <p className="reader-meta">{p.access}</p>
              <h2>{p.name}</h2>
              <p>{p.summary}</p>
              <p className="reader-small">{p.terms}</p>
              <div className="reader-links">
                {p.ledgerKey && <a href={modelPath(p.ledgerKey)}>Price card</a>}
                {note && <a href={marketNotePath(note)}>Market note</a>}
                {p.id === 'surya-25' && <a href="/costs/?example=ocr">Estimate cost per page</a>}
                <a href={p.source}>Publisher source</a>
              </div>
              <small>Reviewed {longDate(p.checked)}</small>
            </article>
          )
        })}
      </div>
      <aside className="reader-next">
        <h2>Browse the full price ledger</h2>
        <p>
          Look up a hosted quote, or see which priced models have verified downloadable weights.
        </p>
        <div className="reader-links">
          <a href="/tape/">All priced listings →</a>
          <a href="/open/">Verified open models →</a>
        </div>
      </aside>
    </main>
  )
}
