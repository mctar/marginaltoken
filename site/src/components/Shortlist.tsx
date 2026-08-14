import type { CSSProperties } from 'react'
import { longDate, price } from '../lib/format'
import { modelPath } from '../lib/models'
import {
  SHORTLIST_SLOT_COUNT,
  logPricePosition,
  selectShortlist,
  shortlistProviderColor,
} from '../lib/shortlist'
import type { PriceModel } from '../lib/types'

const AXIS_TICKS = [0.1, 1, 10, 100]

function ModelRate({ model, tier }: { model: PriceModel; tier: string }) {
  const inputPosition = logPricePosition(model.input_mtok)
  const outputPosition = logPricePosition(model.output_mtok)
  const startPosition = Math.min(inputPosition, outputPosition)
  const span = Math.abs(outputPosition - inputPosition)
  const style = {
    '--shortlist-color': shortlistProviderColor(model.provider),
    '--input-position': `${inputPosition}%`,
    '--output-position': `${outputPosition}%`,
    '--connector-start': `${startPosition}%`,
    '--connector-span': `${span}%`,
  } as CSSProperties
  const source = model.source === 'firstparty' ? 'First-party' : 'Routed quote'
  const stage = model.releaseStage === 'preview' ? ' · Preview' : ''

  return (
    <li>
      <a
        className="shortlist-model"
        href={modelPath(model.key)}
        style={style}
        aria-label={`${model.display}: input ${price(model.input_mtok)} and output ${price(model.output_mtok)} per million tokens`}
      >
        <span className="shortlist-model-meta">
          <b>{tier}</b>
          <small>{source}{stage}</small>
        </span>
        <strong>{model.display}</strong>
        <span className="shortlist-plot" aria-hidden="true">
          <i className="shortlist-connector" />
          <i className="shortlist-dot input" />
          <i className="shortlist-dot output" />
        </span>
        <span className="shortlist-prices">
          <small>In {price(model.input_mtok)}</small>
          <small>Out {price(model.output_mtok)}</small>
        </span>
      </a>
    </li>
  )
}

function MissingRate({ tier }: { tier: string }) {
  return (
    <li className="shortlist-model shortlist-missing">
      <span className="shortlist-model-meta"><b>{tier}</b></span>
      <strong>Awaiting a current quote</strong>
      <small>The slot remains visible until its successor is reviewed.</small>
    </li>
  )
}

export default function Shortlist({ models, asOf }: { models: PriceModel[]; asOf: string }) {
  const columns = selectShortlist(models)
  const quoted = columns.flatMap((column) => column.selections).filter((selection) => selection.model).length

  return (
    <section className="shortlist-section" aria-labelledby="shortlist-title">
      <div className="shortlist-heading">
        <div>
          <p className="section-kicker">Enterprise API shelf</p>
          <h2 id="shortlist-title" className="section-title">The Shortlist</h2>
        </div>
        <p>
          The current general-purpose models an enterprise buyer is most likely to compare. One permanent slot per lab tier; successors replace predecessors.
        </p>
      </div>

      <div className="shortlist-keyline">
        <p>{quoted} of {SHORTLIST_SLOT_COUNT} slots quoted · {longDate(asOf)}</p>
        <div className="shortlist-legend" aria-label="Chart legend">
          <span><i className="shortlist-dot input" /> Input</span>
          <span><i className="shortlist-dot output" /> Output</span>
          <span>$ / 1m tokens · log scale</span>
        </div>
      </div>

      <div className="shortlist-grid">
        {columns.map((column) => (
          <article className="shortlist-column" key={column.id}>
            <h3>{column.title}</h3>
            <div className="shortlist-axis" aria-hidden="true">
              {AXIS_TICKS.map((tick) => <span key={tick}>${tick}</span>)}
            </div>
            <ol>
              {column.selections.map((selection) => (
                selection.model
                  ? <ModelRate key={selection.id} model={selection.model} tier={selection.tier} />
                  : <MissingRate key={selection.id} tier={selection.tier} />
              ))}
            </ol>
          </article>
        ))}
      </div>

      <div className="shortlist-caption">
        <span>First-party rates override routed quotes.</span>
        <span>Open-weight models are excluded when no single comparable API rate exists.</span>
      </div>
    </section>
  )
}
