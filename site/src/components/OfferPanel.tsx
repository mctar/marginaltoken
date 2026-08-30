import { useEffect } from 'react'
import ShareImageButton from './ShareImageButton'
import { contextSize, longDate, price } from '../lib/format'
import { modelPath } from '../lib/models'
import {
  MAX_VISIBLE_OFFER_GROUPS,
  comparableOfferCount,
  comparableOfferGroups,
  offersForGroup,
  widestOutputSpread,
} from '../lib/offers'
import { createOffersShareImage } from '../lib/share-image'
import { shareImageFilename } from '../lib/share'
import type { OfferComparisonGroup, OfferModel, PriceModel } from '../lib/types'

function capabilitySummary(group: OfferComparisonGroup): string {
  const capabilities = [
    group.supportsReasoning ? 'Reasoning' : null,
    group.supportsTools ? 'Tools' : null,
    group.supportsStructuredOutput ? 'Structured output' : null,
  ].filter(Boolean)
  return capabilities.length > 0 ? capabilities.join(' · ') : 'No core capabilities reported'
}

function configurationLabel(group: OfferComparisonGroup): string {
  const precision = group.quantization === 'undisclosed'
    ? 'Precision undisclosed'
    : group.quantization.toUpperCase()
  return `${precision} · ${contextSize(group.context)} context`
}

function spreadText(value: number | undefined): string {
  if (!value) return 'No spread'
  return `High quote +${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}%`
}

function targetedGroupKey(): string {
  if (typeof window === 'undefined') return ''
  try {
    return decodeURIComponent(window.location.hash.replace(/^#/, ''))
  } catch {
    return ''
  }
}

function offerSourceLabel(source: string | undefined): string {
  return source && source !== 'openrouter-endpoints' ? 'Direct pricing' : 'OpenRouter route'
}

export default function OfferPanel({
  model,
  offerModel,
  asOf,
}: {
  model: PriceModel
  offerModel: OfferModel
  asOf: string
}) {
  const groups = comparableOfferGroups(offerModel)
  const targetGroupKey = targetedGroupKey()
  const targetGroup = groups.find((group) => group.key === targetGroupKey)
  const leadingGroups = groups.slice(0, targetGroup ? MAX_VISIBLE_OFFER_GROUPS - 1 : MAX_VISIBLE_OFFER_GROUPS)
  const visibleGroups = targetGroup && !leadingGroups.includes(targetGroup)
    ? [...leadingGroups, targetGroup]
    : groups.slice(0, MAX_VISIBLE_OFFER_GROUPS)
  const hiddenGroupCount = groups.length - visibleGroups.length
  const sources = offerModel.sources?.length
    ? offerModel.sources
    : [{ key: 'openrouter-endpoints' as const, label: 'OpenRouter endpoints', sourceUrl: offerModel.sourceUrl }]

  useEffect(() => {
    if (!targetGroup) return
    window.requestAnimationFrame(() => document.getElementById(targetGroup.key)?.scrollIntoView({ block: 'start' }))
  }, [targetGroup])

  return (
    <section className="model-offers" aria-labelledby="venue-offers-title">
      <header className="model-offers-heading">
        <div>
          <p className="section-kicker">Venue market</p>
          <h2 id="venue-offers-title">Venue offers</h2>
        </div>
        <div className="model-offers-heading-aside">
          <p>
            Like-for-like venue offers only. Canonical model, precision, context, output limit, and core API capabilities must match before prices share a spread.
          </p>
          {groups.length > 0 && (
            <ShareImageButton
              createImage={() => createOffersShareImage({
                model,
                offerModel,
                asOf,
                path: modelPath(model.key),
              })}
              filename={shareImageFilename(`${model.display}-venue-offers`)}
              shareTitle={`${model.display} venue offers — The Marginal Token`}
              shareText={`Like-for-like venue API price ranges for ${model.display}.`}
            />
          )}
        </div>
      </header>

      {groups.length > 0 ? (
        <>
          <dl className="offer-market-summary">
            <div>
              <dt>Comparable offers</dt>
              <dd>{comparableOfferCount(groups).toLocaleString('en-US')}</dd>
            </div>
            <div>
              <dt>Configurations</dt>
              <dd>{groups.length.toLocaleString('en-US')}</dd>
            </div>
            <div>
              <dt>Widest output gap</dt>
              <dd>+{widestOutputSpread(groups).toLocaleString('en-US', { maximumFractionDigits: 2 })}%</dd>
            </div>
          </dl>

          <div className="offer-group-list">
            {visibleGroups.map((group, index) => {
              const offers = offersForGroup(offerModel, group.key)
              return (
                <details
                  className="offer-group"
                  id={group.key}
                  key={group.key}
                  open={group.key === targetGroupKey || (!targetGroupKey && index === 0)}
                >
                  <summary>
                    <div className="offer-configuration">
                      <span className={`offer-confidence ${group.confidence}`}>
                        {group.confidence === 'declared' ? 'Declared match' : 'Nominal match'}
                      </span>
                      <strong>{configurationLabel(group)}</strong>
                      <small>
                        {group.offerCount} {group.offerCount === 1 ? 'offer' : 'offers'} · {group.venueCount} {group.venueCount === 1 ? 'venue' : 'venues'}
                        {group.maxOutputTokens ? ` · ${contextSize(group.maxOutputTokens)} max output` : ''}
                      </small>
                    </div>
                    <div className="offer-range-pair">
                      <div>
                        <span>Input</span>
                        <strong>{price(group.input_mtok.min)}–{price(group.input_mtok.max)}</strong>
                        <small>{spreadText(group.input_mtok.spreadPct)}</small>
                      </div>
                      <div>
                        <span>Output</span>
                        <strong>{price(group.output_mtok.min)}–{price(group.output_mtok.max)}</strong>
                        <small>{spreadText(group.output_mtok.spreadPct)}</small>
                      </div>
                    </div>
                  </summary>

                  <div className="offer-group-body">
                    <p className="offer-capabilities">{capabilitySummary(group)}</p>
                    <div className="offer-table-wrap">
                      <table className="offer-table">
                        <thead>
                          <tr>
                            <th scope="col">Venue</th>
                            <th scope="col">Route</th>
                            <th scope="col">Input / Mtok</th>
                            <th scope="col">Output / Mtok</th>
                          </tr>
                        </thead>
                        <tbody>
                          {offers.map((offer) => (
                            <tr key={`${offer.venue}:${offer.tag}`}>
                              <th scope="row">
                                {offer.venue}
                                <a
                                  className={`offer-source-label ${offer.source && offer.source !== 'openrouter-endpoints' ? 'direct' : ''}`}
                                  href={offer.sourceUrl ?? offerModel.sourceUrl}
                                >
                                  {offerSourceLabel(offer.source)}
                                </a>
                              </th>
                              <td><code>{offer.tag}</code></td>
                              <td>{price(offer.input_mtok)}</td>
                              <td>{price(offer.output_mtok)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </details>
              )
            })}
          </div>
          {hiddenGroupCount > 0 && (
            <p className="offer-hidden-note">
              {hiddenGroupCount} additional matching {hiddenGroupCount === 1 ? 'configuration is' : 'configurations are'} retained in the public feed; this card leads with declared precision and the widest spreads.
            </p>
          )}
        </>
      ) : (
        <div className="offer-empty">
          <strong>No like-for-like spread yet.</strong>
          <p>
            {offerModel.offers.length.toLocaleString('en-US')} venue {offerModel.offers.length === 1 ? 'offer is' : 'offers are'} published, but no two report a matching configuration complete enough to compare.
          </p>
        </div>
      )}

      <footer className="offer-source-note">
        <p>
          Declared matches report precision; nominal matches do not. Direct catalogs verify only the fields they publish, and missing limits remain non-comparable. Posted prices are not a quality, latency, residency, reliability, or SLA comparison.
        </p>
        <div className="offer-source-links">
          <span>Sources:</span>
          {sources.map((source) => <a href={source.sourceUrl} key={source.key}>{source.label}</a>)}
          <span>· {longDate(asOf)}</span>
        </div>
      </footer>
    </section>
  )
}
