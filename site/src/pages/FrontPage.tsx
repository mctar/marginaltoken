import DeflatorChart from '../components/DeflatorChart'
import LatestMoves from '../components/LatestMoves'
import MachineNote from '../components/MachineNote'
import ShareImageButton from '../components/ShareImageButton'
import Shortlist from '../components/Shortlist'
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

export default function FrontPage({ data }: { data: FeedData }) {
  const { meta, changes } = data
  const basketMean = meta.basketMean ?? meta.indexBaseMean * (meta.indexValue / meta.indexBase)
  const basketModels = meta.basket
    .map((key) => data.prices.models.find((model) => model.key === key))
    .filter(isModel)
  const latestMove = changes.changes.find((event): event is PriceChange => event.type === 'price')
  const hasIndexMovement = meta.indexHistory.length > 1

  return (
    <main id="main" className="mx-auto max-w-publication px-4 pt-10 sm:px-6 sm:pt-14">
      <section className="front-lead" aria-labelledby="front-title">
        <div>
          <p className="section-kicker">Frontier basket + token deflator</p>
          <h1 id="front-title" className="front-title">
            The price of intelligence, marked to market.
          </h1>
          <p className="standfirst">
            As of {longDate(meta.asOf)}, the {countWord(meta.basket.length)}-provider basket carries an equal-weight mean output price of {price(basketMean)} per million tokens.
          </p>
        </div>
        <aside
          className={`basket-brief ${meta.indexValue < 100 ? 'down' : meta.indexValue > 100 ? 'up' : 'flat'}`}
          aria-label="Current frontier basket price and chain-linked Token Price Deflator reading"
        >
          <span>Frontier basket</span>
          <strong>{price(basketMean)}</strong>
          <small>Mean output price / Mtok</small>
          <div className="deflator-brief">
            <span>Token price deflator</span>
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
                  <strong>{model.display}</strong>
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
    </main>
  )
}
