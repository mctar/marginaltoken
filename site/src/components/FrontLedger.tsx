import DeflatorChart from './DeflatorChart'
import LatestMoves from './LatestMoves'
import MachineNote from './MachineNote'
import SourceWatch from './SourceWatch'
import ShareImageButton from './ShareImageButton'
import Shortlist from './Shortlist'
import { longDate, price, providerName } from '../lib/format'
import { modelPath } from '../lib/models'
import { createDeflatorShareImage } from '../lib/share-image'
import { shareImageFilename } from '../lib/share'
import type { FeedData, PriceChange, PriceModel } from '../lib/types'

function direction(value: number): string {
  const difference = value - 100
  if (Math.abs(difference) < 0.005) return 'unchanged since inception'
  return `${Math.abs(difference).toFixed(2)} points ${difference < 0 ? 'below' : 'above'} inception`
}

function isModel(model: PriceModel | undefined): model is PriceModel {
  return Boolean(model)
}

function countWord(value: number, capitalized = false): string {
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
  const word = words[value] ?? value.toLocaleString('en-US')
  return capitalized ? word.charAt(0).toUpperCase() + word.slice(1) : word
}

function moveSummary(event: PriceChange): string {
  const side = event.field === 'input_mtok' ? 'Input' : 'Output'
  const verb = event.to < event.from ? 'fell' : 'rose'
  const percent = event.pct === null ? '' : ` ${Math.abs(event.pct).toFixed(1)}%`
  return `${side} ${verb}${percent}, from ${price(event.from)} to ${price(event.to)} / Mtok`
}

export default function FrontLedger({ data }: { data: FeedData }) {
  const { meta, changes } = data
  const basketMean = meta.basketMean ?? meta.indexBaseMean * (meta.indexValue / meta.indexBase)
  const basketModels = meta.basket
    .map((key) => data.prices.models.find((model) => model.key === key))
    .filter(isModel)
  const latestMove = changes.changes.find((event): event is PriceChange => event.type === 'price')
  const hasIndexMovement = meta.indexHistory.length > 1

  return (
    <section id="price-ledger" className="front-ledger" aria-labelledby="ledger-title">
      <div className="front-section-heading">
        <div><p className="section-kicker">The price ledger</p><h2 id="ledger-title" className="section-title">The market in numbers</h2></div>
        <a className="text-link" href="/tape/">Browse all {meta.modelCount} models →</a>
      </div>
      <dl className="front-market-snapshot">
        <div><dt>Frontier basket</dt><dd>{price(basketMean)}</dd><dd className="snapshot-detail">Mean output price / million tokens · {countWord(meta.basket.length)} providers</dd></div>
        <div><dt>Token price deflator</dt><dd>{meta.indexValue.toFixed(2)}</dd><dd className="snapshot-detail">{direction(meta.indexValue)}</dd></div>
        <div><dt>Price file</dt><dd className="snapshot-date">{longDate(meta.asOf)}</dd><dd className="snapshot-detail">Posted rates · <a href="/methodology/">Sources &amp; methodology →</a></dd></div>
      </dl>
      <SourceWatch provenance={data.provenance} />

      {latestMove && (
        <a className={`front-signal ${latestMove.to < latestMove.from ? 'cut' : 'rise'}`} href={modelPath(latestMove.key)}>
          <span>Latest verified move</span>
          <strong>{latestMove.display}</strong>
          <span>{moveSummary(latestMove)}</span>
          <small>Model card →</small>
        </a>
      )}

      <Shortlist models={data.prices.models} asOf={meta.asOf} />

      <section className="mt-12 border-t border-ink pt-5" aria-labelledby="chart-title">
        <div className="chart-heading">
          <div>
            <p className="section-kicker">Chain-linked output price index</p>
            <h2 id="chart-title" className="section-title">
              The Token Price Deflator
            </h2>
          </div>
          <div className="chart-heading-aside">
            <p>
              Tracks posted price changes in the current {countWord(meta.basket.length)}-provider basket. A successor enters at a neutral link value, so changing the model does not move the index by itself.
            </p>
            <ShareImageButton
              createImage={() => createDeflatorShareImage({
                points: meta.indexHistory,
                asOf: meta.asOf,
                basketCount: meta.basket.length,
                basketLabels: basketModels.map((model) => model.display),
              })}
              filename={shareImageFilename('the-deflator')}
              shareTitle="The Token Price Deflator — The Marginal Token"
              shareText="The chain-linked index of posted frontier AI output API prices."
            />
          </div>
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
                The line will begin when a verified constituent price changes. Successor substitutions are bridged and do not move the index by themselves.
              </p>
            </div>
          </div>
        )}
        <div className="index-basket-register">
          <div className="index-basket-copy">
            <p className="section-kicker">Current constituents</p>
            <h3>{countWord(meta.basket.length, true)} models setting today&apos;s frontier basket.</h3>
            <p>The basket mean is {price(basketMean)} per million output tokens. Replacing a predecessor changes this list, while the deflator continues from the prior reading.</p>
          </div>
          <ol className="basket-snapshot" aria-label="Current Token Price Deflator basket">
            {basketModels.map((model) => (
              <li key={model.key}>
                <a href={modelPath(model.key)}>
                  <span>{providerName(model.provider)}</span>
                  <strong>{model.display}{model.releaseStage === 'preview' ? ' · Preview' : ''}</strong>
                  <small>{price(model.output_mtok)} output / Mtok</small>
                </a>
              </li>
            ))}
          </ol>
        </div>
        <div className="chart-caption">
          <span>Inception: {longDate(meta.indexBaseDate)}</span>
          <span>Chain-linked · {meta.basket.length} current constituents</span>
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
    </section>
  )
}
