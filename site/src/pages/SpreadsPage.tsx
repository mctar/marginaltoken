import { useEffect, useMemo, useState } from 'react'
import ShareImageButton from '../components/ShareImageButton'
import { contextSize, price, providerName } from '../lib/format'
import { modelPath } from '../lib/models'
import {
  filterSpreadRows,
  marketSpreadRows,
  type SpreadConfidence,
  type SpreadRow,
  type SpreadSort,
} from '../lib/offers'
import { shareImageFilename } from '../lib/share'
import { createSpreadsShareImage } from '../lib/share-image'
import type { OffersFeed, PricesFeed } from '../lib/types'

const PAGE_SIZE = 40

function initialEnum<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const value = new URLSearchParams(window.location.search).get(name)
  return allowed.includes(value as T) ? value as T : fallback
}

function initialValue(name: string): string {
  return new URLSearchParams(window.location.search).get(name) ?? ''
}

function configurationLabel(row: SpreadRow): string {
  const precision = row.group.quantization === 'undisclosed'
    ? 'Precision undisclosed'
    : row.group.quantization.toUpperCase()
  return `${precision} · ${contextSize(row.group.context)} context`
}

function spreadText(value: number): string {
  return value > 0
    ? `+${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}%`
    : 'No gap'
}

function groupPath(row: SpreadRow): string {
  return `${modelPath(row.model.key)}#${encodeURIComponent(row.group.key)}`
}

export default function SpreadsPage({ prices, offers }: { prices: PricesFeed; offers: OffersFeed | null }) {
  const [query, setQuery] = useState(() => initialValue('q'))
  const [confidence, setConfidence] = useState<SpreadConfidence>(() =>
    initialEnum('confidence', ['declared', 'nominal', 'all'] as const, 'declared'),
  )
  const [sort, setSort] = useState<SpreadSort>(() =>
    initialEnum('sort', ['widest', 'output', 'input'] as const, 'widest'),
  )
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const marketRows = useMemo(
    () => marketSpreadRows(prices.models, offers?.models ?? []),
    [offers?.models, prices.models],
  )
  const rows = useMemo(
    () => filterSpreadRows(marketRows, { query, confidence, sort }),
    [confidence, marketRows, query, sort],
  )
  const visibleRows = rows.slice(0, visibleCount)
  const declaredRows = marketRows.filter((row) => row.group.confidence === 'declared')
  const widestDeclared = declaredRows[0]?.widestSpreadPct ?? 0
  const sourceLabels = offers?.sources?.length
    ? offers.sources.map((source) => source.label)
    : ['OpenRouter endpoints']

  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [query, confidence, sort])

  useEffect(() => {
    const params = new URLSearchParams()
    if (query.trim()) params.set('q', query.trim())
    if (confidence !== 'declared') params.set('confidence', confidence)
    if (sort !== 'widest') params.set('sort', sort)
    const nextSearch = params.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}`)
  }, [confidence, query, sort])

  return (
    <main id="main" className="spreads-page mx-auto max-w-publication px-4 pt-10 sm:px-6 sm:pt-14">
      <header className="page-heading spreads-heading">
        <p className="section-kicker">Venue market</p>
        <div className="spreads-title-row">
          <h1>The Spreads</h1>
          {offers && rows.length > 0 && (
            <ShareImageButton
              createImage={() => createSpreadsShareImage({
                rows,
                asOf: offers.asOf,
                confidence,
                path: '/spreads/',
              })}
              filename={shareImageFilename('market-price-spreads')}
              shareTitle="AI model price spreads — The Marginal Token"
              shareText="Like-for-like AI model API price gaps across serving venues."
            />
          )}
        </div>
        <p>
          Where the same reported serving configuration carries different list prices. Ranked by the premium on the highest posted quote over the lowest.
        </p>
      </header>

      {offers ? (
        <>
          <dl className="spread-market-summary">
            <div>
              <dt>Price gaps</dt>
              <dd>{marketRows.length.toLocaleString('en-US')}</dd>
              <small>like-for-like configurations</small>
            </div>
            <div>
              <dt>Declared matches</dt>
              <dd>{declaredRows.length.toLocaleString('en-US')}</dd>
              <small>precision reported</small>
            </div>
            <div>
              <dt>Widest declared gap</dt>
              <dd>+{widestDeclared.toLocaleString('en-US', { maximumFractionDigits: 2 })}%</dd>
              <small>input or output</small>
            </div>
            <div>
              <dt>Venues observed</dt>
              <dd>{offers.venueCount.toLocaleString('en-US')}</dd>
              <small>across {sourceLabels.length} {sourceLabels.length === 1 ? 'source feed' : 'source feeds'}</small>
            </div>
          </dl>

          <section className="spread-controls" aria-label="Filter model price spreads">
            <label className="spread-search">
              <span>Search the market</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Model, provider, venue, route, or precision"
                autoComplete="off"
              />
            </label>
            <div className="spread-control-groups">
              <div>
                <span>Match confidence</span>
                <div className="filter-toggle" role="group" aria-label="Filter match confidence">
                  {([
                    ['declared', 'Declared'],
                    ['all', 'All'],
                    ['nominal', 'Nominal'],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={confidence === value ? 'active' : ''}
                      aria-pressed={confidence === value}
                      onClick={() => setConfidence(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="spread-sort">
                <span>Rank by</span>
                <select value={sort} onChange={(event) => setSort(event.target.value as SpreadSort)}>
                  <option value="widest">Widest gap</option>
                  <option value="output">Output gap</option>
                  <option value="input">Input gap</option>
                </select>
              </label>
            </div>
          </section>

          <section className="spread-results" aria-labelledby="spread-results-title">
            <header className="spread-results-heading">
              <div>
                <p className="section-kicker">Like for like</p>
                <h2 id="spread-results-title">{rows.length.toLocaleString('en-US')} price {rows.length === 1 ? 'gap' : 'gaps'}</h2>
              </div>
              <p>Highest quote premium over the lowest quote in each matching configuration.</p>
            </header>

            {visibleRows.length > 0 ? (
              <div className="spread-table-wrap">
                <table className="spread-table">
                  <thead>
                    <tr>
                      <th scope="col">Rank</th>
                      <th scope="col">Model &amp; configuration</th>
                      <th scope="col">Input / Mtok</th>
                      <th scope="col">Output / Mtok</th>
                      <th scope="col">Market</th>
                      <th scope="col"><span className="sr-only">Open model card</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row, index) => (
                      <tr key={`${row.model.key}:${row.group.key}`}>
                        <td className="spread-rank">{index + 1}</td>
                        <th scope="row">
                          <a href={groupPath(row)}>{row.model.display}</a>
                          <span>{providerName(row.model.provider)}</span>
                          <small>{configurationLabel(row)}</small>
                          <span className={`offer-confidence ${row.group.confidence}`}>
                            {row.group.confidence === 'declared' ? 'Declared match' : 'Nominal match'}
                          </span>
                        </th>
                        <td className="spread-price-cell">
                          <strong>{price(row.group.input_mtok.min)}–{price(row.group.input_mtok.max)}</strong>
                          <small>{spreadText(row.inputSpreadPct)}</small>
                        </td>
                        <td className="spread-price-cell">
                          <strong>{price(row.group.output_mtok.min)}–{price(row.group.output_mtok.max)}</strong>
                          <small>{spreadText(row.outputSpreadPct)}</small>
                        </td>
                        <td className="spread-market-cell">
                          <strong>{row.group.offerCount} offers · {row.group.venueCount} venues</strong>
                          <small title={row.venues.join(', ')}>{row.venues.join(' · ')}</small>
                        </td>
                        <td className="spread-open-cell"><a href={groupPath(row)} aria-label={`Open ${row.model.display} matching offers`}>Open group →</a></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="spread-empty">
                <strong>No matching price gap.</strong>
                <p>Try a broader search or include nominal matches.</p>
              </div>
            )}

            {visibleCount < rows.length && (
              <button className="spread-show-more" type="button" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
                Show {Math.min(PAGE_SIZE, rows.length - visibleCount)} more
              </button>
            )}
          </section>

          <p className="spread-disclaimer">
            Matching posted configurations only. A lower price is not evidence of equal quality, latency, residency, throughput, reliability, or contractual terms. Sources: {sourceLabels.join(' + ')}, as of {offers.asOf}.
          </p>
        </>
      ) : (
        <div className="spread-empty spread-feed-empty">
          <strong>The venue feed is unavailable.</strong>
          <p>The core price tape remains current; market spreads will return when the endpoint-offer file is available.</p>
        </div>
      )}
    </main>
  )
}
