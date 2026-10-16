import FrontLedger from '../components/FrontLedger'
import { frontPageStories, marketNotes, marketNotePath, noteKindLabel } from '../lib/market-notes'
import { longDate } from '../lib/format'
import type { FeedData } from '../lib/types'

const tools = [
  { number: '01', title: 'Compare API costs', text: 'Price your workload, including caching, retries and human review.', href: '/compare/', action: 'Open the calculator' },
  { number: '02', title: 'Find an open model', text: 'Check downloadable weights, license terms and hosted alternatives.', href: '/open/', action: 'Explore open models' },
  { number: '03', title: 'Price self-hosting', text: 'Put hardware, capacity and utilization beside the API bill.', href: '/infrastructure/', action: 'Compare rent vs run' },
]

export default function FrontPage({ data, feedError }: { data?: FeedData; feedError?: string }) {
  const { lead, recent } = frontPageStories(marketNotes)
  return (
    <main id="main" className="front-page mx-auto max-w-publication px-4 sm:px-6">
      <div className="front-purpose">
        <p>Understand what AI costs.<br className="sm:hidden" /> Decide what to run.</p>
        <a href="#decision-tools">Find a tool <span aria-hidden="true">↓</span></a>
      </div>
      {lead ? <section className="front-editorial" aria-labelledby="front-title">
        <article className="front-cover-story">
          <div className="front-story-meta">
            <span className="section-kicker">{noteKindLabel(lead)}</span>
            {lead.kind === 'weekly' && lead.editionStatus === 'week-so-far' && <span className="edition-badge">Week so far</span>}
          </div>
          <h1 id="front-title"><a href={marketNotePath(lead)}>{lead.title}</a></h1>
          <p className="front-deck">{lead.summary}</p>
          <div className="front-story-footer">
            <a className="editorial-read-link" href={marketNotePath(lead)}>{lead.kind === 'weekly' ? 'Read the weekly review' : 'Read the market note'} <span aria-hidden="true">→</span></a>
            <time dateTime={lead.date}>{longDate(lead.date)}</time>
          </div>
          {lead.kind === 'weekly' && <ul className="front-story-topics" aria-label="In this edition">
            <li>New APIs</li><li>Open weights</li><li>What to test next</li>
          </ul>}
        </article>
        <aside className="front-recent" aria-labelledby="recent-notes-title">
          <div className="front-recent-heading"><h2 id="recent-notes-title">Market notes</h2><a href="/notes/">All notes →</a></div>
          {recent.map((note) => <article key={note.slug}>
            <time dateTime={note.date}>{longDate(note.date)}</time>
            <h3><a href={marketNotePath(note)}>{note.title}</a></h3>
            <p>{note.summary}</p>
          </article>)}
          <a className="front-rss" href="/feeds/notes.xml">Follow the editorial via RSS ↗</a>
        </aside>
      </section> : <h1 id="front-title" className="section-title">The price of buying and running AI</h1>}
      <section id="decision-tools" className="front-tools" aria-labelledby="tools-title">
        <div className="front-section-heading"><div><p className="section-kicker">From reading to a decision</p><h2 id="tools-title" className="section-title">Put the numbers to work</h2></div></div>
        <div className="front-tools-grid">{tools.map((tool) => <a key={tool.href} className="front-tool" href={tool.href}>
          <span className="front-tool-number">{tool.number}</span><h3>{tool.title}</h3><p>{tool.text}</p><span className="front-tool-action">{tool.action} →</span>
        </a>)}</div>
        <nav className="front-more-tools" aria-label="More decision tools">
          <span>Go further</span><a href="/plan/">Plan a mixed fleet →</a><a href="/spreads/">Compare serving venues →</a><a href="/watch/">Saved workloads &amp; alerts →</a>
        </nav>
      </section>
      {data ? <FrontLedger data={data} /> : <section className="front-ledger front-feed-status" aria-labelledby="ledger-title" aria-live="polite">
        <h2 id="ledger-title" className="section-title">The price ledger</h2>
        <p>{feedError ? 'The price feed is temporarily unavailable. The editorial archive is still available.' : 'Loading the latest price file…'}</p>
        {feedError && <a className="text-link" href="/">Retry the price feed →</a>}
      </section>}
    </main>
  )
}
