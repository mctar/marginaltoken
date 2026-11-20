import LocalCostExample from '../components/LocalCostExample'
import { useState } from 'react'
import { calculateCost, comparisonPath } from '../lib/compare'
import { longDate, price, billAmount } from '../lib/format'
import { examples, meteredTotal, readQuantity } from '../lib/worked-examples'
import type { PricesFeed } from '../lib/types'

function MeterExample({ kind }: { kind: keyof typeof examples }) {
  const example = examples[kind]
  const [values, setValues] = useState(example.meters.map((m) => String(m.quantity)))
  const total = meteredTotal(example.meters, values)
  return (
    <section className="workbench">
      <h2>{example.title}</h2>
      <p>{example.detail}</p>
      <div className="reader-controls">
        {example.meters.map((meter, i) => (
          <label key={meter.label}>
            {meter.label}
            <input
              type="number"
              min="0"
              step="1"
              value={values[i]}
              onChange={(e) => setValues(values.map((v, j) => (j === i ? e.target.value : v)))}
            />
            <small>
              {price(meter.usd)} per {meter.per.toLocaleString('en-US')}{' '}
              {kind === 'voice' ? 'seconds' : 'tokens'}
            </small>
          </label>
        ))}
      </div>
      <div className="bill-result" aria-live="polite">
        <span>Estimated service charge</span>
        <strong>
          {total === null ? 'Enter whole quantities of zero or more' : billAmount(total)}
        </strong>
      </div>
      <p>{example.boundary}</p>
      <a href={example.source}>Read the tariff checked {longDate(example.checked)} →</a>
    </section>
  )
}

function TextExample({ prices, error }: { prices?: PricesFeed; error?: string }) {
  const [documents, setDocuments] = useState('1000')
  const calls = readQuantity(documents)
  const models = ['openai/gpt-6.2-sol', 'anthropic/claude-haiku-5.5']
    .map((key) => prices?.models.find((m) => m.key === key && m.source === 'firstparty'))
    .filter((m) => m !== undefined)
  const workload = { calls: calls ?? 0, inputTokens: 2000, outputTokens: 200 }
  return (
    <section className="workbench">
      <h2>Summarise a collection of documents</h2>
      <p>
        Assume one request per document, with 2,000 input tokens and a 200-token summary. Get a
        better estimate by measuring a sample of your own documents.
      </p>
      <div className="reader-controls">
        <label>
          Documents per month
          <input
            type="number"
            min="0"
            step="1"
            value={documents}
            onChange={(e) => setDocuments(e.target.value)}
          />
        </label>
      </div>
      {prices ? (
        <>
          <div className="bill-pair" aria-live="polite">
            {models.map((m) => (
              <div key={m.key}>
                <span>{m.display}</span>
                <strong>
                  {calls === null
                    ? 'Enter a whole document count'
                    : billAmount(calculateCost(m, workload).monthlyTotal)}
                </strong>
                <small>
                  Per month at {price(m.input_mtok)} input and {price(m.output_mtok)} output per
                  million tokens.{' '}
                  {m.verificationStatus && m.verificationStatus !== 'fresh'
                    ? 'Dated fallback quote.'
                    : ''}
                </small>
              </div>
            ))}
          </div>
          {models.length < 2 && (
            <p>Some example models have no current direct quote in this price file.</p>
          )}
          <p>
            Standard direct rates in the {longDate(prices.asOf)} ledger. The example assumes
            uncached text and a successful first attempt. Test summary quality before choosing.
          </p>
          {calls !== null && models.length > 0 && (
            <a
              href={comparisonPath(
                models.map((m) => m.key),
                workload,
              )}
            >
              Adjust tokens, retries and review in the full calculator →
            </a>
          )}
        </>
      ) : (
        <p role="status">
          {error
            ? 'The live text quotes could not be read. You can still use the dated voice and image examples.'
            : 'Loading the current direct quotes…'}
        </p>
      )}
    </section>
  )
}

export default function CostsPage({ prices, error }: { prices?: PricesFeed; error?: string }) {
  const requested = new URLSearchParams(location.search).get('example')
  const kind =
    requested === 'voice' || requested === 'images' || requested === 'ocr' ? requested : 'text'
  return (
    <main id="main" className="reader-page">
      <header className="reader-heading">
        <h1>Compare costs</h1>
        <p>Pick a job and change the quantities to see what goes into the bill.</p>
      </header>
      <nav className="reader-tabs" aria-label="Worked examples">
        {[
          ['text', 'Summarise documents'],
          ['voice', 'Run a voice session'],
          ['images', 'Edit an image'],
          ['ocr', 'Run OCR locally'],
        ].map(([id, label]) => (
          <a
            key={id}
            aria-current={id === kind ? 'page' : undefined}
            href={'/costs/?example=' + id}
          >
            {label}
          </a>
        ))}
      </nav>
      {kind === 'text' ? (
        <TextExample prices={prices} error={error} />
      ) : kind === 'ocr' ? (
        <LocalCostExample />
      ) : (
        <MeterExample key={kind} kind={kind} />
      )}
      <aside className="reader-next">
        <h2>Price your own workload</h2>
        <div className="reader-links">
          <a href="/compare/">API bill calculator</a>
          <a href="/infrastructure/">Rent vs Run</a>
          <a href="/plan/">Advanced fleet planning</a>
          <a href="/spreads/">Compare hosting venues</a>
          <a href="/watch/">Saved scenarios</a>
        </div>
      </aside>
    </main>
  )
}
