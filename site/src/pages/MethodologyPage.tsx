import { longDate } from '../lib/format'
import type { MetaFeed } from '../lib/types'

export default function MethodologyPage({ meta }: { meta: MetaFeed }) {
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
            The Tape lists text-token input and output rates in US dollars per million tokens. Free models, batch variants, aliases, and variable-price routers are excluded. Cache reads, cache writes, tools, images, audio, and per-request charges are outside this edition.
          </p>
        </section>
        <section>
          <span className="method-number">02</span>
          <h2>Where prices come from</h2>
          <p>
            OpenRouter supplies the broad model list. Its model-level figure is the lowest listed rate available through its routing market. Six first-party rows are checked by hand against public pricing pages from Anthropic, OpenAI, Google, Mistral, DeepSeek, and xAI. A curated row replaces the matching OpenRouter row.
          </p>
        </section>
        <section>
          <span className="method-number">03</span>
          <h2>The index</h2>
          <p>
            The Deflator uses output prices only. The basket holds the cheapest eligible flagship in the curated file for each provider. Each provider has equal weight. The mean current output price is divided by the basket mean on {longDate(meta.indexBaseDate)}, then multiplied by 100.
          </p>
        </section>
        <section>
          <span className="method-number">04</span>
          <h2>Rebalancing</h2>
          <p>
            Basket eligibility is explicit in the curated file. When a provider gains a cheaper eligible flagship, that model enters the basket. The substitution is part of the index result because it changes the posted cost of buying a current flagship token. Every basket change is recorded in the public change feed.
          </p>
        </section>
        <section>
          <span className="method-number">05</span>
          <h2>Detection and publication</h2>
          <p>
            The collector checks hourly. A price move must exceed $0.0001 per million tokens after rounding to four decimals. A valid change produces one feed revision. Failed, empty, or materially incomplete responses leave the prior revision untouched. The site republishes only when the tape changes.
          </p>
        </section>
        <section>
          <span className="method-number">06</span>
          <h2>Honesty caveats</h2>
          <p>
            These are list prices, not negotiated prices. Standard rates are used, not batch, cached, flex, priority, regional, or long-context premiums. Tokenizers differ, so equal token counts do not always represent equal text. Price says nothing by itself about model quality. Nothing here is investment advice.
          </p>
        </section>
      </article>

      <section className="source-register" aria-labelledby="source-title">
        <p className="section-kicker">Primary sources</p>
        <h2 id="source-title" className="section-title">Source register</h2>
        <div>
          <a href="https://openrouter.ai/api/v1/models">OpenRouter models API</a>
          <a href="https://platform.claude.com/docs/en/about-claude/pricing">Anthropic pricing</a>
          <a href="https://developers.openai.com/api/docs/models/gpt-5.6-sol">OpenAI pricing</a>
          <a href="https://ai.google.dev/gemini-api/docs/pricing">Google pricing</a>
          <a href="https://docs.mistral.ai/models/model-cards/mistral-medium-3-5-26-04">Mistral pricing</a>
          <a href="https://api-docs.deepseek.com/quick_start/pricing/">DeepSeek pricing</a>
          <a href="https://docs.x.ai/developers/models">xAI pricing</a>
        </div>
      </section>
    </main>
  )
}
