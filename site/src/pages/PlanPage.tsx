import SaveWatch from '../components/SaveWatch'
import { useState } from 'react'
import { quotesFor, type Quote } from '../lib/quotes'
import {
  planningWorkload,
  quoteBill,
  calculateFleet,
  wilson,
  type FleetAssumptions,
} from '../lib/planning'
import {
  importUsage,
  importEvaluations,
  repriceUsage,
  downloadText,
  csvText,
  MAX_IMPORT_BYTES,
  type UsageRow,
  type UsageFormat,
  type Evaluation,
} from '../lib/imports'
import type { FeedData, PriceModel } from '../lib/types'
import type { BillWorkload } from '../lib/economics'
import { modelPath } from '../lib/models'

export const money = (n: number) =>
  '$' +
  n.toLocaleString('en-US', n > 0 && n < 0.01 ? {maximumSignificantDigits:4} : {
    maximumFractionDigits: n < 1 ? 4 : 2, minimumFractionDigits: 2,
  })
export function NumberInput({
  label,
  value,
  onChange,
  max,
}: {
  label: string
  value: number
  onChange: (n: number) => void
  max?: number
}) {
  return (
    <label className="decision-select">
      <span>{label}</span>
      <input
        type="number"
        min="0"
        max={max}
        step="any"
        value={value}
        onChange={(e) =>
          onChange(
            Math.min(max ?? 1e15, Math.max(0, Number(e.target.value) || 0)),
          )
        }
      />
    </label>
  )
}
function ModelQuote({
  label,
  models,
  model,
  quote,
  onModel,
  onQuote,
  data,
}: {
  label: string
  models: PriceModel[]
  model: PriceModel
  quote: Quote
  onModel: (s: string) => void
  onQuote: (s: string) => void
  data: FeedData
}) {
  return (
    <div className="plan-quote">
      <label className="decision-select">
        <span>{label}</span>
        <select value={model.key} onChange={(e) => onModel(e.target.value)}>
          {models.map((m) => (
            <option key={m.key} value={m.key}>
              {m.display} · {m.key}
            </option>
          ))}
        </select>
      </label>
      <label className="decision-select">
        <span>Published quote</span>
        <select value={quote.id} onChange={(e) => onQuote(e.target.value)}>
          {quotesFor(model, data.decisions ?? null, data.offers ?? null).map(
            (q) => (
              <option key={q.id} value={q.id}>
                {q.plan.label}
              </option>
            ),
          )}
        </select>
      </label>
      <p className="decision-note">
        {money(quote.plan.input_mtok)} uncached input ·{' '}
        {money(quote.plan.output_mtok)} output / million tokens ·{' '}
        <a href={quote.sourceUrl} target="_blank" rel="noreferrer">
          {quote.source}
        </a>{' '}
        · {quote.verifiedAt?.slice(0, 10) ?? model.checked ?? data.prices.asOf}{' '}
        · <a href={modelPath(model.key)}>Model card</a>
      </p>
      {quote.plan.notes && <p className="decision-note">{quote.plan.notes}</p>}
    </div>
  )
}
export function WorkloadInputs({
  value,
  onChange,
}: {
  value: BillWorkload
  onChange: (w: BillWorkload) => void
}) {
  const labels: [keyof BillWorkload, string][] = [
    ['calls', 'Requests / month'],
    ['inputTokens', 'Inclusive input tokens / request'],
    ['outputTokens', 'Answer tokens / request'],
    ['reasoningTokens', 'Additional reasoning tokens / request'],
    ['cacheReadPct', 'Input served from cache (%)'],
    ['cacheWritePct', 'Input written to cache (%)'],
    ['reviewHourly', 'Human review rate ($ / hour)'],
  ]
  return (
    <div className="plan-fields">
      {labels.map(([key, label]) => (
        <NumberInput
          key={key}
          label={label}
          value={value[key]}
          max={key.endsWith('Pct') ? 100 : undefined}
          onChange={(n) => onChange({ ...value, [key]: n })}
        />
      ))}
    </div>
  )
}
function ImportBox({
  label,
  onRead,
  status,
}: {
  label: string
  onRead: (s: string) => void
  status: string
}) {
  const [text, setText] = useState('')
  const [fileError, setFileError] = useState('')
  return (
    <div className="plan-import">
      <label className="decision-select">
        <span>{label} CSV · read locally, at most 2 MiB</span>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (file) {
              if (file.size > MAX_IMPORT_BYTES)
                setFileError('File exceeds 2 MiB.')
              else {
                setFileError('')
                try {
                  onRead(await file.text())
                } catch {
                  setFileError('Could not read this local file.')
                }
              }
            }
            e.target.value = ''
          }}
        />
      </label>
      <details>
        <summary>Or paste CSV</summary>
        <label className="decision-select">
          <span>{label} CSV text</span>
          <textarea
            rows={7}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <button className="plan-button" onClick={() => onRead(text)}>
          Read pasted CSV
        </button>
      </details>
      <p role="status" className="decision-note">
        {fileError || status}
      </p>
    </div>
  )
}
function initialNumber(p: URLSearchParams, k: string, fallback: number) {
  const v = p.get(k)
  return v !== null && v.trim() && Number.isFinite(Number(v)) && Number(v) >= 0
    ? Math.min(1e15, Number(v))
    : fallback
}
export default function PlanPage({ data }: { data: FeedData }) {
  const params = new URLSearchParams(window.location.search)
  const models = [...data.prices.models].sort((a, b) =>
    a.display.localeCompare(b.display),
  )
  const [tab, setTab] = useState(
    ['fleet', 'usage', 'budget'].includes(params.get('tab') ?? '')
      ? params.get('tab')!
      : 'fleet',
  )
  const [workload, setWorkload] = useState<BillWorkload>(
    () =>
      Object.fromEntries(
        Object.entries(planningWorkload).map(([k, v]) => [
          k,
          initialNumber(params, k, v),
        ]),
      ) as BillWorkload,
  )
  const [firstKey, setFirst] = useState(
    params.get('first') ??
      models.find((m) => m.key === 'anthropic/claude-haiku-5.5')?.key ??
      models[0]?.key,
  )
  const [secondKey, setSecond] = useState(
    params.get('second') ??
      data.meta.basket.find((k) => k.startsWith('openai/')) ??
      models[1]?.key,
  )
  const [quoteIds, setQuotes] = useState<Record<string, string>>({
    [firstKey]: params.get('firstQuote') ?? '',
    [secondKey]: params.get('secondQuote') ?? '',
  })
  const [fleet, setFleet] = useState<FleetAssumptions>(() => ({
    escalationPct: initialNumber(params, 'escalationPct', 20),
    firstAcceptedPct: initialNumber(params, 'firstAcceptedPct', 80),
    secondAcceptedPct: initialNumber(params, 'secondAcceptedPct', 95),
    firstReviewPct: initialNumber(params, 'firstReviewPct', 0),
    secondReviewPct: initialNumber(params, 'secondReviewPct', 10),
    reviewMinutes: initialNumber(params, 'reviewMinutes', 2),
  }))
  const [format, setFormat] = useState<UsageFormat>('normalized'),
    [usage, setUsage] = useState<UsageRow[]>([]),
    [usageStatus, setUsageStatus] = useState(
      'No usage imported. Counts stay in this browser tab.',
    )
  const [evals, setEvals] = useState<Evaluation[]>([]),
    [evalStatus, setEvalStatus] = useState(
      'No evaluations imported. Price alone says nothing about acceptance.',
    )
  const [group, setGroup] = useState(''),
    [budget, setBudget] = useState(1000),
    [threshold, setThreshold] = useState(80),
    [minimum, setMinimum] = useState(100),
    [conservative, setConservative] = useState(false)
  const [message, setMessage] = useState('')
  if (!models.length) return <main id="main">No priced models available.</main>
  const first = models.find((m) => m.key === firstKey) ?? models[0],
    second = models.find((m) => m.key === secondKey) ?? models[0]
  const quoteFor = (m: PriceModel) => {
    const qs = quotesFor(m, data.decisions ?? null, data.offers ?? null)
    return (
      qs.find((q) => q.id === quoteIds[m.key]) ??
      qs.find((q) => q.id === 'lab:standard') ??
      qs[0]
    )
  }
  const firstQuote = quoteFor(first),
    secondQuote = quoteFor(second)
  const firstBill = quoteBill(first, firstQuote, workload),
    secondBill = quoteBill(second, secondQuote, workload)
  const result = calculateFleet(firstBill, secondBill, workload, fleet)
  const chooseQuote = (key: string, id: string) =>
    setQuotes((previous) => ({ ...previous, [key]: id }))
  const loadUsage = (text: string) => {
    try {
      const rows = importUsage(text, format)
      setUsage(rows)
      setUsageStatus(
        `${rows.length} aggregate buckets imported. Repricing estimates the same token counts, not equal output quality.`,
      )
    } catch (e) {
      setUsageStatus(e instanceof Error ? e.message : 'Import failed.')
    }
  }
  const loadEvals = (text: string) => {
    try {
      const rows = importEvaluations(text)
      setEvals(rows)
      setGroup(rows[0].group)
      setEvalStatus(
        `${rows.length} measured configurations imported. Confirm settings and token usage are comparable for your task.`,
      )
    } catch (e) {
      setEvalStatus(e instanceof Error ? e.message : 'Import failed.')
    }
  }
  const groups = [
    ...new Map(
      evals.map((r) => [r.group, `${r.task} · ${r.suite} ${r.version}`]),
    ).entries(),
  ]
  const ranked = evals
    .filter((e) => e.group === group)
    .map((e) => {
      const model = models.find((m) => m.key === e.model)
      const bill = model ? quoteBill(model, quoteFor(model), workload) : null
      const interval = wilson(e.accepted, e.total)
      const quality = conservative
        ? interval.low * 100
        : (e.accepted / e.total) * 100
      return {
        e,
        model,
        bill,
        interval,
        qualifies: Boolean(
          bill?.complete &&
          bill.monthlyTotal <= budget &&
          quality >= threshold &&
          e.total >= minimum,
        ),
      }
    })
    .sort(
      (a, b) =>
        Number(b.qualifies) - Number(a.qualifies) ||
        (a.bill?.monthlyTotal ?? Infinity) - (b.bill?.monthlyTotal ?? Infinity),
    )
  const template = () => {
    const headers =
      format === 'normalized'
        ? [
            'model',
            'period',
            'requests',
            'input_tokens',
            'output_tokens',
            'reasoning_tokens',
            'cache_read_tokens',
            'cache_write_tokens',
            'min_prompt_tokens',
            'max_prompt_tokens',
            'quote',
            'cache_duration',
          ]
        : format === 'openai'
          ? [
              'model',
              'period',
              'num_model_requests',
              'input_tokens',
              'output_tokens',
              'reasoning_tokens',
              'input_cached_tokens',
              'input_cache_write_tokens',
              'min_prompt_tokens',
              'max_prompt_tokens',
              'quote',
              'cache_duration',
            ]
          : [
              'model',
              'period',
              'num_model_requests',
              'input_tokens',
              'output_tokens',
              'cache_read_input_tokens',
              'cache_creation_input_tokens',
              'min_prompt_tokens',
              'max_prompt_tokens',
              'quote',
              'cache_duration',
            ]
    downloadText(`marginal-token-usage-${format}.csv`, csvText([headers]))
  }
  const usageTotals = [null, first, second].map((target) => {
    const bills = usage.map((row) => {
      const m =
        target ?? models.find((candidate) => candidate.key === row.model)
      if (!m) return null
      const qs = quotesFor(m, data.decisions ?? null, data.offers ?? null)
      const q =
        !target && row.quote
          ? qs.find((candidate) => candidate.id === row.quote)
          : quoteFor(m)
      return q ? repriceUsage(row, m, q) : null
    })
    return bills.every((bill) => bill?.complete)
      ? bills.reduce((sum, bill) => sum + (bill?.monthlyTotal ?? 0), 0)
      : null
  })
  const fleetPath = () => {
    const p = new URLSearchParams({
      tab: 'fleet',
      first: first.key,
      second: second.key,
      firstQuote: firstQuote.id,
      secondQuote: secondQuote.id,
    })
    for (const [k, v] of Object.entries({ ...workload, ...fleet }))
      p.set(k, String(v))
    return '/plan/?' + p
  }
  const share = () => {
    window.history.replaceState(null, '', fleetPath())
    navigator.clipboard
      ?.writeText(window.location.href)
      .then(() => setMessage('Scenario link copied.'))
      .catch(() => setMessage('Scenario is in the address bar.'))
  }

  return (
    <main
      id="main"
      className="plan-page mx-auto max-w-publication px-4 pt-10 sm:px-6 sm:pt-14"
    >
      <header className="page-heading">
        <p className="section-kicker">Plan your workload</p>
        <h1>What should you run?</h1>
        <p>
          Model a mixed fleet, reprice actual usage, or find measured capability
          within a budget.
        </p>
      </header>
      <nav className="plan-tabs" aria-label="Planning tools">
        {[
          ['fleet', 'Mixed fleet'],
          ['usage', 'Your usage'],
          ['budget', 'Capability & budget'],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-pressed={tab === id}
            onClick={() => {
              setTab(id)
              setMessage('')
            }}
          >
            {label}
          </button>
        ))}
        <a href="/watch/">Saved watches</a>
      </nav>
      {tab === 'fleet' && (
        <>
          <section className="plan-panel">
            <h2>A first pass, then escalation</h2>
            <p>
              Every request pays for the first attempt. Escalated requests also
              pay for a second attempt. The entered acceptance rates are
              conditional: first results you keep, and second results after
              escalation.
            </p>
            <div className="plan-columns">
              <ModelQuote
                label="First-pass model"
                models={models}
                model={first}
                quote={firstQuote}
                onModel={setFirst}
                onQuote={(id) => chooseQuote(first.key, id)}
                data={data}
              />
              <ModelQuote
                label="Escalation model"
                models={models}
                model={second}
                quote={secondQuote}
                onModel={setSecond}
                onQuote={(id) => chooseQuote(second.key, id)}
                data={data}
              />
            </div>
            <WorkloadInputs value={workload} onChange={setWorkload} />
            <p className="decision-note">
              Both attempts use the token counts above. Escalation prompts with
              more context need their own scenario. Acceptance and review
              defaults below are illustrative assumptions.
            </p>
            <div className="plan-fields">
              {(
                [
                  ['escalationPct', 'Requests escalated (%)'],
                  ['firstAcceptedPct', 'Kept first results accepted (%)'],
                  ['secondAcceptedPct', 'Escalated results accepted (%)'],
                  ['firstReviewPct', 'First attempts reviewed (%)'],
                  ['secondReviewPct', 'Second attempts reviewed (%)'],
                  ['reviewMinutes', 'Minutes per reviewed attempt'],
                ] as [keyof FleetAssumptions, string][]
              ).map(([key, label]) => (
                <NumberInput
                  key={key}
                  label={label}
                  value={fleet[key]}
                  max={key.endsWith('Pct') ? 100 : undefined}
                  onChange={(n) => setFleet({ ...fleet, [key]: n })}
                />
              ))}
            </div>
          </section>
          <section className="plan-panel" aria-live="polite">
            <h2>
              {result.complete
                ? money(result.total) + ' / month'
                : 'Estimate incomplete'}
            </h2>
            {!result.complete && (
              <ul>
                {[...new Set(result.problems)].map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            <div className="plan-metrics">
              <div>
                <span>API attempts</span>
                <strong>
                  {workload.calls.toLocaleString()} +{' '}
                  {result.escalated.toLocaleString()}
                </strong>
                <small>
                  {result.complete
                    ? money(result.api) + ' API / month'
                    : 'Incomplete API estimate'}
                </small>
              </div>
              <div>
                <span>Human review</span>
                <strong>{result.complete ? money(result.review) : '—'}</strong>
              </div>
              <div>
                <span>Accepted tasks</span>
                <strong>
                  {result.complete ? result.accepted.toLocaleString() : '—'}
                </strong>
              </div>
              <div>
                <span>Cost / accepted task</span>
                <strong>
                  {result.complete && result.costPerSuccess !== null
                    ? money(result.costPerSuccess)
                    : 'No finite estimate'}
                </strong>
              </div>
            </div>
            <h3>Escalation sensitivity</h3>
            <div className="plan-table-wrap">
              <table className="plan-table">
                <thead>
                  <tr>
                    <th>Escalated</th>
                    <th>Monthly cost</th>
                    <th>Accepted tasks</th>
                    <th>Cost / accepted task</th>
                  </tr>
                </thead>
                <tbody>
                  {[0, 10, 25, 50, 100].map((pct) => {
                    const r = calculateFleet(firstBill, secondBill, workload, {
                      ...fleet,
                      escalationPct: pct,
                    })
                    return (
                      <tr key={pct}>
                        <th>{pct}%</th>
                        <td>{r.complete ? money(r.total) : 'Incomplete'}</td>
                        <td>
                          {r.complete ? r.accepted.toLocaleString() : '—'}
                        </td>
                        <td>
                          {r.complete && r.costPerSuccess !== null
                            ? money(r.costPerSuccess)
                            : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <button className="plan-button" onClick={share}>
              Copy scenario link
            </button>
            <p role="status">{message}</p>
          </section>
        </>
      )}
      {tab === 'usage' && (
        <>
          <section className="plan-panel">
            <h2>Reprice your aggregate usage</h2>
            <label className="decision-select">
              <span>Token convention</span>
              <select
                value={format}
                onChange={(e) => {
                  setFormat(e.target.value as UsageFormat)
                  setUsage([])
                  setUsageStatus(
                    'Format changed. Import counts using the selected convention.',
                  )
                }}
              >
                <option value="normalized">
                  Normalized · inclusive input, answer-only output
                </option>
                <option value="openai">
                  OpenAI · inclusive input and output
                </option>
                <option value="anthropic">
                  Anthropic · uncached input, inclusive output
                </option>
              </select>
            </label>
            <p>
              Use text-token aggregates, with one row per exact model, period
              and prompt band. Flatten provider exports into the template;
              supply request counts and split long-context buckets. Audio,
              images, cache storage and tool fees require separate billing and
              are outside this import.
            </p>
            <p className="decision-note">
              Normalized input includes cache reads and writes; output excludes
              additional reasoning. OpenAI output includes reasoning, which we
              subtract before charging once. Anthropic input excludes cache
              usage, which we add; its output already includes thinking. Missing
              optional counts mean zero, so include them when used. Cache writes
              default to five minutes; use cache_duration=1h for one-hour
              writes.{' '}
              <a
                href="https://developers.openai.com/api/docs/guides/agents-api/observability"
                target="_blank"
                rel="noreferrer"
              >
                OpenAI conventions
              </a>{' '}
              ·{' '}
              <a
                href="https://platform.claude.com/docs/en/build-with-claude/prompt-caching"
                target="_blank"
                rel="noreferrer"
              >
                Anthropic conventions
              </a>
            </p>
            <button className="plan-button" onClick={template}>
              Download {format} template
            </button>
            <ImportBox
              label="Aggregate usage"
              onRead={loadUsage}
              status={usageStatus}
            />
            <div className="plan-columns">
              <ModelQuote
                label="Alternative A"
                models={models}
                model={first}
                quote={firstQuote}
                onModel={setFirst}
                onQuote={(id) => chooseQuote(first.key, id)}
                data={data}
              />
              <ModelQuote
                label="Alternative B"
                models={models}
                model={second}
                quote={secondQuote}
                onModel={setSecond}
                onQuote={(id) => chooseQuote(second.key, id)}
                data={data}
              />
            </div>
          </section>
          {usage.length > 0 && (
            <section className="plan-panel">
              <h2>Current quotes for the imported volume</h2>
              <div className="plan-table-wrap">
                <table className="plan-table">
                  <thead>
                    <tr>
                      <th>Source model / period</th>
                      <th>Requests</th>
                      <th>Original, repriced today</th>
                      <th>{first.display}</th>
                      <th>{second.display}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.map((row, i) => (
                      <tr key={i}>
                        <th>
                          {row.model}
                          <small>{row.period || 'Period unspecified'}</small>
                        </th>
                        <td>{row.requests.toLocaleString()}</td>
                        {[
                          models.find((m) => m.key === row.model),
                          first,
                          second,
                        ].map((m, j) => {
                          const qs = m
                            ? quotesFor(
                                m,
                                data.decisions ?? null,
                                data.offers ?? null,
                              )
                            : []
                          const q = m
                            ? j === 0 && row.quote
                              ? qs.find((v) => v.id === row.quote)
                              : quoteFor(m)
                            : undefined
                          const r = m && q ? repriceUsage(row, m, q) : null
                          return (
                            <td key={j}>
                              {r?.complete
                                ? money(r.monthlyTotal)
                                : 'Incomplete'}
                              <small>
                                {!r
                                  ? 'Model or quote is unavailable; map to an exact ledger key.'
                                  : r.problems.join(' ') || q?.plan.label}
                              </small>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th>Total for imported periods</th>
                      <td>
                        {usage
                          .reduce((sum, r) => sum + r.requests, 0)
                          .toLocaleString()}
                      </td>
                      {usageTotals.map((total, i) => (
                        <td key={i}>
                          {total === null ? 'Incomplete' : money(total)}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="decision-note">
                This is a rate comparison using fixed aggregate tokens.
                Different tokenizers, retries and output lengths can change the
                bill. Per-request context fit cannot be proved from averages
                alone.
              </p>
              <button
                className="plan-button"
                onClick={() => {
                  setUsage([])
                  setUsageStatus('Imported counts cleared.')
                }}
              >
                Clear imported usage
              </button>
            </section>
          )}
        </>
      )}
      {tab === 'budget' && (
        <>
          <section className="plan-panel">
            <h2>Measured capability, priced for your workload</h2>
            <p>
              Import accepted and total task counts for exact model IDs and a
              named evaluation version. Only the selected task and suite version
              enter the comparison. Settings and provenance remain visible.
            </p>
            <button
              className="plan-button"
              onClick={() =>
                downloadText(
                  'marginal-token-evaluations.csv',
                  csvText([
                    [
                      'model',
                      'task',
                      'suite',
                      'version',
                      'setting',
                      'accepted',
                      'total',
                      'date',
                      'source',
                    ],
                  ]),
                )
              }
            >
              Download evaluation template
            </button>
            <ImportBox
              label="Evaluation results"
              onRead={loadEvals}
              status={evalStatus}
            />
            <WorkloadInputs value={workload} onChange={setWorkload} />
            <div className="plan-fields">
              <NumberInput
                label="Monthly API budget ($)"
                value={budget}
                onChange={setBudget}
              />
              <NumberInput
                label="Minimum acceptance (%)"
                value={threshold}
                max={100}
                onChange={setThreshold}
              />
              <NumberInput
                label="Minimum evaluated tasks"
                value={minimum}
                onChange={(n) => setMinimum(Math.floor(n))}
              />
            </div>
            <label className="plan-check">
              <input
                type="checkbox"
                checked={conservative}
                onChange={(e) => setConservative(e.target.checked)}
              />{' '}
              Apply threshold to the lower 95% Wilson confidence bound
            </label>
          </section>
          {evals.length > 0 && (
            <section className="plan-panel">
              <label className="decision-select">
                <span>Comparable task / suite version</span>
                <select
                  value={group}
                  onChange={(e) => setGroup(e.target.value)}
                >
                  {groups.map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="plan-table-wrap">
                <table className="plan-table">
                  <thead>
                    <tr>
                      <th>Model / measured setting</th>
                      <th>Accepted / total</th>
                      <th>Acceptance · 95% interval</th>
                      <th>Monthly quote</th>
                      <th>Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranked.map(({ e, model, bill, interval, qualifies }) => (
                      <tr key={e.model}>
                        <th>
                          {model ? (
                            <a href={modelPath(model.key)}>{model.display}</a>
                          ) : (
                            e.model
                          )}
                          <small>
                            {e.setting} · {e.date}
                            <br />
                            {e.source}
                          </small>
                        </th>
                        <td>
                          {e.accepted} / {e.total}
                        </td>
                        <td>
                          {((e.accepted / e.total) * 100).toFixed(1)}%
                          <small>
                            {(interval.low * 100).toFixed(1)}–
                            {(interval.high * 100).toFixed(1)}%
                          </small>
                        </td>
                        <td>
                          {bill?.complete
                            ? money(bill.monthlyTotal)
                            : 'Incomplete'}
                          <small>
                            {bill?.problems.join(' ') ??
                              'Exact variant absent from current ledger'}
                          </small>
                          {model && (
                            <label className="decision-select">
                              <span>Quote for {model.display}</span>
                              <select
                                value={quoteFor(model).id}
                                onChange={(ev) =>
                                  chooseQuote(model.key, ev.target.value)
                                }
                              >
                                {quotesFor(
                                  model,
                                  data.decisions ?? null,
                                  data.offers ?? null,
                                ).map((q) => (
                                  <option key={q.id} value={q.id}>
                                    {q.plan.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                        </td>
                        <td>
                          {qualifies
                            ? 'Meets your thresholds'
                            : 'Outside thresholds or unverified'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="decision-note">
                Confidence intervals describe sampling uncertainty, not
                deployment drift. Verify that the priced variant, reasoning
                effort and workload match the evaluation setting. Human review
                and retries are not included in this budget filter.
              </p>
              <button
                className="plan-button"
                onClick={() => {
                  setEvals([])
                  setEvalStatus('Evaluations cleared.')
                }}
              >
                Clear evaluations
              </button>
            </section>
          )}
        </>
      )}
      {tab === 'fleet' && (
        <SaveWatch
          data={data}
          models={[first, second]}
          quotes={{ [first.key]: firstQuote.id, [second.key]: secondQuote.id }}
          workload={workload}
          path={fleetPath}
        />
      )}
    </main>
  )
}
