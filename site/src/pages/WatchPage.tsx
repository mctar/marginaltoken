import { useState } from 'react'
import {
  WATCH_STORAGE,
  parseWatches,
  checkWatch,
  type WorkloadWatch,
} from '../lib/watches'
import { downloadText } from '../lib/imports'
import { money } from './PlanPage'
import type { FeedData } from '../lib/types'
import { modelPath } from '../lib/models'

export default function WatchPage({ data }: { data: FeedData }) {
  const [error, setError] = useState(''),
    [watches, setWatches] = useState<WorkloadWatch[]>(() => {
      try {
        const stored = localStorage.getItem(WATCH_STORAGE)
        return stored ? parseWatches(stored) : []
      } catch {
        return []
      }
    })
  const [status, setStatus] = useState(() => {
    try {
      const stored = localStorage.getItem(WATCH_STORAGE)
      if (stored) parseWatches(stored)
      return ''
    } catch {
      return 'Saved browser data could not be read. Export the stored file for recovery, or clear it explicitly.'
    }
  })
  const persist = (next: WorkloadWatch[]) => {
    try {
      localStorage.setItem(
        WATCH_STORAGE,
        JSON.stringify({ version: 1, watches: next }),
      )
      setWatches(next)
      setError('')
      setStatus('Saved browser watches updated.')
    } catch {
      setError('Browser storage is unavailable; no change was saved.')
    }
  }
  const load = async (file: File) => {
    try {
      if (file.size > 200000)
        throw new Error('Watch file must be at most 200 KB.')
      const imported = parseWatches(await file.text())
      const kept = new Map(watches.map((w) => [w.id, w]))
      for (const w of imported) kept.set(w.id, w)
      if (kept.size > 20) throw new Error('Import would exceed 20 watches.')
      persist([...kept.values()])
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.')
    }
  }
  return (
    <main
      id="main"
      className="plan-page mx-auto max-w-publication px-4 pt-10 sm:px-6 sm:pt-14"
    >
      <header className="page-heading">
        <p className="section-kicker">Your saved decisions</p>
        <h1>Keep an eye on the bill.</h1>
        <p>
          Browser-saved workload baselines, compared with the current price
          file. No account or background email service is required.
        </p>
      </header>
      <section className="plan-panel">
        <a href="/plan/">Create a workload watch in Plan →</a>
        <p className="decision-note">
          Watches stay on this browser and device until you delete them or clear
          browser data. Export to move them. The scenario links may include your
          cost and performance assumptions; share them deliberately.
        </p>
        <button
          className="plan-button"
          onClick={() => {
            try {
              downloadText(
                'marginal-token-watches.json',
                localStorage.getItem(WATCH_STORAGE) ??
                  JSON.stringify({ version: 1, watches }),
                'application/json',
              )
            } catch {
              setError('Could not read browser storage.')
            }
          }}
        >
          Export watches
        </button>
        <label className="decision-select">
          <span>Import watch file · merged by watch ID, at most 20</span>
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void load(file)
              e.target.value = ''
            }}
          />
        </label>
        <button className="plan-button" onClick={() => persist([])}>
          Clear saved watches
        </button>
        <p role="status">{error || status}</p>
        <p>
          Public feeds: <a href="/feeds/notes.xml">Market notes RSS</a> ·{' '}
          <a href="/feeds/prices.xml">Price changes RSS</a> ·{' '}
          <a href="/feeds/lifecycle.xml">Listings & lifecycle RSS</a>. Model
          cards link to individual model feeds.
        </p>
      </section>
      {!watches.length && (
        <section className="plan-panel">
          <h2>No readable watches saved.</h2>
          <p>
            Open Plan or Compare, set a workload, and choose “Watch this
            workload”.
          </p>
        </section>
      )}
      {watches.map((w) => {
        const result = checkWatch(w, data)
        return (
          <section key={w.id} className="plan-panel">
            <p className="section-kicker">
              Saved {w.savedAt.slice(0, 10)} · Price file {data.prices.asOf}
            </p>
            <h2>{w.name}</h2>
            <p>
              {w.workload.calls.toLocaleString()} requests ·{' '}
              {w.workload.inputTokens.toLocaleString()} input +{' '}
              {w.workload.outputTokens.toLocaleString()} answer +{' '}
              {w.workload.reasoningTokens.toLocaleString()} additional reasoning
              tokens / request.
            </p>
            {result.changes.length ? (
              <ul>
                {result.changes.map((v) => (
                  <li key={v}>{v}</li>
                ))}
              </ul>
            ) : (
              <p>
                No quoted price, lifecycle or alternative selection changes
                since this baseline.
              </p>
            )}
            <div className="plan-table-wrap">
              <table className="plan-table">
                <thead>
                  <tr>
                    <th>Model / quote</th>
                    <th>Saved API / month</th>
                    <th>Current API / month</th>
                    <th>Current status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.models.map(({ old, current }) => (
                    <tr key={old.key}>
                      <th>
                        <a href={modelPath(old.key)}>{old.display}</a>
                        <small>{old.quote}</small>
                      </th>
                      <td>
                        {old.monthly === null
                          ? 'Incomplete'
                          : money(old.monthly)}
                      </td>
                      <td>
                        {current?.monthly == null
                          ? 'Incomplete / unavailable'
                          : money(current.monthly)}
                      </td>
                      <td>
                        {current
                          ? `${current.lifecycle} · ${current.stage}`
                          : 'Unavailable or unverified'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3>Lowest-cost alternatives meeting your saved requirements</h3>
            <p className="decision-note">
              Required context: {w.requirements.context.toLocaleString()} tokens
              {w.requirements.weights ? ' · Verified weights' : ''}
              {w.requirements.tools ? ' · Tools' : ''}
              {w.requirements.structured ? ' · Structured output' : ''}
              {w.requirements.reasoning ? ' · Reasoning API' : ''}. Capability
              flags and prices do not establish equal output quality.
            </p>
            {result.alternatives.length ? (
              <ul>
                {result.alternatives.map((r) => (
                  <li key={r.model.key}>
                    <a href={modelPath(r.model.key)}>{r.model.display}</a> ·{' '}
                    {money(r.bill.monthlyTotal)} / month · {r.quote.plan.label}
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                No complete verified-price alternative meets these requirements.
              </p>
            )}
            <a href={w.path}>Reopen saved scenario →</a>
            <button
              className="plan-button"
              onClick={() => persist(watches.filter((v) => v.id !== w.id))}
            >
              Remove {w.name}
            </button>
          </section>
        )
      })}
    </main>
  )
}
