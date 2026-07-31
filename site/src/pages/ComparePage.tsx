import { useEffect, useMemo, useState } from 'react'
import { calculateCost, comparisonPath, defaultWorkload, nonNegativeNumber, type Workload } from '../lib/compare'
import { contextSize, price, providerName } from '../lib/format'
import { capabilityTags, modelPath } from '../lib/models'
import type { MetaFeed, PriceModel, PricesFeed } from '../lib/types'

const preferredProviders = ['anthropic', 'openai', 'google']

function parameterNumber(params: URLSearchParams, name: string, fallback: number): string {
  const value = params.get(name)
  if (value === null || value.trim() === '') return String(fallback)
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? value : String(fallback)
}

function defaultKeys(prices: PricesFeed, basket: string[]): string[] {
  const byKey = new Map(prices.models.map((model) => [model.key, model]))
  const basketModels = basket.map((key) => byKey.get(key)).filter((model): model is PriceModel => Boolean(model))
  return [...basketModels]
    .sort((a, b) => {
      const left = preferredProviders.indexOf(a.provider)
      const right = preferredProviders.indexOf(b.provider)
      const leftRank = left === -1 ? preferredProviders.length : left
      const rightRank = right === -1 ? preferredProviders.length : right
      return leftRank - rightRank || a.display.localeCompare(b.display)
    })
    .slice(0, 3)
    .map((model) => model.key)
}

function initialKeys(prices: PricesFeed, basket: string[]): string[] {
  const valid = new Set(prices.models.map((model) => model.key))
  const requested = [...new Set(new URLSearchParams(window.location.search).getAll('model'))]
    .filter((key) => valid.has(key))
    .slice(0, 4)
  if (requested.length > 0) return [...requested, ...Array(Math.max(0, 2 - requested.length)).fill('')]
  return defaultKeys(prices, basket)
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function money(value: number): string {
  const maximumFractionDigits = value < 0.01 ? 4 : value < 100 ? 2 : 0
  const minimumFractionDigits = value < 100 ? 2 : 0
  return `$${value.toLocaleString('en-US', { minimumFractionDigits, maximumFractionDigits })}`
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const field = document.createElement('textarea')
  field.value = value
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.append(field)
  field.select()
  const copied = document.execCommand('copy')
  field.remove()
  if (!copied) throw new Error('Copy unavailable')
}

export default function ComparePage({ prices, meta }: { prices: PricesFeed; meta: MetaFeed }) {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const [selectedKeys, setSelectedKeys] = useState(() => initialKeys(prices, meta.basket))
  const [calls, setCalls] = useState(() => parameterNumber(params, 'calls', defaultWorkload.calls))
  const [inputTokens, setInputTokens] = useState(() => parameterNumber(params, 'input', defaultWorkload.inputTokens))
  const [outputTokens, setOutputTokens] = useState(() => parameterNumber(params, 'output', defaultWorkload.outputTokens))
  const [modelQuery, setModelQuery] = useState('')
  const [shareStatus, setShareStatus] = useState('')

  const groups = useMemo(() => {
    const grouped = new Map<string, PriceModel[]>()
    for (const model of prices.models) {
      const group = grouped.get(model.provider) ?? []
      group.push(model)
      grouped.set(model.provider, group)
    }
    return [...grouped.entries()]
      .map(([provider, models]) => ({
        provider,
        label: providerName(provider),
        models: [...models].sort((a, b) => a.display.localeCompare(b.display)),
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [prices.models])

  const visibleGroups = useMemo(() => {
    const query = normalizeSearch(modelQuery)
    if (!query) return groups
    const terms = query.split(/\s+/).filter(Boolean)
    return groups
      .map((group) => ({
        ...group,
        models: group.models.filter((model) => {
          if (selectedKeys.includes(model.key)) return true
          const haystack = normalizeSearch(`${model.display} ${model.key} ${group.label}`)
          return terms.every((term) => haystack.includes(term))
        }),
      }))
      .filter((group) => group.models.length > 0)
  }, [groups, modelQuery, selectedKeys])

  const visibleModelCount = new Set(visibleGroups.flatMap((group) => group.models.map((model) => model.key))).size

  const byKey = useMemo(() => new Map(prices.models.map((model) => [model.key, model])), [prices.models])
  const selectedModels = selectedKeys.map((key) => byKey.get(key)).filter((model): model is PriceModel => Boolean(model))
  const workload: Workload = {
    calls: nonNegativeNumber(calls),
    inputTokens: nonNegativeNumber(inputTokens),
    outputTokens: nonNegativeNumber(outputTokens),
  }
  const results = selectedModels.map((model) => ({ model, cost: calculateCost(model, workload) }))
  const cheapest = results.length > 0 ? Math.min(...results.map((result) => result.cost.monthlyTotal)) : 0
  const cheapestResults = results.filter((result) => result.cost.monthlyTotal === cheapest)
  const cheapestModel = cheapestResults[0]?.model

  useEffect(() => {
    const path = comparisonPath(selectedKeys, {
      calls: nonNegativeNumber(calls),
      inputTokens: nonNegativeNumber(inputTokens),
      outputTokens: nonNegativeNumber(outputTokens),
    })
    window.history.replaceState(null, '', `${path}${window.location.hash}`)
    setShareStatus('')
  }, [calls, inputTokens, outputTokens, selectedKeys])

  const updateSelection = (index: number, key: string) => {
    setSelectedKeys((current) => current.map((value, candidate) => candidate === index ? key : value))
    setModelQuery('')
  }

  const share = async () => {
    const url = window.location.href
    const names = selectedModels.map((model) => model.display).join(', ')
    const text = names ? `Compare the API cost of ${names}.` : 'Compare AI model API costs.'
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Model cost comparison — The Marginal Token', text, url })
        setShareStatus('Shared')
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }
    try {
      await copyText(url)
      setShareStatus('Comparison link copied')
    } catch {
      setShareStatus('Copy unavailable — use the address bar')
    }
  }

  return (
    <main id="main" className="compare-page mx-auto max-w-publication px-4 pt-10 sm:px-6 sm:pt-14">
      <header className="page-heading compare-heading">
        <p className="section-kicker">Costed comparison</p>
        <h1>Run the numbers.</h1>
        <p>
          Compare the standard API cost of two to four models against the same workload. Every selection and assumption stays in the URL, ready to share.
        </p>
      </header>

      <section className="compare-workbench" aria-label="Comparison assumptions">
        <div className="compare-panel workload-panel">
          <div className="compare-panel-heading">
            <span>01</span>
            <div>
              <p className="section-kicker">Workload</p>
              <h2>Set the usage</h2>
            </div>
          </div>
          <div className="workload-fields">
            <label>
              <span>Requests / month</span>
              <input type="number" min="0" step="100" inputMode="numeric" value={calls} onChange={(event) => setCalls(event.target.value)} />
            </label>
            <label>
              <span>Input tokens / request</span>
              <input type="number" min="0" step="100" inputMode="numeric" value={inputTokens} onChange={(event) => setInputTokens(event.target.value)} />
            </label>
            <label>
              <span>Output tokens / request</span>
              <input type="number" min="0" step="100" inputMode="numeric" value={outputTokens} onChange={(event) => setOutputTokens(event.target.value)} />
            </label>
          </div>
          <p className="workload-volume">
            Monthly volume: {(workload.calls * workload.inputTokens).toLocaleString('en-US')} input and {(workload.calls * workload.outputTokens).toLocaleString('en-US')} output tokens.
          </p>
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
              value={modelQuery}
              onChange={(event) => setModelQuery(event.target.value)}
              placeholder={`Search ${prices.models.length} models by name, provider, or ID`}
              autoComplete="off"
            />
            {modelQuery && <small>{visibleModelCount} choices visible</small>}
          </label>
          <div className="model-selectors">
            {selectedKeys.map((key, index) => (
              <div className="model-selector" key={index}>
                <label>
                  <span>Model {index + 1}</span>
                  <select value={key} onChange={(event) => updateSelection(index, event.target.value)}>
                    <option value="">Choose a model</option>
                    {visibleGroups.map((group) => (
                      <optgroup key={group.provider} label={group.label}>
                        {group.models.map((model) => (
                          <option
                            key={model.key}
                            value={model.key}
                            disabled={model.key !== key && selectedKeys.includes(model.key)}
                          >
                            {model.display} · {price(model.output_mtok)} output · {model.source === 'firstparty' ? 'First party' : 'OpenRouter'}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                {selectedKeys.length > 2 && (
                  <button type="button" onClick={() => setSelectedKeys((current) => current.filter((_, candidate) => candidate !== index))}>
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="compare-picker-actions">
            {selectedKeys.length < 4 && <button type="button" onClick={() => setSelectedKeys((current) => [...current, ''])}>+ Add model</button>}
            <span>{selectedModels.length} selected · maximum 4</span>
          </div>
        </div>
      </section>

      <section className="compare-results" aria-labelledby="comparison-results-title">
        <div className="compare-results-heading">
          <div>
            <p className="section-kicker">The mark</p>
            <h2 id="comparison-results-title">Monthly cost</h2>
            {results.length >= 2 && cheapestModel && (
              cheapestResults.length === 1
                ? <p><strong>{cheapestModel.display}</strong> is the lowest-cost selection for this workload at {money(cheapest)} per month.</p>
                : <p><strong>{cheapestResults.length} models tie</strong> for the lowest cost in this workload at {money(cheapest)} per month.</p>
            )}
          </div>
          <div className="compare-share">
            <button type="button" onClick={share}>Share comparison</button>
            <span aria-live="polite">{shareStatus}</span>
          </div>
        </div>

        {results.length < 2 ? (
          <div className="compare-empty">
            <strong>Add at least two models to compare.</strong>
            <p>The calculator only compares posted prices; it does not infer model quality.</p>
          </div>
        ) : (
          <div className="comparison-cards">
            {results.map(({ model, cost }) => {
              const isCheapest = cost.monthlyTotal === cheapest
              const difference = cost.monthlyTotal - cheapest
              const premium = cheapest > 0 ? (difference / cheapest) * 100 : 0
              return (
                <article className={`comparison-card ${isCheapest ? 'cheapest' : ''}`} key={model.key}>
                  <header>
                    <span>{providerName(model.provider)}</span>
                    <h3><a href={modelPath(model.key)}>{model.display}</a></h3>
                    <small>{contextSize(model.context)} context</small>
                  </header>
                  <div className="comparison-total">
                    <span>Estimated monthly cost</span>
                    <strong>{money(cost.monthlyTotal)}</strong>
                    <small>{money(cost.totalPerRequest)} per request</small>
                  </div>
                  <dl>
                    <div><dt>Input cost</dt><dd>{money(cost.monthlyInput)}</dd></div>
                    <div><dt>Output cost</dt><dd>{money(cost.monthlyOutput)}</dd></div>
                    <div><dt>Input rate</dt><dd>{price(model.input_mtok)} / Mtok</dd></div>
                    <div><dt>Output rate</dt><dd>{price(model.output_mtok)} / Mtok</dd></div>
                  </dl>
                  <p className={`comparison-verdict ${isCheapest ? 'best' : ''}`}>
                    {isCheapest
                      ? cheapestResults.length > 1 ? 'Tied lowest cost in this comparison' : 'Lowest cost in this comparison'
                      : `${money(difference)} more / month · ${premium.toFixed(0)}% premium`}
                  </p>
                  {capabilityTags(model).length > 0 && (
                    <ul className="comparison-tags">
                      {capabilityTags(model).map((tag) => <li key={tag}>{tag}</li>)}
                    </ul>
                  )}
                </article>
              )
            })}
          </div>
        )}
        <p className="comparison-disclaimer">
          Estimates use current standard list prices and exclude caching, batch, priority, regional and long-context adjustments. Price is not a measure of output quality.
        </p>
      </section>
    </main>
  )
}
