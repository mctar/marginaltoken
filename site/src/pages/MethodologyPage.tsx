import { longDate } from '../lib/format'
import { providerName } from '../lib/format'
import type { MetaFeed, ProvenanceFeed } from '../lib/types'

export default function MethodologyPage({ meta, provenance }: { meta: MetaFeed; provenance: ProvenanceFeed | null }) {
  return (
    <main id="main" className="mx-auto max-w-publication px-4 pt-10 sm:px-6 sm:pt-14">
      <header className="page-heading methodology-heading">
        <p className="section-kicker">Notes on the numbers</p>
        <h1>Methodology</h1>
        <p>
          The Marginal Token records posted API prices. The aim is narrow: a consistent public tape for the cost of model input and output.
        </p>
      </header>

      <article className="methodology-grid">
        <section>
          <span className="method-number">01</span>
          <h2>What is tracked</h2>
          <p>
            The Tape lists text-token input and output rates in US dollars per million tokens. Free models, batch variants, aliases, and variable-price routers are excluded. Cache reads, cache writes, tools, images, audio, and per-request charges are outside this edition. Modality, reasoning, tool, structured-output, release-stage, and lifecycle filters use objective metadata published with the OpenRouter model record; missing capabilities are not inferred. Audio input and audio output are separate requirements.
          </p>
        </section>
        <section>
          <span className="method-number">02</span>
          <h2>Where prices come from</h2>
          <p>
            OpenRouter supplies the broad model list. Its model-level figure is the lowest listed rate available through its routing market. The collector also scans official pricing pages from Anthropic, OpenAI, Google, Mistral, Moonshot AI, DeepSeek, and xAI every hour. Each provider is parsed and cached independently. A verified first-party row replaces the matching OpenRouter row; failed scans retain that provider's last-good snapshot and surface a source warning.
          </p>
        </section>
        <section>
          <span className="method-number">03</span>
          <h2>The Shortlist</h2>
          <p>
            The Shortlist is an editorial view over the Tape, capped at 15 permanent market slots: four Anthropic tiers, three OpenAI tiers, three Google tiers, and one current general-purpose model each from xAI, Mistral, DeepSeek, Moonshot AI, and Qwen. A reviewed successor replaces its predecessor in the same slot; the underlying historical record remains intact. First-party and routed quotes are labelled separately. Open-weight models are omitted when no single comparable standard API rate exists.
          </p>
        </section>
        <section>
          <span className="method-number">04</span>
          <h2>The index</h2>
          <p>
            The Deflator uses output prices only. The basket holds one current, production, general-purpose frontier representative per independent model provider. A model must have public first-party API access and a posted standard global rate. Each provider has equal weight. The mean current output price is divided by the basket mean on {longDate(meta.indexBaseDate)}, then multiplied by 100.
          </p>
        </section>
        <section>
          <span className="method-number">05</span>
          <h2>Rebalancing</h2>
          <p>
            Basket eligibility is explicit in the curated file, which permits exactly one representative per provider. A successor enters when its provider positions it as the current production frontier model and publishes direct API pricing. Genuine successor substitutions are part of the index result. Provider additions and corrections are treated as methodology changes and rebased at inception so they do not appear as price moves. Every ordinary basket change is recorded in the public change feed.
          </p>
        </section>
        <section>
          <span className="method-number">06</span>
          <h2>Detection and publication</h2>
          <p>
            The collector checks OpenRouter and every supported official source hourly. A price move must exceed $0.0001 per million tokens after rounding to four decimals. DeepSeek now publishes time-banded standard rates, so the Tape records its peak weekday rate as the deterministic quote and labels the 50%-lower off-peak schedule. A valid change produces one feed revision. Failed, empty, or materially incomplete responses leave last-good data in place. Provider freshness and matching-key disagreements are published in the source-health feed. The site republishes only when prices or source status change.
          </p>
        </section>
        <section>
          <span className="method-number">07</span>
          <h2>Share images</h2>
          <p>
            Every principal visualization, including comparable venue panels, can be exported as a 1200 × 630 pixel PNG. The image is drawn in the browser from the same structured data as the page rather than captured from the screen. Each export permanently includes marginaltoken.com, the price-file date, and a concise source description. Native file sharing is used where available; otherwise the image is copied or downloaded locally.
          </p>
        </section>
        <section>
          <span className="method-number">08</span>
          <h2>The machine note</h2>
          <p>
            When verified events enter the tape, a local Gemma 4 26B model may phrase them as a short note. It receives only the current revision's structured facts. Deterministic checks reject unsupported figures, inferred causes, invalid output, and copy outside the house rules. A failed note never blocks the underlying feed.
          </p>
        </section>
        <section>
          <span className="method-number">09</span>
          <h2>Honesty caveats</h2>
          <p>
            These are list prices, not negotiated prices. Standard rates are used, not batch, cached, flex, priority, regional, or long-context premiums. Tokenizers differ, so equal token counts do not always represent equal text. Price says nothing by itself about model quality. Nothing here is investment advice.
          </p>
        </section>
        <section>
          <span className="method-number">10</span>
          <h2>Venue comparisons</h2>
          <p>
            Model cards and The Spreads combine OpenRouter route records with direct Standard pricing from Together AI and Fireworks AI. Priority, Fast, US-only, batch, and size-banded marketplace rates are excluded. Direct sources override only the fields they explicitly publish; configuration fields retained from a route record carry separate provenance, while unreported limits remain unknown. A spread is calculated only when canonical model, reported precision, context window, maximum output, reasoning, tool, and structured-output support match. The market ranking excludes configurations whose posted prices are identical. Disclosed precision is labelled declared; undisclosed precision is nominal. Missing limits are never treated as comparable. These groups do not establish equal quality, throughput, residency, reliability, or contractual terms.
          </p>
        </section>
        <section>
          <span className="method-number">11</span>
          <h2>Rent vs Run</h2>
          <p>
            The infrastructure view keeps deployment metadata separate from the API price tape. NVIDIA NIM availability, lifecycle, and supported hardware profiles come from NVIDIA documentation; free hosted development endpoints are not treated as zero-cost production quotes. A selected profile records the published GPU family, tensor parallelism, precision, and optimization mode, and its tensor-parallel value sets GPUs per deployment. It is a compatibility record, not a performance benchmark. API spend uses the selected posted route basis. Self-hosted cost remains a planning model driven by visible assumptions for GPU-hours, usable utilization, aggregate output throughput, and annual software cost. Throughput is not inferred from model size or generalized from another benchmark. The first-deployment break-even is shown only when it occurs before the modeled output capacity is exhausted. Hardware, power, staffing, storage, networking, input-prefill pressure, reliability and negotiated terms remain outside the estimate. If verification fails, the last-good profile register remains visible with a stale source status rather than silently disappearing.
          </p>
        </section>
      </article>

      {provenance && (
        <section id="source-health" className="source-health" aria-labelledby="source-health-title">
          <p className="section-kicker">Operational provenance</p>
          <div className="source-health-heading">
            <h2 id="source-health-title" className="section-title">Source health</h2>
            <p>{provenance.conflictCount} cross-source {provenance.conflictCount === 1 ? 'difference' : 'differences'} recorded.</p>
          </div>
          <div className="source-health-grid">
            {provenance.providers.map((source) => (
              <a href={source.sourceUrl} key={source.provider}>
                <span>{providerName(source.provider)}</span>
                <strong>{source.status.replace('_', ' ')}</strong>
                <small>{source.lastVerified ? `Verified ${source.lastVerified}` : 'No automated verification yet'}</small>
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="source-register" aria-labelledby="source-title">
        <p className="section-kicker">Primary sources</p>
        <h2 id="source-title" className="section-title">Source register</h2>
        <div>
          <a href="https://openrouter.ai/api/v1/models">OpenRouter models API</a>
          <a href="https://docs.together.ai/docs/serverless-models">Together AI serverless models</a>
          <a href="https://docs.fireworks.ai/serverless/pricing">Fireworks AI serverless pricing</a>
          <a href="https://platform.claude.com/docs/en/about-claude/pricing">Anthropic pricing</a>
          <a href="https://developers.openai.com/api/docs/pricing">OpenAI pricing</a>
          <a href="https://ai.google.dev/gemini-api/docs/pricing">Google pricing</a>
          <a href="https://docs.mistral.ai/inference/pricing">Mistral pricing</a>
          <a href="https://www.kimi.com/resources/kimi-k3-pricing">Kimi pricing</a>
          <a href="https://api-docs.deepseek.com/quick_start/pricing/">DeepSeek pricing</a>
          <a href="https://docs.x.ai/developers/models">xAI pricing</a>
          <a href="https://docs.nvidia.com/nim/large-language-models/latest/reference/support-matrix.html">NVIDIA NIM support matrix</a>
          <a href="https://docs.nvidia.com/nim/large-language-models/1.15.0/supported-models.html">NVIDIA NIM optimized profiles</a>
          <a href="https://docs.nvidia.com/ai-enterprise/lifecycle/latest/application-software.html">NVIDIA AI Enterprise lifecycle catalog</a>
          <a href="https://docs.nvidia.com/nim/large-language-models/2.0.4-pb6/reference/support-matrix.html">NVIDIA NIM production branch</a>
        </div>
      </section>
    </main>
  )
}
