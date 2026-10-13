import { useState } from 'react'
import {
  WATCH_STORAGE,
  parseWatches,
  safeScenarioPath,
  snapshot,
  eligibleAlternatives,
  type WatchRequirements,
  type WorkloadWatch,
} from '../lib/watches'
import type { FeedData, PriceModel } from '../lib/types'
import type { BillWorkload } from '../lib/economics'

export default function SaveWatch({
  data,
  models,
  quotes,
  workload,
  path,
}: {
  data: FeedData
  models: PriceModel[]
  quotes: Record<string, string>
  workload: BillWorkload
  path: () => string
}) {
  const [name, setName] = useState('My workload'),
    [status, setStatus] = useState('')
  const [requirements, setRequirements] = useState<WatchRequirements>({
    context:
      workload.inputTokens + workload.outputTokens + workload.reasoningTokens,
    tools: false,
    structured: false,
    reasoning: false,
    weights: false,
  })
  const save = () => {
    try {
      if (!name.trim() || name.length > 100)
        throw new Error('Give this workload a name of at most 100 characters.')
      const stored = localStorage.getItem(WATCH_STORAGE),
        watches = stored ? parseWatches(stored) : []
      if (watches.length >= 20)
        throw new Error(
          'You have 20 watches. Remove one before saving another.',
        )
      const w: WorkloadWatch = {
        version: 1,
        id: crypto.randomUUID(),
        name: name.trim(),
        savedAt: new Date().toISOString(),
        path: safeScenarioPath(path()),
        workload: { ...workload },
        requirements: { ...requirements },
        models: [...new Map(models.map((m) => [m.key, m])).values()]
          .slice(0, 4)
          .map((m) => snapshot(m, quotes[m.key] ?? 'tape', workload, data)),
        alternatives: eligibleAlternatives(
          data,
          workload,
          requirements,
          models.map((m) => m.key),
        ).map((r) => r.model.key),
      }
      const text = JSON.stringify({ version: 1, watches: [...watches, w] })
      parseWatches(text)
      localStorage.setItem(WATCH_STORAGE, text)
      setStatus(
        'Saved in this browser. Open Saved watches to compare with future feeds.',
      )
    } catch (e) {
      setStatus(
        e instanceof Error ? e.message : 'Browser storage is unavailable.',
      )
    }
  }
  return (
    <details className="plan-panel save-watch">
      <summary>Watch this workload</summary>
      <p>
        Save published quote baselines and this scenario in your browser.
        Returning visits compare price, lifecycle and eligible alternatives.
        Imported CSVs are not stored; manual rate, quality and retry assumptions
        remain in the scenario link, while this watch checks published
        single-attempt API charges.
      </p>
      <label className="decision-select">
        <span>Watch name</span>
        <input
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="decision-select">
        <span>Required context (tokens)</span>
        <input
          type="number"
          min="0"
          value={requirements.context}
          onChange={(e) =>
            setRequirements({
              ...requirements,
              context: Math.max(0, Number(e.target.value) || 0),
            })
          }
        />
      </label>
      <div className="plan-fields">
        {(
          [
            ['tools', 'Tool calling'],
            ['structured', 'Structured output'],
            ['reasoning', 'Reasoning API support'],
            ['weights', 'Verified downloadable weights'],
          ] as [keyof Omit<WatchRequirements, 'context'>, string][]
        ).map(([key, label]) => (
          <label key={key} className="plan-check">
            <input
              type="checkbox"
              checked={requirements[key]}
              onChange={(e) =>
                setRequirements({ ...requirements, [key]: e.target.checked })
              }
            />
            {label}
          </label>
        ))}
      </div>
      <button className="plan-button" onClick={save}>
        Save workload watch
      </button>
      <a href="/watch/">Saved watches →</a>
      <p role="status">{status}</p>
    </details>
  )
}
