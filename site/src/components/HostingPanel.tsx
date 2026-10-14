import facts from '../../../collector/hosting-reviewed.json' with { type: 'json' }
import { providerName } from '../lib/format'
import type { OfferModel, PriceModel } from '../lib/types'

export default function HostingPanel({
  model,
  offerModel,
}: {
  model: PriceModel
  offerModel: OfferModel | null
}) {
  const hosts = [...new Set(offerModel?.offers.map((o) => o.venue) ?? [])]
  const direct = model.source === 'firstparty'
  const relevant = new Set([
    model.provider.toLowerCase(),
    ...hosts.map((h) => h.toLowerCase()),
    'openrouter',
  ])
  const services = facts.services.filter((s) =>
    s.matches.some((m) => relevant.has(m)),
  )
  const age = (Date.now() - Date.parse(facts.reviewedAt)) / 86400000
  return (
    <section className="plan-panel hosting-panel">
      <p className="section-kicker">Where the request goes</p>
      <h2>Developer, host, and router</h2>
      <div className="plan-metrics">
        <div>
          <span>Model developer</span>
          <strong>{providerName(model.provider)}</strong>
        </div>
        <div>
          <span>Tape quote access</span>
          <strong>{direct ? 'Direct API' : 'OpenRouter'}</strong>
        </div>
        <div>
          <span>Serving hosts reported</span>
          <strong>{hosts.length || (direct ? 'Lab API' : 'Unreported')}</strong>
        </div>
      </div>
      <p>{facts.scope}</p>
      {hosts.length > 0 && (
        <p className="decision-note">
          Reported venues: {hosts.join(', ')}. Exact precision, limits and
          prices are in the offer table. A venue name does not establish its
          retention settings or serving region for this routed offer.
        </p>
      )}
      <p className="decision-note">
        Terms reviewed {facts.reviewedAt}
        {age > 30
          ? ' · Review overdue; confirm current terms before relying on these facts.'
          : ''}
        .
      </p>
      <div className="hosting-cards">
        {services.map((s) => (
          <article key={s.id}>
            <h3>{s.label}</h3>
            <dl>
              <dt>Retention</dt>
              <dd>{s.retention}</dd>
              <dt>Training use</dt>
              <dd>{s.training}</dd>
              <dt>Published region options</dt>
              <dd>{s.regions}</dd>
            </dl>
            <p className="decision-note">
              {s.sources.map((source, i) => (
                <span key={source.href}>
                  {i > 0 && ' · '}
                  <a href={source.href} target="_blank" rel="noreferrer">
                    {source.label}
                  </a>
                </span>
              ))}
            </p>
            <a href={`/compare/?model=${encodeURIComponent(model.key)}`}>
              Price this workload →
            </a>
          </article>
        ))}
      </div>
      {hosts.filter(
        (host) =>
          !facts.services.some((s) => s.matches.includes(host.toLowerCase())),
      ).length > 0 && (
        <p className="decision-note">
          Retention, training and regions are unreviewed for other listed
          venues. Consult that host’s published product terms.
        </p>
      )}
    </section>
  )
}
