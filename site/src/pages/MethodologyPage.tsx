import { longDate } from '../lib/format'
import { providerName } from '../lib/format'
import { modelPath } from '../lib/models'
import type { MetaFeed, ProvenanceFeed } from '../lib/types'

export default function MethodologyPage({ meta, provenance }: { meta: MetaFeed; provenance: ProvenanceFeed | null }) {
  const reviewCandidates = provenance?.reviewCandidates ?? []

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
          <span className="method-number">Decision tools</span>
          <h2>Open weights and workload economics</h2>
          <p>The open shelf verifies that the exact linked Hugging Face repository lists model weight files. License IDs distinguish permissive, custom, and unknown terms; gated access is disclosed. Training data and code are not assessed. A missing repository does not classify a model as proprietary.</p>
          <p>The decision feed checks public sources daily. Failed checks retain dated last-good records; the frontend excludes verification older than seven days. Detailed billing plans cover Anthropic, OpenAI, and conservatively parsed Google text-token rows. Routed quotes preserve reported cache rates. Unknown rates required by a workload prevent a complete estimate. Visitors select the applicable context tier. Cache storage is a monthly token-hour quantity.</p>
          <p>Presets are illustrative; success rates, token multipliers, and rate overrides are visitor supplied. For independent success probability p and at most n attempts, acceptance is 1 − (1 − p)ⁿ and expected attempts are acceptance / p (n when p is zero). API and review costs apply to every attempt. Review does not change the entered success probability. Total modeled spend is divided by expected accepted tasks; zero acceptance has no finite cost per successful task. Scenario files are processed in the browser, and shared URLs include aggregate assumptions.</p>
        </section>

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
            OpenRouter supplies the broad model list. Its model-level figure is the lowest listed rate available through its routing market. The collector also scans official pricing pages from Anthropic, OpenAI, Google, Mistral, Moonshot AI, DeepSeek, and xAI every hour. Each provider is parsed and cached independently. A verified first-party row replaces the matching OpenRouter row; failed model checks retain dated fallback rates and surface a source warning without blocking other models. A new paid OpenRouter listing from one of these providers enters a persistent review queue, but remains a routed quote until its official rate and production status are verified.
          </p>
        </section>
        <section>
          <span className="method-number">Data corrections</span>
          <h2>21 October 2026 · OpenAI output prices</h2>
          <p>The 20 October collection read cache-write prices as output prices for seven OpenAI models after the provider reordered its pricing table. The affected quotes and historical observations have been corrected, the false price-cut events removed, and the index recalculated while preserving genuine price changes. Pricing columns are now matched by name.</p>
          <p>Deprecated Google API IDs whose official pricing rows were removed remain in the historical register. They no longer trigger current-price verification warnings; any remaining hosted quotes retain their routed source.</p>
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
          <h2>The basket and deflator</h2>
          <p>
            The Frontier Basket and Token Price Deflator use output prices only. The basket holds one current general-purpose frontier representative per independent model provider. A model must have public first-party API access and a posted standard global rate. A public preview may represent its provider when it is the current flagship; preview status is labelled. The active standard-tier rate is used, including a publicly posted sale price. The basket statistic is the simple mean of those current quotes. The deflator begins at 100 on {longDate(meta.indexBaseDate)} and chain-links each verified observation to the one before it.
          </p>
        </section>
        <section>
          <span className="method-number">05</span>
          <h2>Rebalancing</h2>
          <p>
            Basket eligibility is explicit in the curated file, which permits exactly one representative per provider. A successor enters when its provider positions it as the current frontier model and publishes direct API pricing. At that link, a new constituent is valued at its current price in both the current and reference baskets, so the substitution itself cannot move the deflator. Price changes to continuing constituents still do. Provider additions use the same neutral bridge; methodology corrections require an explicit rebase. Every basket change is recorded in the public change feed.
          </p>
        </section>
        <section>
          <span className="method-number">06</span>
          <h2>Detection and publication</h2>
          <p>
            The collector checks OpenRouter and every supported official source hourly. A price move must exceed $0.0001 per million tokens after rounding to four decimals. DeepSeek now publishes time-banded standard rates, so the Tape records its peak weekday rate as the deterministic quote and labels the 50%-lower off-peak schedule. A valid change produces one feed revision. Failed, empty, or materially incomplete responses leave last-good data in place. Provider freshness, matching-key disagreements, and unresolved first-party discovery signals are published in the source-health feed. A signal remains visible until the model is verified into the register, explicitly reviewed as out of scope, or removed from OpenRouter. The site republishes only when prices or source status change.
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
            Verified NVIDIA NIM profiles record GPU compatibility, tensor parallelism, precision and optimization. Custom plans require current weight verification and entered runtime and memory assumptions. Monthly costs include either rental or owned-hardware amortization, plus entered power, software, staffing and other operating charges. Standby deployments incur costs without adding serving capacity. Aggregate memory fit is a capacity estimate, not proof of runtime support. Throughput and utilization are entered assumptions, with sensitivity tables; input-prefill pressure, queueing and reliability need workload measurements. The first-deployment break-even is shown only before modeled capacity is exhausted. Published API rates can exclude cache, context-band, tool and regional charges; use Plan or Compare for request-level billing.
          </p>
        </section>
      </article>

      {provenance && (
        <section id="source-health" className="source-health" aria-labelledby="source-health-title">
          <p className="section-kicker">Operational provenance</p>
          <div className="source-health-heading">
            <h2 id="source-health-title" className="section-title">Source health</h2>
            <p>
              {provenance.conflictCount} cross-source {provenance.conflictCount === 1 ? 'difference' : 'differences'} · {provenance.reviewCandidateCount ?? reviewCandidates.length} discovery {(provenance.reviewCandidateCount ?? reviewCandidates.length) === 1 ? 'signal' : 'signals'} awaiting review.
            </p>
          </div>
          <div className="source-health-grid">
            {provenance.providers.map((source) => (
              <a href={source.sourceUrl} key={source.provider}>
                <span>{providerName(source.provider)}</span>
                <strong>{source.status.replace('_', ' ')}</strong>
                {source.freshModelCount !== undefined && <small>{source.freshModelCount} of {source.modelCount} models verified on the latest scan</small>}
                <small>{source.lastVerified ? `Oldest verification ${source.lastVerified}` : 'No automated verification yet'}</small>
                {(source.reviewCandidateCount ?? 0) > 0 && <small>{source.reviewCandidateCount} new model {source.reviewCandidateCount === 1 ? 'signal' : 'signals'}</small>}
                {source.detail && <small>{source.detail}</small>}
              </a>
            ))}
          </div>
          {reviewCandidates.length > 0 && (
            <div className="source-review-queue">
              <p className="section-kicker">OpenRouter discovery signals</p>
              <div className="source-health-grid">
                {reviewCandidates.map((candidate) => (
                  <a href={modelPath(candidate.key)} key={candidate.key}>
                    <span>{providerName(candidate.provider)}</span>
                    <strong>{candidate.display}</strong>
                    <small>First seen {candidate.discoveredAt.slice(0, 10)} · ${candidate.input_mtok}/M input · ${candidate.output_mtok}/M output</small>
                  </a>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <section className="methodology-section plan-panel">
        <p className="section-kicker">Decision tools</p>
        <h2>Assumptions, measurements and saved decisions</h2>
        <p>The shared register separates canonical ledger keys, reviewed route aliases and provider API IDs. Basket promotions require reviewed identities in approved families and freshly verified official prices. The open shelf also requires stable status and current verification of the exact weight repository. New discoveries remain pending; a higher price or a new name does not change family policy.</p>
        <p>The mixed-fleet planner charges a first attempt on every request and a second attempt on the escalated fraction. Acceptance rates are conditional on keeping the first result or using the escalated result. Usage CSVs are parsed locally using declared token conventions, and per-request prompt bounds are required to establish price bands. The capability/budget view uses reader-supplied accepted-task counts for matching task and suite versions, with sample sizes and confidence intervals. Neither prices nor capability flags imply equal quality.</p>
        <p>Hosting cards describe dated, scoped product terms. Routed settings and region guarantees require their own verification. Historical prices carry saved source details where available; older provenance remains unrecorded. An expected promotion end is distinct from an observed price change. Browser watches compare saved published-quote baselines with current feeds on return; exported scenarios may contain your assumptions. RSS publishes observed price moves, listings, lifecycle events and editorial notes without creating a daily article.</p>
      </section>

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
          <a href="https://platform.kimi.ai/">Kimi pricing</a>
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
