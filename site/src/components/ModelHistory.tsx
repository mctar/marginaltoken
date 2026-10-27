import { canonicalModelKey, modelRegister } from '../lib/register'
import { csvText, downloadText } from '../lib/imports'
import { price } from '../lib/format'
import type { HistoryFeed, ChangesFeed, PriceModel } from '../lib/types'

export default function ModelHistory({
  modelKey,
  model,
  history,
  changes,
  asOf,
}: {
  modelKey: string
  model?: PriceModel
  history: HistoryFeed
  changes: ChangesFeed
  asOf: string
}) {
  const key = canonicalModelKey(modelKey),
    record = modelRegister[key]
  const points = history.points
    .filter(
      (p) =>
        canonicalModelKey(p.key) === key &&
        Number.isFinite(p.input_mtok) &&
        Number.isFinite(p.output_mtok) &&
        Number.isFinite(Date.parse(p.date)),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key))
  const current = model
    ? {
        key: model.key,
        date: asOf,
        input_mtok: model.input_mtok,
        output_mtok: model.output_mtok,
        source: model.source,
        sourceUrl: model.sourceUrl,
        checked: model.checked,
        rateNote: model.rateNote,
        verificationStatus: model.verificationStatus,
      }
    : null
  const plotted =
    current && !points.some((p) => p.date === asOf && p.key === current.key)
      ? [...points, current].sort((a, b) => a.date.localeCompare(b.date))
      : points
  const events = [
    ...(record?.events ?? []),
    ...(record?.lifecycle
      ? [
          {
            date: record.lifecycle.date,
            kind: record.lifecycle.status,
            label: record.lifecycle.detail ?? record.lifecycle.status,
            sourceUrl: record.lifecycle.sourceUrl,
          },
        ]
      : []),
    ...changes.changes
      .filter(
        (e) =>
          e.type !== 'basket' &&
          canonicalModelKey(e.key) === key &&
          e.type !== 'price',
      )
      .map((e) => ({
        date: e.date,
        kind: e.type,
        label:
          canonicalModelKey(e.key) !== e.key
            ? `Routed ID ${e.key}: ${e.type === 'listed' ? 'observed on the tape' : 'ledger history retained under the canonical key'}`
            : e.type === 'delisted'
              ? 'Removed from the price tape (not proof of provider retirement)'
              : 'First observed on the price tape',
        sourceUrl: '',
      })),
  ].sort((a, b) => a.date.localeCompare(b.date))
  const start = plotted.length ? Date.parse(plotted[0].date) : Date.parse(asOf),
    end = Math.max(Date.parse(asOf), ...plotted.map((p) => Date.parse(p.date))),
    top = Math.max(
      1,
      ...plotted.map((p) => Math.max(p.input_mtok, p.output_mtok)),
    )
  const x = (date: string) =>
      70 + ((Date.parse(date) - start) / Math.max(86400000, end - start)) * 720,
    y = (value: number) => 220 - (value / top) * 170
  const path = (field: 'input_mtok' | 'output_mtok') =>
    plotted
      .map(
        (p, i) =>
          `${i ? 'H' + x(p.date) + ' V' : 'M' + x(p.date) + ' '}${y(p[field])}`,
      )
      .join(' ')
  const exportHistory = () =>
    downloadText(
      `marginal-token-${key.replaceAll('/', '-')}-history.csv`,
      csvText([
        [
          'date',
          'record_type',
          'original_key',
          'input_per_million',
          'output_per_million',
          'source',
          'source_url',
          'price_checked',
          'verification_status',
          'note',
        ],
        ...plotted.map((p) => [
          p.date,
          p === current ? 'current-quote' : 'observed-quote',
          p.key,
          p.input_mtok,
          p.output_mtok,
          p.source ?? 'Historical source unrecorded',
          p.sourceUrl,
          p.checked,
          p.verificationStatus ?? 'Unrecorded',
          p.rateNote,
        ]),
        ...events.map((e) => [
          e.date,
          e.kind,
          key,
          '',
          '',
          e.kind === 'expectation'
            ? 'Inferred date, not a confirmed price change'
            : 'Recorded event',
          e.sourceUrl,
          '',
          '',
          e.label,
        ]),
      ]),
    )
  return (
    <section className="plan-panel model-history">
      <p className="section-kicker">The ledger over time</p>
      <h2>Price history & lifecycle</h2>
      <p>
        Observed token quotes, rather than a performance index. Earlier entries
        without saved source details remain explicitly unverified historical
        observations.
      </p>
      {record?.apiId && (
        <p className="decision-note">
          Canonical ledger key: {key} · provider API ID: {record.apiId}
          {model?.routedId && ` · routed ID: ${model.routedId}`}
        </p>
      )}
      {record?.identityNote && (
        <p className="decision-note">
          {record.identityNote}{' '}
          {record.identitySource && <a href={record.identitySource}>Identity source →</a>}
        </p>
      )}
      {record?.lifecycle?.successor && (
        <p>
          <a href={`/model/${record.lifecycle.successor}/`}>
            Recorded successor: {record.lifecycle.successor} →
          </a>
        </p>
      )}
      {plotted.length > 0 ? (
        <>
          <svg
            viewBox="0 0 840 275"
            role="img"
            aria-label={`Observed input and output token prices for ${key}; full values in the table below`}
            className="history-chart"
          >
            <line x1="70" x2="790" y1="220" y2="220" stroke="#a9a393" />
            <text x="70" y="25" fontSize="13">
              $ / million tokens
            </text>
            {[0, top / 2, top].map((v) => (
              <g key={v}>
                <line x1="70" x2="790" y1={y(v)} y2={y(v)} stroke="#ddd7c8" />
                <text x="60" y={y(v) + 4} textAnchor="end" fontSize="12">
                  {v.toFixed(2)}
                </text>
              </g>
            ))}
            {events
              .filter(
                (e) => Date.parse(e.date) >= start && Date.parse(e.date) <= end,
              )
              .map((e, i) => (
                <line
                  key={i}
                  x1={x(e.date)}
                  x2={x(e.date)}
                  y1="45"
                  y2="220"
                  stroke="#a9a393"
                  strokeDasharray="4 4"
                >
                  <title>
                    {e.date}: {e.label}
                  </title>
                </line>
              ))}
            <path
              d={path('input_mtok')}
              fill="none"
              stroke="#174d48"
              strokeWidth="3"
            />
            <path
              d={path('output_mtok')}
              fill="none"
              stroke="#b76037"
              strokeWidth="3"
            />
            {plotted.map((p, i) => (
              <g key={i}>
                <circle
                  cx={x(p.date)}
                  cy={y(p.input_mtok)}
                  r="3"
                  fill="#174d48"
                />
                <circle
                  cx={x(p.date)}
                  cy={y(p.output_mtok)}
                  r="3"
                  fill="#b76037"
                />
              </g>
            ))}
            <text x="70" y="246" fontSize="12">
              {plotted[0].date}
            </text>
            <text x="790" y="246" textAnchor="end" fontSize="12">
              {new Date(end).toISOString().slice(0, 10)}
            </text>
            <text x="340" y="270" fill="#174d48" fontSize="13">
              Input
            </text>
            <text x="430" y="270" fill="#b76037" fontSize="13">
              Output
            </text>
          </svg>
          <details>
            <summary>
              Read the quote table ({plotted.length} observations)
            </summary>
            <div className="plan-table-wrap">
              <table className="plan-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Input / M</th>
                    <th>Output / M</th>
                    <th>Saved source and quote identity</th>
                  </tr>
                </thead>
                <tbody>
                  {plotted.map((p, i) => (
                    <tr key={i}>
                      <th>{p.date}</th>
                      <td>{price(p.input_mtok)}</td>
                      <td>{price(p.output_mtok)}</td>
                      <td>
                        {p.sourceUrl ? (
                          <a href={p.sourceUrl}>{p.source ?? 'Saved source'}</a>
                        ) : (
                          'Historical source unrecorded'
                        )}
                        <small>
                          {p.key}
                          {p.checked && ` · Checked ${p.checked}`}
                          {p.verificationStatus &&
                            ` · ${p.verificationStatus.replace('_', ' ')}`}
                          {p.rateNote && ` · ${p.rateNote}`}
                        </small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <p>No saved quote history for this key.</p>
      )}
      {events.length > 0 && (
        <ul className="history-events">
          {events.map((e, i) => (
            <li key={i}>
              <time>{e.date}</time> ·{' '}
              {e.kind === 'expectation' ? 'Expected, requires recheck' : e.kind}{' '}
              · {e.label}
              {e.sourceUrl && (
                <>
                  {' '}
                  · <a href={e.sourceUrl}>Source</a>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <button className="plan-button" onClick={exportHistory}>
        Download history CSV
      </button>
      <a
        href={`/feeds/model/${key.split('/').map(encodeURIComponent).join('/')}.xml`}
      >
        Follow this model via RSS →
      </a>
    </section>
  )
}
