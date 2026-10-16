import { shortDate } from '../lib/format'
import type { EditorialLink, WeeklyReview } from '../lib/market-notes'

export function EditorialLinks({ links }: { links: EditorialLink[] }) {
  return <div className="editorial-links">{links.map((link) => <a key={link.href} href={link.href}>{link.label} <span aria-hidden="true">↗</span></a>)}</div>
}

export default function WeeklyReviewBody({ note }: { note: WeeklyReview }) {
  const cutoff = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Zurich', timeZoneName: 'short',
  }).format(new Date(note.cutoff))
  return <>
    <p className="weekly-cutoff"><strong>{note.editionStatus === 'week-so-far' ? 'Week so far' : 'Completed week'}</strong> · Checked through {cutoff}.</p>
    <div className="market-note-body">{note.paragraphs.map((p) => <p key={p}>{p}</p>)}</div>
    <section className="weekly-section" aria-labelledby="weekly-releases">
      <h2 id="weekly-releases">Available this week</h2>
      <div className="weekly-table-wrap" role="region" aria-label="Model release register" tabIndex={0}>
        <table className="weekly-table">
          <caption>USD per million input / output tokens unless stated otherwise. Quotes checked at the edition cutoff.</caption>
          <thead><tr><th scope="col">Model / date</th><th scope="col">Access &amp; terms</th><th scope="col">Why it matters</th></tr></thead>
          <tbody>{note.releases.map((entry) => <tr key={entry.name}>
            <th scope="row"><strong>{entry.name}</strong><time dateTime={entry.date}>{shortDate(entry.date)}</time></th>
            <td><span className="weekly-access">{entry.access}</span><p>{entry.terms}</p></td>
            <td><p>{entry.implication}</p><EditorialLinks links={entry.links} /></td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
    <section className="weekly-section" aria-labelledby="weekly-takeaways">
      <p className="section-kicker">The practical reading</p>
      <h2 id="weekly-takeaways">What to revisit</h2>
      <ol className="weekly-takeaways">{note.takeaways.map((item) => <li key={item.title}>
        <h3>{item.title}</h3><p>{item.text}</p><EditorialLinks links={item.links} />
      </li>)}</ol>
    </section>
    {[
      { id: 'weekly-updates', title: 'Changes to existing models', entries: note.updates },
      { id: 'weekly-watching', title: 'Announced or awaiting wider access', entries: note.watching },
    ].map((section) => section.entries.length > 0 && <section className="weekly-section" aria-labelledby={section.id} key={section.id}>
      <h2 id={section.id}>{section.title}</h2>
      <div className="weekly-briefs">{section.entries.map((item) => <article key={item.title}>
        <h3>{item.title}</h3><p>{item.text}</p><EditorialLinks links={item.links} />
      </article>)}</div>
    </section>)}
    <p className="weekly-coverage">{note.coverage}</p>
  </>
}
