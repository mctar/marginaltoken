import { useEffect, useMemo, useState } from 'react'
import { comparisonPath } from '../lib/compare'
import {
  decisionFor,
  matchesOpenness,
  openShortlist,
  weightsLabel,
} from '../lib/decisions'
import { contextSize, price, providerName } from '../lib/format'
import { capabilityTags, modelPath } from '../lib/models'
import type { DecisionsFeed, PricesFeed } from '../lib/types'

export default function OpenPage({
  prices,
  decisions,
}: {
  prices: PricesFeed
  decisions: DecisionsFeed | null
}) {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const [query, setQuery] = useState(params.get('q') ?? '')
  const [license, setLicense] = useState(
    params.get('license') === 'permissive' ? 'permissive' : 'weights',
  )
  const [tools, setTools] = useState(params.get('tools') === '1')
  const [selected, setSelected] = useState<string[]>(() =>
    params
      .getAll('model')
      .filter((k) => prices.models.some((m) => m.key === k))
      .slice(0, 4),
  )
  const available = prices.models.filter((m) =>
    matchesOpenness(m, 'weights', decisions),
  )
  const rows = available
    .filter(
      (m) =>
        (m.releaseStage ?? 'stable') === 'stable' &&
        matchesOpenness(
          m,
          license === 'permissive' ? 'permissive' : 'weights',
          decisions,
        ) &&
        (!tools || m.supportsTools) &&
        `${m.display} ${m.provider} ${m.key}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort(
      (a, b) =>
        a.output_mtok - b.output_mtok || a.display.localeCompare(b.display),
    )
  useEffect(() => {
    const p = new URLSearchParams()
    if (query) p.set('q', query)
    if (license === 'permissive') p.set('license', license)
    if (tools) p.set('tools', '1')
    selected.forEach((k) => p.append('model', k))
    window.history.replaceState(
      null,
      '',
      '/open/' + (p.size ? '?' + p.toString() : ''),
    )
  }, [query, license, tools, selected])
  const toggle = (key: string) =>
    setSelected((a) =>
      a.includes(key)
        ? a.filter((k) => k !== key)
        : a.length < 4
          ? [...a, key]
          : a,
    )
  return (
    <main
      id="main"
      className="mx-auto max-w-publication px-4 pt-10 sm:px-6 sm:pt-14 open-page"
    >
      <header className="page-heading">
        <p className="section-kicker">Weights, terms, and routes</p>
        <h1>The open shelf.</h1>
        <p>
          Find production models with verified weight repositories, check their
          terms, and compare the cost of using them. Prices below are hosted API
          quotes.
        </p>
      </header>
      <div className="open-summary">
        <article>
          <strong>{available.length}</strong>
          <span>Verified weight listings</span>
        </article>
        <article>
          <strong>
            {
              available.filter((m) =>
                matchesOpenness(m, 'permissive', decisions),
              ).length
            }
          </strong>
          <span>Permissive license listings</span>
        </article>
        <article>
          <strong>{new Set(available.map((m) => m.provider)).size}</strong>
          <span>Model developers</span>
        </article>
      </div>
      <p className="decision-note">
        Open weights means model files are listed in the linked repository. A
        permissive license allows commercial use subject to its terms. Custom
        terms may add restrictions. Training data and code are not assessed, so
        these labels do not certify full open source AI. Gated repositories
        require access approval.
      </p>
      {!decisions && (
        <p role="status" className="decision-warning">
          Repository verification is unavailable. Existing{' '}
          <a href="/tape/?hugging_face=1">
            weight repository links on the Tape
          </a>{' '}
          remain available.
        </p>
      )}
      {!query && license === 'weights' && !tools && (
        <section
          className="open-shortlist"
          aria-labelledby="open-shortlist-title"
        >
          <p className="section-kicker">An editorial starting set</p>
          <h2 id="open-shortlist-title">A starting set.</h2>
          <p className="decision-note">
            A starting set across developers and model sizes. Evaluate them
            against your own workload and acceptance threshold.
          </p>
          <div className="open-shortlist-grid">
            {openShortlist(prices.models, decisions).map((m) => (
              <article key={m.key}>
                <span>{providerName(m.provider)}</span>
                <h3>
                  <a href={modelPath(m.key)}>{m.display}</a>
                </h3>
                <p>
                  {price(m.input_mtok)} in · {price(m.output_mtok)} out / Mtok
                </p>
                <small>
                  {decisionFor(m, decisions)?.weights?.licenseName} ·{' '}
                  {contextSize(m.context)} context
                </small>
                <label className="decision-check">
                  <input
                    type="checkbox"
                    aria-label={`Select ${m.display} from the shortlist`}
                    checked={selected.includes(m.key)}
                    disabled={selected.length >= 4 && !selected.includes(m.key)}
                    onChange={() => toggle(m.key)}
                  />
                  Add to comparison
                </label>
              </article>
            ))}
          </div>
        </section>
      )}
      <section className="open-toolbar" aria-label="Filter open models">
        <label>
          <span>Find a model</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name or developer"
          />
        </label>
        <label>
          <span>License terms</span>
          <select value={license} onChange={(e) => setLicense(e.target.value)}>
            <option value="weights">All verified weights</option>
            <option value="permissive">Permissive licenses</option>
          </select>
        </label>
        <label className="decision-check">
          <input
            type="checkbox"
            checked={tools}
            onChange={(e) => setTools(e.target.checked)}
          />
          Requires tool calling
        </label>
        <a href="/tape/?openness=weights">All stages on the Tape →</a>
      </section>
      <div className="open-comparison">
        <p aria-live="polite">
          {rows.length} stable listings · {selected.length} selected
        </p>
        <a
          className="decision-button"
          href={comparisonPath(selected)}
          aria-disabled={selected.length < 2}
          onClick={(e) => {
            if (selected.length < 2) e.preventDefault()
          }}
        >
          Compare selected →
        </a>
        <span>
          Select 2–4 models. Specs and licenses do not establish equivalent
          quality.
        </span>
      </div>
      <div className="table-scroll">
        <table className="price-table open-table">
          <thead>
            <tr>
              <th scope="col">Compare</th>
              <th scope="col">Model</th>
              <th scope="col">Weights & license</th>
              <th scope="col" className="numeric">
                Input / Mtok
              </th>
              <th scope="col" className="numeric">
                Output / Mtok
              </th>
              <th scope="col" className="numeric">
                Context
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const w = decisionFor(m, decisions)?.weights
              return (
                <tr key={m.key}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Compare ${m.display}`}
                      checked={selected.includes(m.key)}
                      disabled={
                        selected.length >= 4 && !selected.includes(m.key)
                      }
                      onChange={() => toggle(m.key)}
                    />
                  </td>
                  <th scope="row">
                    <a href={modelPath(m.key)}>{m.display}</a>
                    <small>
                      {providerName(m.provider)} ·{' '}
                      {m.source === 'firstparty'
                        ? 'First-party quote'
                        : 'Routed quote'}
                    </small>
                    <span className="model-tags">
                      {capabilityTags(m).map((t) => (
                        <span key={t}>{t}</span>
                      ))}
                    </span>
                  </th>
                  <td>
                    {w && (
                      <>
                        <a className="source-link" href={w.licenseUrl}>
                          {w.licenseName}
                        </a>
                        <small>
                          {weightsLabel(w)}
                          {w.gated ? ' · Gated' : ''}
                        </small>
                        <a href={w.sourceUrl} className="model-card-link">
                          Weight repository →
                        </a>
                        <small>
                          Verified {w.verifiedAt.slice(0, 10)}
                          {w.status === 'last_good' ? ' · Last good' : ''}
                        </small>
                      </>
                    )}
                  </td>
                  <td className="numeric">{price(m.input_mtok)}</td>
                  <td className="numeric output-price">
                    {price(m.output_mtok)}
                  </td>
                  <td className="numeric">{contextSize(m.context)}</td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-tape">
                  No verified stable listings match these requirements.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="decision-note">
        Verified profiles for selected models are available in{' '}
        <a href="/infrastructure/">Rent vs Run</a>. An available weight file
        does not imply that the model fits your hardware.
      </p>
    </main>
  )
}
