import { frontPageStories, marketNotes, marketNotePath, noteKindLabel } from '../lib/market-notes'
import { tasks } from '../lib/field-guide'
import { examples, meteredTotal } from '../lib/worked-examples'
import { longDate } from '../lib/format'
import type { FeedData } from '../lib/types'

const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export default function FrontPage({ data, feedError }: { data?: FeedData; feedError?: string }) {
  const { lead, recent } = frontPageStories(marketNotes)
  const weekly = marketNotes.find(
    (n) => n.kind === 'weekly' && n.date <= new Date().toISOString().slice(0, 10),
  )
  const sample = examples.voice
  const total = meteredTotal(
    sample.meters,
    sample.meters.map((m) => String(m.quantity)),
  )!
  return (
    <main id="main" className="reader-page front-reader">
      <div className="reader-purpose">
        <p>A field guide to AI models, how to access them and what they cost to use.</p>
        <a href="/understand/">Start here →</a>
      </div>
      <div className="cover-grid">
        {lead && (
          <article className="reader-lead">
            <p className="reader-meta">
              {noteKindLabel(lead)} · <time dateTime={lead.date}>{longDate(lead.date)}</time>
            </p>
            <h1>
              <a href={marketNotePath(lead)}>{lead.frontHeadline ?? lead.title}</a>
            </h1>
            <p className="reader-deck">{lead.frontSummary ?? lead.summary}</p>
            <a className="reader-action" href={marketNotePath(lead)}>
              Read the {lead.kind === 'weekly' ? 'weekly review' : 'note'} →
            </a>
            {lead.kind !== 'weekly' && weekly && (
              <a className="weekly-front-link" href={marketNotePath(weekly)}>
                Latest weekly review →
              </a>
            )}
          </article>
        )}
        <aside className="front-example">
          <p className="reader-meta">Worked example</p>
          <h2>What does a voice session cost?</h2>
          <p>GPT-Live 1.1 charges different rates for talking and standby.</p>
          <dl>
            {sample.meters.map((m) => (
              <div key={m.label}>
                <dt>
                  {m.quantity / 60} {m.label.toLowerCase().replace('seconds', 'minutes')}
                </dt>
                <dd>{dollars.format((m.quantity * m.usd) / m.per)}</dd>
              </div>
            ))}
            <div className="total">
              <dt>Session charge</dt>
              <dd>{dollars.format(total)}</dd>
            </div>
          </dl>
          <small>Backend models and tools are additional.</small>
          <a href="/costs/?example=voice">Calculate a voice session →</a>
        </aside>
      </div>
      <section className="reader-section">
        <div className="reader-rule">
          <h2>Explore by task</h2>
          <a href="/explore/">All examples →</a>
        </div>
        <div className="task-map">
          {tasks.map((t) => (
            <a key={t.id} href={'/explore/?task=' + t.id}>
              <h3>
                {t.label} <span aria-hidden="true">↗</span>
              </h3>
              <p>{t.detail}</p>
            </a>
          ))}
        </div>
      </section>
      <section className="reader-section">
        <div className="reader-rule">
          <h2>From the editorial desk</h2>
          <a href="/notes/">Search all notes →</a>
        </div>
        <div className="story-grid">
          {recent.map((note) => (
            <article key={note.slug}>
              <time className="reader-meta" dateTime={note.date}>
                {longDate(note.date)}
              </time>
              <h3>
                <a href={marketNotePath(note)}>{note.title}</a>
              </h3>
              <p>{note.summary}</p>
            </article>
          ))}
          <article>
            <span className="reader-meta">Reader’s guide</span>
            <h3>
              <a href="/understand/#access">What do you get when you download the weights?</a>
            </h3>
            <p>
              Check the files, the license and the hardware before comparing self-hosting with an
              API.
            </p>
          </article>
        </div>
      </section>
      <section id="price-ledger" className="reader-section">
        <div className="reader-rule">
          <h2>The price ledger</h2>
          <a href="/ledger/">Shortlist &amp; market index →</a>
        </div>
        <p>
          {data
            ? data.meta.modelCount + ' priced listings · ' + longDate(data.meta.asOf)
            : feedError
              ? 'The current ledger is temporarily unavailable.'
              : 'Loading the price ledger…'}{' '}
          <a className="text-link" href="/tape/">
            Browse prices →
          </a>
        </p>
      </section>
    </main>
  )
}
