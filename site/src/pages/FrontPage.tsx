import DeflatorChart from '../components/DeflatorChart'
import LatestMoves from '../components/LatestMoves'
import MachineNote from '../components/MachineNote'
import { longDate } from '../lib/format'
import type { FeedData } from '../lib/types'

function direction(value: number): string {
  const difference = value - 100
  if (Math.abs(difference) < 0.005) return 'unchanged from 100 at inception'
  return `${Math.abs(difference).toFixed(2)} points ${difference < 0 ? 'below' : 'above'} 100 at inception`
}

export default function FrontPage({ data }: { data: FeedData }) {
  const { meta, changes } = data
  return (
    <main id="main" className="mx-auto max-w-publication px-4 pt-10 sm:px-6 sm:pt-14">
      <section className="front-lead" aria-labelledby="front-title">
        <div>
          <p className="section-kicker">The deflator</p>
          <h1 id="front-title" className="front-title">
            The price of intelligence, marked to market.
          </h1>
          <p className="standfirst">
            As of {longDate(meta.asOf)}, the index stands at {meta.indexValue.toFixed(2)}, {direction(meta.indexValue)}.
          </p>
        </div>
        <aside
          className={`index-brief ${meta.indexValue < 100 ? 'down' : meta.indexValue > 100 ? 'up' : 'flat'}`}
          aria-label="Current index reading"
        >
          <span>Index</span>
          <strong>{meta.indexValue.toFixed(2)}</strong>
          <small>Base {meta.indexBase.toFixed(0)}</small>
        </aside>
      </section>

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
        <DeflatorChart points={meta.indexHistory} />
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
