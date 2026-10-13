import { quotesFor, type Quote } from '../lib/quotes'
import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import ShareImageButton from '../components/ShareImageButton'
import { defaultWorkload, nonNegativeNumber } from '../lib/compare'
import {
  matchesOpenness,
} from '../lib/decisions'
import {
  applyRateOverrides,
  billComparisonPath,
  calculateBill,
  defaultAssumptions,
  optionalNumber,
  parseAssumptions,
  percent,
  workloadPresets,
  type BillWorkload,
  type ModelAssumptions,
} from '../lib/economics'
import { contextSize, price, providerName } from '../lib/format'
import { modelPath } from '../lib/models'
import { createComparisonShareImage } from '../lib/share-image'
import { shareImageFilename } from '../lib/share'
import type {
  DecisionsFeed,
  MetaFeed,
  OffersFeed,
  PriceModel,
  PricesFeed,
} from '../lib/types'

function parameter(p: URLSearchParams, name: string, fallback: number): string {
  const value = p.get(name)
  return value !== null && value.trim() && optionalNumber(value) !== null
    ? value
    : String(fallback)
}
function money(n: number): string {
  return (
    '$' +
    n.toLocaleString('en-US', {
      minimumFractionDigits: n < 100 ? 2 : 0,
      maximumFractionDigits:
        n > 0 && n < 0.0001 ? 8 : n < 0.01 ? 4 : n < 100 ? 2 : 0,
    })
  )
}
function initialKeys(prices: PricesFeed, basket: string[]): string[] {
  const valid = new Set(prices.models.map((m) => m.key))
  const chosen = [
    ...new Set(new URLSearchParams(window.location.search).getAll('model')),
  ]
    .filter((k) => valid.has(k))
    .slice(0, 4)
  if (chosen.length)
    return [...chosen, ...Array(Math.max(0, 2 - chosen.length)).fill('')]
  const providers = ['anthropic', 'openai', 'google']
  const rank = (key: string) => {
    const index = providers.indexOf(key.split('/')[0])
    return index < 0 ? providers.length : index
  }
  return basket
    .filter((k) => valid.has(k))
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 3)
}
function NumberField({
  label,
  value,
  onChange,
  step = '1',
  max,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  step?: string
  max?: number
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        type="number"
        min="0"
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

export default function ComparePage({
  prices,
  meta,
  decisions,
  offers,
}: {
  prices: PricesFeed
  meta: MetaFeed
  decisions: DecisionsFeed | null
  offers: OffersFeed | null
}) {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const [keys, setKeys] = useState(() => initialKeys(prices, meta.basket))
  const [calls, setCalls] = useState(() =>
    parameter(params, 'calls', defaultWorkload.calls),
  )
  const [input, setInput] = useState(() =>
    parameter(params, 'input', defaultWorkload.inputTokens),
  )
  const [output, setOutput] = useState(() =>
    parameter(params, 'output', defaultWorkload.outputTokens),
  )
  const [reasoning, setReasoning] = useState(() =>
    parameter(params, 'reasoning', 0),
  )
  const [cacheRead, setCacheRead] = useState(() =>
    parameter(params, 'cache_read', 0),
  )
  const [cacheWrite, setCacheWrite] = useState(() =>
    parameter(params, 'cache_write', 0),
  )
  const [hourly, setHourly] = useState(() =>
    parameter(params, 'review_hourly', 60),
  )
  const [outcomes, setOutcomes] = useState(params.get('outcomes') === '1')
  const [assumptions, setAssumptions] = useState<
    Record<string, ModelAssumptions>
  >(() => parseAssumptions(params.get('assumptions')))
  const [query, setQuery] = useState('')
  const [openOnly, setOpenOnly] = useState(false)
  const [preset, setPreset] = useState('custom')
  const [shareStatus, setShareStatus] = useState('')
  const [importStatus, setImportStatus] = useState('')
  const workload: BillWorkload = {
    calls: nonNegativeNumber(calls),
    inputTokens: nonNegativeNumber(input),
    outputTokens: nonNegativeNumber(output),
    reasoningTokens: nonNegativeNumber(reasoning),
    cacheReadPct: percent(cacheRead),
    cacheWritePct: percent(cacheWrite),
    reviewHourly: nonNegativeNumber(hourly),
  }
  const models = keys
    .map((k) => prices.models.find((m) => m.key === k))
    .filter((m): m is PriceModel => Boolean(m))
  const assumptionFor = (m: PriceModel): ModelAssumptions => {
    if (assumptions[m.key]) return assumptions[m.key]
    const q = quotesFor(m, decisions, offers).find(
      (q) =>
        q.id === 'lab:standard' &&
        q.plan.input_mtok === m.input_mtok &&
        q.plan.output_mtok === m.output_mtok &&
        m.source === 'firstparty',
    )
    return { ...defaultAssumptions, quote: q?.id ?? 'tape' }
  }
  const selectedAssumptions = Object.fromEntries(
    models.map((m) => [m.key, assumptionFor(m)]),
  )
  const results = models.map((model) => {
    const a = assumptionFor(model),
      quotes = quotesFor(model, decisions, offers),
      quote = quotes.find((q) => q.id === a.quote)
    const fallback = quotes[0],
      plan = applyRateOverrides((quote ?? fallback).plan, a)
    const bill = calculateBill(plan, workload, a, outcomes)
    if (Number(cacheRead) > 100 || Number(cacheWrite) > 100)
      bill.problems.push('Cache percentages must be between 0 and 100%.')
    if (!quote)
      bill.problems.push(
        'Selected quote is no longer available. Choose a current price plan.',
      )
    if (
      (quote ?? fallback).context &&
      bill.inputTokens + (bill.outputTokens + bill.reasoningTokens) >
        (quote ?? fallback).context!
    )
      bill.problems.push('Request exceeds the published total context limit.')
    if (
      (quote ?? fallback).maxOutput &&
      bill.outputTokens + bill.reasoningTokens > (quote ?? fallback).maxOutput!
    )
      bill.problems.push(
        'Output plus reasoning exceeds the published output limit.',
      )
    if (bill.reasoningTokens > 0 && model.supportsReasoning === false)
      bill.problems.push(
        'This listing does not report reasoning support. Set its reasoning tokens to zero.',
      )
    bill.complete = bill.problems.length === 0
    return { model, a, quote: quote ?? fallback, plan, bill }
  })
  const comparable =
    results.length >= 2 &&
    results.every(
      (r) => r.bill.complete && (!outcomes || r.bill.costPerSuccess !== null),
    )
  const minimum = comparable
    ? Math.min(
        ...results.map((r) =>
          outcomes ? r.bill.costPerSuccess! : r.bill.monthlyTotal,
        ),
      )
    : null
  const update = (key: string, field: keyof ModelAssumptions, value: string) =>
    setAssumptions((old) => ({
      ...old,
      [key]: {
        ...assumptionFor(prices.models.find((m) => m.key === key)!),
        ...old[key],
        [field]: value,
      },
    }))
  useEffect(() => {
    const a = Object.fromEntries(
      keys.filter(Boolean).map((k) => {
        const m = prices.models.find((m) => m.key === k)!
        return [k, assumptionFor(m)]
      }),
    )
    window.history.replaceState(
      null,
      '',
      billComparisonPath(keys, workload, a, outcomes) + window.location.hash,
    )
    setShareStatus('')
  }, [
    keys,
    calls,
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    hourly,
    outcomes,
    assumptions,
    decisions,
    offers,
  ])
  const choosePreset = (id: string) => {
    setPreset(id)
    const p = workloadPresets.find((p) => p.id === id)
    if (p) {
      setInput(String(p.inputTokens))
      setOutput(String(p.outputTokens))
      setReasoning(String(p.reasoningTokens))
      setCacheRead(String(p.cacheReadPct))
      setCacheWrite('0')
    }
  }
  const changeUsage = (set: (v: string) => void) => (v: string) => {
    set(v)
    setPreset('custom')
  }
  const filtered = prices.models
    .filter(
      (m) =>
        (keys.includes(m.key) ||
          !openOnly ||
          matchesOpenness(m, 'weights', decisions)) &&
        (keys.includes(m.key) ||
          `${m.display} ${providerName(m.provider)} ${m.key}`
            .toLowerCase()
            .includes(query.toLowerCase())),
    )
    .sort(
      (a, b) =>
        providerName(a.provider).localeCompare(providerName(b.provider)) ||
        a.display.localeCompare(b.display),
    )
  const groups = [...new Set(filtered.map((m) => m.provider))]
  const shareLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setShareStatus('Scenario link copied')
    } catch {
      setShareStatus('Use the address bar to copy this scenario')
    }
  }
  const exportScenario = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            version: 1,
            models: keys.filter(Boolean),
            workload,
            outcomes,
            assumptions: selectedAssumptions,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    )
    const url = URL.createObjectURL(blob),
      link = document.createElement('a')
    link.href = url
    link.download = 'marginal-token-scenario.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const importScenario = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      if (file.size > 100000)
        throw new Error('Use an aggregate scenario file under 100 KB.')
      const scenario = JSON.parse(await file.text())
      if (
        scenario.version !== 1 ||
        !Array.isArray(scenario.models) ||
        !scenario.workload ||
        typeof scenario.workload !== 'object' ||
        Array.isArray(scenario.workload)
      )
        throw new Error('Use an exported version 1 scenario file.')
      const selected = [...new Set<string>(scenario.models)]
        .filter((k) => prices.models.some((m) => m.key === k))
        .slice(0, 4)
      if (!selected.length)
        throw new Error('No current model IDs were found in this scenario.')
      const w = scenario.workload
      for (const f of [
        'calls',
        'inputTokens',
        'outputTokens',
        'reasoningTokens',
        'cacheReadPct',
        'cacheWritePct',
        'reviewHourly',
      ])
        if (typeof w[f] !== 'number' || !Number.isFinite(w[f]) || w[f] < 0)
          throw new Error('The workload contains invalid values.')
      setKeys([
        ...selected,
        ...Array(Math.max(0, 2 - selected.length)).fill(''),
      ])
      setCalls(String(w.calls))
      setInput(String(w.inputTokens))
      setOutput(String(w.outputTokens))
      setReasoning(String(w.reasoningTokens))
      setCacheRead(String(w.cacheReadPct))
      setCacheWrite(String(w.cacheWritePct))
      setHourly(String(w.reviewHourly))
      setOutcomes(scenario.outcomes === true)
      setAssumptions(parseAssumptions(JSON.stringify(scenario.assumptions)))
      setPreset('custom')
      setImportStatus(
        'Scenario loaded. Review its assumptions against current prices.',
      )
    } catch (error) {
      setImportStatus(
        error instanceof Error ? error.message : 'Could not read the scenario.',
      )
    }
    e.target.value = ''
  }
  return (
    <main
      id="main"
      className="compare-page mx-auto max-w-publication px-4 pt-10 sm:px-6 sm:pt-14"
    >
      <header className="page-heading compare-heading">
        <p className="section-kicker">Usage, billing, and outcomes</p>
        <h1>Run the numbers.</h1>
        <p>
          Compare two to four models using published price plans and your
          workload. Add your measured success rates to see the cost of
          acceptable results.
        </p>
      </header>
      <section
        className="compare-workbench"
        aria-label="Comparison assumptions"
      >
        <div className="compare-panel workload-panel">
          <div className="compare-panel-heading">
            <span>01</span>
            <div>
              <p className="section-kicker">Workload</p>
              <h2>Set the usage</h2>
            </div>
          </div>
          <label className="decision-select">
            <span>Start with a workload</span>
            <select
              value={preset}
              onChange={(e) => choosePreset(e.target.value)}
            >
              {workloadPresets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <p className="decision-note">
            Presets are editable examples, not measured model performance. One
            request means one model attempt.
          </p>
          <div className="workload-fields">
            <NumberField
              label={outcomes ? 'Tasks / month' : 'Requests / month'}
              value={calls}
              onChange={changeUsage(setCalls)}
              step="100"
            />
            <NumberField
              label="Input tokens / attempt"
              value={input}
              onChange={changeUsage(setInput)}
              step="100"
            />
            <NumberField
              label="Answer tokens / attempt"
              value={output}
              onChange={changeUsage(setOutput)}
              step="100"
            />
            <NumberField
              label="Additional reasoning tokens / attempt"
              value={reasoning}
              onChange={changeUsage(setReasoning)}
              step="100"
            />
          </div>
          <details className="decision-details">
            <summary>Cache usage</summary>
            <div className="workload-fields">
              <NumberField
                label="Cached reads · % of input"
                value={cacheRead}
                onChange={changeUsage(setCacheRead)}
                max={100}
              />
              <NumberField
                label="Cache writes · % of input"
                value={cacheWrite}
                onChange={changeUsage(setCacheWrite)}
                max={100}
              />
            </div>
            <p className="decision-note">
              Input includes uncached, cache-read, and cache-write tokens. Those
              portions are disjoint. Reasoning is additional to the answer; use
              zero if your output count already includes it. Unknown required
              cache rates make the estimate incomplete.
            </p>
          </details>
          <label className="decision-check outcome-switch">
            <input
              type="checkbox"
              checked={outcomes}
              onChange={(e) => setOutcomes(e.target.checked)}
            />
            Cost successful tasks
          </label>
          {outcomes && (
            <>
              <NumberField
                label="Reviewer cost · $ / hour"
                value={hourly}
                onChange={setHourly}
                step="5"
              />
              <p className="decision-note">
                Enter each model’s observed success rate below. Success means
                your acceptance test passed. Retries assume independent attempts
                with the same token usage; review is charged per reviewed
                attempt.
              </p>
            </>
          )}
        </div>
        <div className="compare-panel model-picker-panel">
          <div className="compare-panel-heading">
            <span>02</span>
            <div>
              <p className="section-kicker">The field</p>
              <h2>Choose the models</h2>
            </div>
          </div>
          <label className="compare-model-search">
            <span>Find a model</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by model, developer, or ID"
            />
          </label>
          <label className="decision-check">
            <input
              type="checkbox"
              checked={openOnly}
              onChange={(e) => setOpenOnly(e.target.checked)}
            />
            Show verified open weights
          </label>
          <div className="model-selectors">
            {keys.map((key, i) => (
              <div className="model-selector" key={i}>
                <label>
                  <span>Model {i + 1}</span>
                  <select
                    value={key}
                    onChange={(e) => {
                      setKeys((a) =>
                        a.map((k, j) => (j === i ? e.target.value : k)),
                      )
                      setQuery('')
                    }}
                  >
                    <option value="">Choose a model</option>
                    {groups.map((g) => (
                      <optgroup key={g} label={providerName(g)}>
                        {filtered
                          .filter((m) => m.provider === g)
                          .map((m) => (
                            <option
                              key={m.key}
                              value={m.key}
                              disabled={m.key !== key && keys.includes(m.key)}
                            >
                              {m.display} · {price(m.output_mtok)} output
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                {keys.length > 2 && (
                  <button
                    type="button"
                    onClick={() => setKeys((a) => a.filter((_, j) => j !== i))}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="compare-picker-actions">
            {keys.length < 4 && (
              <button type="button" onClick={() => setKeys((a) => [...a, ''])}>
                + Add model
              </button>
            )}
            <span>{models.length} selected · maximum 4</span>
          </div>
          <div className="scenario-actions">
            <button type="button" onClick={exportScenario}>
              Export scenario
            </button>
            <label className="scenario-import">
              Import scenario
              <input
                type="file"
                accept="application/json,.json"
                onChange={importScenario}
              />
            </label>
            <p aria-live="polite">{importStatus}</p>
          </div>
          <p className="decision-note">
            Files are processed in your browser. The scenario link includes your
            entered assumptions and aggregate success rates.
          </p>
        </div>
      </section>
      <section className="model-assumptions" aria-labelledby="billing-heading">
        <div className="compare-panel-heading">
          <span>03</span>
          <div>
            <p className="section-kicker">Published plans + your assumptions</p>
            <h2 id="billing-heading">Cost each model</h2>
          </div>
        </div>
        <div className="assumption-grid">
          {results.map(({ model, a, quote, plan }) => {
            const quotes = quotesFor(model, decisions, offers)
            return (
              <article className="assumption-card" key={model.key}>
                <h3>{model.display}</h3>
                <label className="decision-select">
                  <span>Price plan / serving route</span>
                  <select
                    aria-label={`Price plan for ${model.display}`}
                    value={a.quote}
                    onChange={(e) => update(model.key, 'quote', e.target.value)}
                  >
                    {!quotes.some((q) => q.id === a.quote) && (
                      <option value={a.quote}>
                        Previously selected quote · unavailable
                      </option>
                    )}
                    {quotes.map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.plan.label}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="decision-source">
                  <a href={quote.sourceUrl}>{quote.source}</a>
                  {quote.verifiedAt
                    ? ` · Checked ${quote.verifiedAt.slice(0, 10)}`
                    : ''}
                </p>
                <p className="decision-note">
                  {price(plan.input_mtok)} input · {price(plan.output_mtok)}{' '}
                  output / Mtok
                  {plan.cached_input_mtok !== undefined
                    ? ` · ${price(plan.cached_input_mtok)} cache reads`
                    : ''}
                  . Choose the context price tier that applies to your prompt.
                </p>
                <details className="decision-details">
                  <summary>Token usage & rate adjustments</summary>
                  <div className="assumption-fields">
                    <NumberField
                      label="Input token multiplier"
                      value={a.tokenMultiplier}
                      onChange={(v) => update(model.key, 'tokenMultiplier', v)}
                      step="0.1"
                    />
                    <NumberField
                      label="Answer token multiplier"
                      value={a.outputMultiplier}
                      onChange={(v) => update(model.key, 'outputMultiplier', v)}
                      step="0.1"
                    />
                    <NumberField
                      label="Reasoning tokens · blank uses workload"
                      value={a.reasoningTokens}
                      onChange={(v) => update(model.key, 'reasoningTokens', v)}
                      step="100"
                    />
                    <NumberField
                      label="Rate multiplier · regional / negotiated"
                      value={a.rateMultiplier}
                      onChange={(v) => update(model.key, 'rateMultiplier', v)}
                      step="0.05"
                    />
                    <label>
                      <span>Cache write duration</span>
                      <select
                        value={a.cacheDuration}
                        onChange={(e) =>
                          update(model.key, 'cacheDuration', e.target.value)
                        }
                      >
                        <option value="5m">Default / 5 minutes</option>
                        <option value="1h">1 hour</option>
                      </select>
                    </label>
                    <NumberField
                      label="Cache storage · million token-hours / month"
                      value={a.storageMillionTokenHours}
                      onChange={(v) =>
                        update(model.key, 'storageMillionTokenHours', v)
                      }
                      step="0.1"
                    />
                    <NumberField
                      label="Tools & other charges · $ / attempt"
                      value={a.extraPerAttempt}
                      onChange={(v) => update(model.key, 'extraPerAttempt', v)}
                      step="0.001"
                    />
                  </div>
                  <p className="decision-note">
                    Multipliers are your assumptions. Cache storage is a monthly
                    quantity and is not multiplied by retries.
                  </p>
                </details>
                <details className="decision-details">
                  <summary>Your rate overrides</summary>
                  <p className="decision-note">
                    Leave blank to use the selected quote. Entered rates are
                    assumptions, in USD per million tokens.
                  </p>
                  <div className="assumption-fields">
                    {(
                      [
                        ['inputRate', 'Uncached input'],
                        ['outputRate', 'Answer output'],
                        ['reasoningRate', 'Reasoning output'],
                        ['cachedInputRate', 'Cache read'],
                        ['cacheWriteRate', 'Cache write · selected duration'],
                        [
                          'cacheStorageRate',
                          'Storage · per million token-hour',
                        ],
                      ] as const
                    ).map(([field, label]) => (
                      <NumberField
                        key={field}
                        label={label}
                        value={a[field]}
                        onChange={(v) => update(model.key, field, v)}
                        step="0.001"
                      />
                    ))}
                  </div>
                </details>
                {outcomes && (
                  <div className="outcome-fields">
                    <NumberField
                      label={`Success rate for ${model.display} · %`}
                      value={a.successPct}
                      onChange={(v) => update(model.key, 'successPct', v)}
                      step="0.1"
                      max={100}
                    />
                    <NumberField
                      label={`Maximum attempts for ${model.display}`}
                      value={a.maxAttempts}
                      onChange={(v) => update(model.key, 'maxAttempts', v)}
                      max={10}
                    />
                    <NumberField
                      label={`Reviewed attempts for ${model.display} · %`}
                      value={a.reviewPct}
                      onChange={(v) => update(model.key, 'reviewPct', v)}
                      max={100}
                    />
                    <NumberField
                      label={`Review minutes for ${model.display}`}
                      value={a.reviewMinutes}
                      onChange={(v) => update(model.key, 'reviewMinutes', v)}
                      step="0.1"
                    />
                  </div>
                )}
              </article>
            )
          })}
        </div>
      </section>
      <section
        className="compare-results"
        aria-labelledby="comparison-results-title"
      >
        <div className="compare-results-heading">
          <div>
            <p className="section-kicker">The mark</p>
            <h2 id="comparison-results-title">
              {outcomes ? 'Cost per successful task' : 'Monthly bill'}
            </h2>
            <p>
              {outcomes
                ? 'API spend, retries, and human review, divided by expected accepted tasks.'
                : 'Cache, reasoning, storage, and selected price adjustments included.'}
            </p>
          </div>
          <div className="compare-share">
            <div className="compare-share-actions">
              <ShareImageButton
                createImage={() =>
                  createComparisonShareImage({
                    results: results.map((r) => ({
                      model: r.model,
                      monthlyTotal: r.bill.monthlyTotal,
                    })),
                    workload,
                    asOf: meta.asOf,
                    path: '/compare/',
                    assumptionNote: outcomes
                      ? 'Modeled monthly cost incl. retries & review. Success rates are user supplied.'
                      : 'Modeled monthly bill using selected price plans and user assumptions.',
                  })
                }
                filename={shareImageFilename('model-cost-comparison')}
                shareTitle="AI model cost comparison — The Marginal Token"
                shareText="A modeled cost comparison using selected prices and workload assumptions."
                disabled={
                  results.length < 2 || results.some((r) => !r.bill.complete)
                }
              />
              <button
                className="share-link-button"
                type="button"
                onClick={shareLink}
              >
                Share scenario link
              </button>
            </div>
            <span className="share-link-status" aria-live="polite">
              {shareStatus}
            </span>
          </div>
        </div>
        {results.length < 2 ? (
          <div className="compare-empty">
            <strong>Add at least two models to compare.</strong>
            <p>
              Your assumptions determine the workload and quality threshold.
            </p>
          </div>
        ) : (
          <div className="comparison-cards">
            {results.map(({ model, a, bill }) => {
              const measure = outcomes
                  ? bill.costPerSuccess
                  : bill.monthlyTotal,
                best = comparable && measure === minimum
              return (
                <article
                  className={`comparison-card ${best ? 'cheapest' : ''}`}
                  key={model.key}
                >
                  <header>
                    <span>{providerName(model.provider)}</span>
                    <h3>
                      <a href={modelPath(model.key)}>{model.display}</a>
                    </h3>
                    <small>
                      {contextSize(model.context)} context
                      {matchesOpenness(model, 'weights', decisions)
                        ? ' · Open weights'
                        : ''}
                    </small>
                  </header>
                  {bill.complete ? (
                    <>
                      <div className="comparison-total">
                        <span>
                          {outcomes
                            ? 'Per successful task'
                            : 'Estimated monthly cost'}
                        </span>
                        <strong>
                          {measure === null
                            ? 'No successful tasks'
                            : money(measure)}
                        </strong>
                        <small>
                          {outcomes
                            ? `${bill.acceptedTasks?.toLocaleString('en-US', { maximumFractionDigits: 1 })} expected accepted tasks`
                            : `${money(bill.perAttempt)} per attempt`}
                        </small>
                      </div>
                      <dl>
                        <div>
                          <dt>Monthly total</dt>
                          <dd>{money(bill.monthlyTotal)}</dd>
                        </div>
                        <div>
                          <dt>API & other charges</dt>
                          <dd>{money(bill.monthlyApi)}</dd>
                        </div>
                        {outcomes && (
                          <>
                            <div>
                              <dt>Human review</dt>
                              <dd>{money(bill.monthlyReview)}</dd>
                            </div>
                            <div>
                              <dt>Expected attempts</dt>
                              <dd>
                                {bill.attempts.toLocaleString('en-US', {
                                  maximumFractionDigits: 1,
                                })}
                              </dd>
                            </div>
                            <div>
                              <dt>Success / attempt</dt>
                              <dd>
                                {a.successPct}% · up to {a.maxAttempts} attempts
                              </dd>
                            </div>
                          </>
                        )}
                        <div>
                          <dt>Cache storage</dt>
                          <dd>{money(bill.monthlyStorage)}</dd>
                        </div>
                      </dl>
                      {best && (
                        <p className="comparison-verdict best">
                          Lowest modeled cost
                          {outcomes ? ' per successful task' : ''}
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="decision-warning">
                      <strong>Estimate incomplete</strong>
                      <ul>
                        {bill.problems.map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )}
        <p className="comparison-disclaimer">
          Calculations run in your browser. Success rates and adjustments are
          user supplied; no quality is inferred from price or API
          specifications. Published plans describe their stated context and
          billing terms. Tool charges, taxes, and other fees require your own
          assumptions. A token multiplier represents measured usage differences
          for the same work.
        </p>
      </section>
    </main>
  )
}
