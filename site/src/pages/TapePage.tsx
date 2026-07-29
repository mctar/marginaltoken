import { useMemo, useState } from 'react'
import { contextSize, price, providerName } from '../lib/format'
import type { PriceModel, PricesFeed } from '../lib/types'

type SortKey = 'display' | 'provider' | 'input_mtok' | 'output_mtok' | 'context' | 'source'
type Direction = 'asc' | 'desc'

const columns: Array<{ key: SortKey; label: string; align?: 'right' }> = [
  { key: 'display', label: 'Model' },
  { key: 'provider', label: 'Provider' },
  { key: 'input_mtok', label: 'Input / Mtok', align: 'right' },
  { key: 'output_mtok', label: 'Output / Mtok', align: 'right' },
  { key: 'context', label: 'Context', align: 'right' },
  { key: 'source', label: 'Source' },
]

function compare(a: PriceModel, b: PriceModel, key: SortKey): number {
  const left = a[key]
  const right = b[key]
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right))
}

export default function TapePage({ prices }: { prices: PricesFeed }) {
  const [firstPartyOnly, setFirstPartyOnly] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('output_mtok')
  const [direction, setDirection] = useState<Direction>('asc')

  const rows = useMemo(() => {
    const filtered = firstPartyOnly ? prices.models.filter((model) => model.source === 'firstparty') : prices.models
    return [...filtered].sort((a, b) => {
      const result = compare(a, b, sortKey) || a.key.localeCompare(b.key)
      return direction === 'asc' ? result : -result
    })
  }, [direction, firstPartyOnly, prices.models, sortKey])

  const sort = (key: SortKey) => {
    if (key === sortKey) setDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setDirection('asc')
    }
  }

  return (
    <main id="main" className="mx-auto max-w-publication px-4 pt-10 sm:px-6 sm:pt-14">
      <header className="page-heading">
        <p className="section-kicker">Current prices</p>
        <h1>The Tape</h1>
        <p>
          Standard input and output prices in US dollars per million tokens. OpenRouter rows show its lowest listed model rate. Curated rows show first-party list prices.
        </p>
      </header>

      <div className="tape-controls">
        <div className="filter-toggle" role="group" aria-label="Filter price source">
          <button type="button" className={!firstPartyOnly ? 'active' : ''} onClick={() => setFirstPartyOnly(false)}>
            All models
          </button>
          <button type="button" className={firstPartyOnly ? 'active' : ''} onClick={() => setFirstPartyOnly(true)}>
            First party only
          </button>
        </div>
        <p aria-live="polite">{rows.length.toLocaleString('en-US')} models</p>
      </div>

      <div className="table-scroll">
        <table className="price-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={column.align === 'right' ? 'numeric' : ''}
                  aria-sort={sortKey === column.key ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <button type="button" onClick={() => sort(column.key)}>
                    {column.label}
                    {sortKey === column.key && <span aria-hidden="true">{direction === 'asc' ? ' ↑' : ' ↓'}</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((model) => (
              <tr key={model.key}>
                <th scope="row">
                  <span>{model.display}</span>
                  <small>{model.key}</small>
                </th>
                <td className="provider-cell">{providerName(model.provider)}</td>
                <td className="numeric">{price(model.input_mtok)}</td>
                <td className="numeric output-price">{price(model.output_mtok)}</td>
                <td className="numeric">{contextSize(model.context)}</td>
                <td>
                  {model.source === 'firstparty' && model.sourceUrl ? (
                    <a className="source-link" href={model.sourceUrl} title={model.rateNote}>
                      First party
                    </a>
                  ) : (
                    <a className="source-link" href={`https://openrouter.ai/${model.key}`}>
                      OpenRouter
                    </a>
                  )}
                  {model.checked && <small className="source-date">Checked {model.checked}</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  )
}
