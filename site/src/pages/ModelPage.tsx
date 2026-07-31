import { useState } from 'react'
import { modelComparisonPath } from '../lib/compare'
import { contextSize, longDate, price, providerName } from '../lib/format'
import { capabilityTags, modalityList, modelPath } from '../lib/models'
import type { PriceModel } from '../lib/types'

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  const field = document.createElement('textarea')
  field.value = value
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.append(field)
  field.select()
  const copied = document.execCommand('copy')
  field.remove()
  if (!copied) throw new Error('Copy unavailable')
}

function modelSource(model: PriceModel): { href: string; label: string } {
  if (model.source === 'firstparty' && model.sourceUrl) {
    return { href: model.sourceUrl, label: 'First-party pricing' }
  }
  return { href: `https://openrouter.ai/${model.key}`, label: 'OpenRouter listing' }
}

export default function ModelPage({ model, asOf }: { model: PriceModel; asOf: string }) {
  const [shareStatus, setShareStatus] = useState('')
  const tags = capabilityTags(model)
  const source = modelSource(model)
  const path = modelPath(model.key)

  const share = async () => {
    const url = `${window.location.origin}${path}`
    const text = `${model.display}: ${price(model.input_mtok)} input and ${price(model.output_mtok)} output per million tokens.`

    if (navigator.share) {
      try {
        await navigator.share({ title: `${model.display} — The Marginal Token`, text, url })
        setShareStatus('Shared')
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }

    try {
      await copyText(url)
      setShareStatus('Link copied')
    } catch {
      setShareStatus('Copy unavailable — use the address bar')
    }
  }

  return (
    <main id="main" className="model-page mx-auto max-w-publication px-4 pt-8 sm:px-6 sm:pt-12">
      <a className="model-breadcrumb" href="/tape/">← Back to The Tape</a>

      <article className="model-card">
        <header className="model-card-header">
          <div>
            <p className="section-kicker">Model card · {providerName(model.provider)}</p>
            <h1>{model.display}</h1>
            <p className="model-key">{model.key}</p>
          </div>
          <div className="model-share">
            <div className="model-share-actions">
              <a href={modelComparisonPath(model.key)}>Compare cost</a>
              <button type="button" onClick={share}>Share model</button>
            </div>
            <span aria-live="polite">{shareStatus}</span>
          </div>
        </header>

        <section className="model-price-grid" aria-label="Standard token prices">
          <div>
            <span>Input</span>
            <strong>{price(model.input_mtok)}</strong>
            <small>per million tokens</small>
          </div>
          <div>
            <span>Output</span>
            <strong>{price(model.output_mtok)}</strong>
            <small>per million tokens</small>
          </div>
          <div>
            <span>Context</span>
            <strong>{contextSize(model.context)}</strong>
            <small>input tokens</small>
          </div>
        </section>

        <section className="model-card-body">
          <div className="model-facts">
            <h2>Profile</h2>
            <dl>
              <div>
                <dt>Provider</dt>
                <dd>{providerName(model.provider)}</dd>
              </div>
              <div>
                <dt>Release stage</dt>
                <dd>{model.releaseStage ? providerName(model.releaseStage) : 'Stable'}</dd>
              </div>
              <div>
                <dt>Input modes</dt>
                <dd>{modalityList(model.inputModalities)}</dd>
              </div>
              <div>
                <dt>Output modes</dt>
                <dd>{modalityList(model.outputModalities)}</dd>
              </div>
              {model.maxOutputTokens && (
                <div>
                  <dt>Maximum output</dt>
                  <dd>{model.maxOutputTokens.toLocaleString('en-US')} tokens</dd>
                </div>
              )}
              {model.knowledgeCutoff && (
                <div>
                  <dt>Knowledge cutoff</dt>
                  <dd>{model.knowledgeCutoff}</dd>
                </div>
              )}
              {model.expirationDate && (
                <div>
                  <dt>Expiration</dt>
                  <dd>{longDate(model.expirationDate)}</dd>
                </div>
              )}
            </dl>
          </div>

          <div className="model-capabilities">
            <h2>Capabilities</h2>
            {tags.length > 0 ? (
              <ul>
                {tags.map((tag) => <li key={tag}>{tag}</li>)}
              </ul>
            ) : (
              <p>No additional capability metadata is published for this listing.</p>
            )}
          </div>
        </section>

        <footer className="model-provenance">
          <div>
            <span>Price file</span>
            <strong>As of {longDate(asOf)}</strong>
          </div>
          <div>
            <span>Source</span>
            <a href={source.href}>{source.label}</a>
            {model.checked && <small>Checked {longDate(model.checked)}</small>}
          </div>
          {model.rateNote && (
            <div>
              <span>Rate note</span>
              <strong>{model.rateNote}</strong>
            </div>
          )}
          {model.huggingFaceId && (
            <div>
              <span>Model weights</span>
              <a href={`https://huggingface.co/${model.huggingFaceId}`}>Hugging Face</a>
            </div>
          )}
        </footer>
      </article>

      <p className="model-card-note">
        Standard published API rates, excluding batch, cache, flex, priority, regional, and long-context adjustments unless noted. Price is not a measure of model quality.
      </p>
    </main>
  )
}

export function MissingModelPage() {
  return (
    <main id="main" className="model-page mx-auto max-w-publication px-4 pt-10 sm:px-6 sm:pt-14">
      <header className="page-heading">
        <p className="section-kicker">Model card</p>
        <h1>Model not found</h1>
        <p>This listing is not in the current price file. It may have moved or been delisted.</p>
      </header>
      <a className="model-breadcrumb model-missing-link" href="/tape/">Browse The Tape →</a>
    </main>
  )
}
