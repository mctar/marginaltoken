import DeflatorChart from '../components/DeflatorChart'
import LatestMoves from '../components/LatestMoves'
import MachineNote from '../components/MachineNote'
import { longDate, price, providerName } from '../lib/format'
import { modelPath } from '../lib/models'
import type { FeedData, PriceChange, PriceModel } from '../lib/types'

function direction(value: number): string {
  const difference = value - 100
  if (Math.abs(difference) < 0.005) return 'unchanged since inception'
  return `${Math.abs(difference).toFixed(2)} points ${difference < 0 ? 'below' : 'above'} 100 at inception`
}

function isModel(model: PriceModel | undefined): model is PriceModel {
  return Boolean(model)
}

function moveSummary(event: PriceChange): string {
  const side = event.field === 'input_mtok' ? 'Input' : 'Output'
  const verb = event.to < event.from ? 'fell' : 'rose'
  const percent = event.pct === null ? '' : ` ${Math.abs(event.pct).toFixed(1)}%`
  return `${side} ${verb}${percent}, from ${price(event.from)} to ${price(event.to)} / Mtok`
}

export default function FrontPage({ data }: { data: FeedData }) {
  const { meta, changes } = data
  const basketMean = meta.indexBaseMean * (meta.indexValue / meta.indexBase)
  const basketModels = meta.basket
    .map((key) => data.prices.models.find((model) => model.key === key))
    .filter(isModel)
  const latestMove = changes.changes.find((event): event is PriceChange => event.type === 'price')
  const hasIndexMovement = meta.indexHistory.length > 1

  return (
    <main id="main" className="mx-auto max-w-publication px-4 pt-10 sm:px-6 sm:pt-14">
      <section className="front-lead" aria-labelledby="front-title">
        <div>
          <p className="section-kicker">The deflator</p>
          <h1 id="front-title" className="front-title">
            The price of intelligence, marked to market.
          </h1>
          <p className="standfirst">
            As of {longDate(meta.asOf)}, the six-provider basket carries an equal-weight mean output price of {price(basketMean)} per million tokens.
          </p>
        </div>
        <aside
          className={`basket-brief ${meta.indexValue < 100 ? 'down' : meta.indexValue > 100 ? 'up' : 'flat'}`}
          aria-label="Current flagship basket price and Deflator reading"
        >
          <span>Flagship basket</span>
          <strong>{price(basketMean)}</strong>
          <small>Mean output price / Mtok</small>
          <div className="deflator-brief">
            <span>Deflator</span>
            <b>{meta.indexValue.toFixed(2)}</b>
            <small>{direction(meta.indexValue)}</small>
          </div>
        </aside>
      </section>

      {latestMove && (
        <a className={`front-signal ${latestMove.to < latestMove.from ? 'cut' : 'rise'}`} href={modelPath(latestMove.key)}>
          <span>Latest verified move</span>
          <strong>{latestMove.display}</strong>
          <span>{moveSummary(latestMove)}</span>
          <small>Model card →</small>
        </a>
      )}

      <section className="mt-12 border-t border-ink pt-5" aria-labelledby="chart-title">
        <div className="chart-heading">
          <div>
            <p className="section-kicker">Output price index</p>
            <h2 id="chart-title" className="section-title">
              The Deflator
            </h2>
          </div>
          <p>
            Six providers. Equal weight. Standard output rates for the cheapest eligible flagship at each provider.
          </p>
        </div>
        {hasIndexMovement ? (
          <DeflatorChart points={meta.indexHistory} />
        ) : (
          <div className="index-inception">
            <div className="inception-copy">
              <p className="section-kicker">Starting line</p>
              <strong>{meta.indexValue.toFixed(2)}</strong>
              <h3>Inception is the observation.</h3>
              <p>
                The line will begin when a verified basket price changes. Until then, these are the six models setting the benchmark.
              </p>
            </div>
            <ol className="basket-snapshot" aria-label="Current Deflator basket">
              {basketModels.map((model) => (
                <li key={model.key}>
                  <a href={modelPath(model.key)}>
                    <span>{providerName(model.provider)}</span>
                    <strong>{model.display}</strong>
                    <small>{price(model.output_mtok)} output / Mtok</small>
                  </a>
                </li>
              ))}
            </ol>
          </div>
        )}
        <div className="chart-caption">
          <span>Inception: {longDate(meta.indexBaseDate)}</span>
          <span>{meta.basket.length} models in the current basket</span>
        </div>
      </section>

      <MachineNote brief={data.brief} revision={meta.generatedAt} />

      <div className="mt-16 grid gap-12 border-t border-ink pt-7 md:grid-cols-[1.5fr_1fr]">
        <LatestMoves events={changes.changes} baseDate={meta.indexBaseDate} />
        <aside className="brief-note">
          <p className="section-kicker">Reading the tape</p>
          <h2 className="font-serif text-2xl font-semibold">A price, not a verdict</h2>
          <p>
            Token rates measure the posted cost of model use. They do not measure output quality, negotiated terms, or the number of tokens a task requires.
          </p>
          <a className="text-link" href="/methodology/">
            Read the methodology
          </a>
        </aside>
      </div>
    </main>
  )
}
