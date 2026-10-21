# The Marginal Token

The Marginal Token is a static publication about the posted price of AI model tokens. It combines a standard-library Python collector, a public JSON feed, and a Vite, React, and Tailwind frontend.

The live site is intended for `https://marginaltoken.com`. Phase 1 has no backend, browser credentials, analytics, cookies, or trackers.

## Project layout

```text
collector/   Fetch, normalize, validate, diff, and index prices
data/        Five committed public feed files
site/        Static publication and decision tools
deploy/      GitHub Pages publisher and systemd units
```

OpenRouter provides the broad tape. Official pricing adapters scan Anthropic, OpenAI, Google, Mistral, Moonshot AI, DeepSeek, and xAI independently on every hourly run. `collector/model-register.json` is the sole reviewed source for identities, API IDs, lifecycle, fallback prices, basket families, and shortlist policies. `firstparty.json` is a generated legacy export, never an editable policy source. Fresh official rates can promote reviewed successors within approved families; discovery alone cannot. Each provider has exactly one index representative, while the register also retains reviewed current tiers and recent production predecessors. Verified first-party rows replace matching OpenRouter rows. New paid OpenRouter listings from those providers act as discovery signals and remain in a persistent review queue until verified into the register, explicitly dismissed in `collector/firstparty-reviewed.json`, or delisted. A separate venue scan preserves OpenRouter's route-level offers and verifies supported fields against direct Standard pricing from Together AI and Fireworks AI without changing the single-quote Tape.

## Feed contract

The five core deterministic files carry the same `generatedAt` revision timestamp. An optional machine note is published only when it matches that revision. The venue-offer feed has its own revision because endpoint availability is collected independently.

- `data/prices.json`: current normalized models, provenance, context, per-million-token rates, input modalities, API capabilities, release stage, and optional lifecycle metadata.
- `data/history.json`: the inception snapshot plus one point per model for each detected price change.
- `data/changes.json`: up to 500 typed `price`, `listed`, `delisted`, and `basket` events, newest first.
- `data/meta.json`: the current absolute basket mean, chain-linked deflator, persisted base, named current basket, and chart-ready index history.
- `data/provenance.json`: provider freshness, matching-key price differences, and unresolved OpenRouter discovery signals for tracked first-party providers.
- `data/brief.json`: an optional, revision-matched headline and two-sentence note generated locally from verified events.
- `data/offers.json`: per-model marketplace offers with field-level source links, standard input/output rates, cache rates, context, quantization, maximum output, supported API parameters, and conservative like-for-like comparison groups.
- `data/decisions.json`: independently sourced weight repository and license records, dated verification status, and detailed lab cache, batch, and context billing plans.
- `data/deployment.json`: a separate reviewed NVIDIA NIM deployment register with lifecycle status and verified GPU, tensor-parallel, precision, and optimization profiles; it never enters the API price tape.

The Frontier Basket is the simple mean output price of one current, production, general-purpose frontier representative per independent provider, using public first-party standard global API rates. The Token Price Deflator is chain-linked between verified observations. A successor or newly added provider enters the reference basket at its current price, so a composition change is neutral; price moves in continuing constituents change the index. Basket changes remain visible as public events, while methodology corrections require an explicit rebase.

## Collector

The collector uses Python 3.11 or newer and no packages outside the standard library.

```bash
python3 collector/collect.py
python3 collector/nvidia.py
```

OpenRouter prices are converted from dollars per token to dollars per million tokens with `Decimal`, then rounded to four decimal places. Free rows, batch variants, aliases, negative variable-price routers, and malformed entries are excluded.

After the core price scan, `collector/endpoints.py` follows each retained model's OpenRouter endpoint link with bounded concurrency, then parses Together AI's model catalog and Fireworks AI's headline Standard pricing table. It stores venue offers separately rather than flattening them into the Tape. Priority, Fast, US-only, batch, and size-banded marketplace rates are excluded. A direct source overrides only the fields it explicitly reports. When it identifies the same route, its price and published configuration fields are marked as verified while unreported fields retain explicit OpenRouter route provenance. A direct-only offer with an unreported configuration or output limit remains incomplete and cannot enter a spread. Volatile latency and uptime observations are intentionally excluded; the public feed changes only when an offer, rate, configuration, or provenance changes.

Each venue source has an independent last-good path. A failed OpenRouter model request reuses that model's previous offer set, a fresh route feed must cover at least 80% of the target models, and failed direct refreshes reuse `collector/state/last-good-together.json` or `collector/state/last-good-fireworks.json`. Operational source health is written to `collector/state/offers-heartbeat.json` without causing a public-feed revision by itself.

An offer is grouped only with the same canonical model, exact reported quantization, context window, maximum output, and core reasoning, tool, and structured-output capabilities. Matching groups with disclosed precision are `declared`; matching proprietary or otherwise undisclosed precision is `nominal`; missing limits make a group `incomplete` and therefore non-comparable. Spread percentages are computed only inside a comparable group. These labels describe posted serving configurations, not quality, throughput, residency, reliability, or contractual equivalence.

The collector refuses to replace the feed when:

- the request, JSON parse, or curated-file validation fails;
- fewer than 100 normalized models remain;
- the model count falls below 80% of the previous revision;
- duplicate identifiers or an empty index basket are found.

Failures return a non-zero exit status and leave `data/` untouched. This makes the systemd unit visibly fail and prevents it from publishing after a bad collection. Operational status is written to the ignored `collector/state/heartbeat.json` file. A successful feed change creates `collector/state/publish-pending`. That marker remains until publication succeeds, which makes a failed build or push retryable on the next timer run.

Official sources have per-model last-good prices and verification dates in `collector/state/firstparty-last-good.json`. One removed or malformed price row cannot block valid siblings; each failed model retains its own dated fallback, or the reviewed cold-start price if no verified snapshot exists. Existing provider-wide snapshots are migrated on refresh. If the reviewed register gains a row or a previous parse was partial while a provider returns HTTP 304, the collector retries without cache validators. A model is marked stale after 48 hours without successful verification. The public source-health feed exposes each model's status and the provider's fresh-model count; the provider summary reports its most degraded row. Matching OpenRouter prices are compared field by field and disagreements are published while the verified first-party rate remains authoritative.

When a first party publishes multiple time-banded standard rates, the Tape uses the highest applicable standard rate as its deterministic quote rather than changing with the clock. DeepSeek's V4 peak weekday rate is therefore recorded, with its 50%-lower off-peak schedule stated in the model note.

`--rebase-index` is an operator-only correction path for the inception basket. It preserves the original base date, resets the basis to the corrected basket mean, and suppresses a false basket-move event. It must not be used for genuine market price changes.

When a feed revision contains events, `collector/editorial.py` sends at most five typed facts to the local Ollama endpoint and requests strict JSON from `gemma4:26b`. It rejects unsupported figures, inferred causes, invalid structure, forbidden punctuation, and copy outside the site rules. Failure leaves the prior note untouched; the frontend hides it because its revision no longer matches. Editorial status is recorded in `collector/state/editorial-heartbeat.json`.

Useful editorial overrides:

```bash
MARGINALTOKEN_EDITORIAL_MODEL=gemma4:26b python3 collector/editorial.py
MARGINALTOKEN_OLLAMA_URL=http://127.0.0.1:11434/api/generate python3 collector/editorial.py
```

Useful test overrides:

```bash
python3 collector/collect.py --source-file fixture.json --min-models 1
MARGINALTOKEN_MODELS_URL=https://example.test/models python3 collector/collect.py
python3 collector/collect.py --skip-firstparty-refresh
MARGINALTOKEN_FIRSTPARTY_MAX_STALE_HOURS=24 python3 collector/collect.py
MARGINALTOKEN_ENDPOINT_WORKERS=6 python3 collector/endpoints.py
MARGINALTOKEN_TOGETHER_URL=https://example.test/serverless-models.md python3 collector/endpoints.py
python3 collector/endpoints.py --no-together
MARGINALTOKEN_FIREWORKS_URL=https://example.test/pricing.md python3 collector/endpoints.py
python3 collector/endpoints.py --no-fireworks
```

## Development

Install the frontend once, then run the collector and development server:

```bash
npm install --prefix site
python3 collector/collect.py
npm run dev
```

Open the `Local` HTTP address printed by Vite, normally
`http://localhost:5173/`. Do not open `site/index.html` directly: browsers block
Vite's TypeScript modules and root-relative feed files under the `file://`
protocol.

The Vite development server reads the public root feeds. The production build copies them into `site/dist/data`, includes `CNAME` and `.nojekyll`, creates static entry documents for the tools, current and archived model cards, and editorial notes, and generates public RSS feeds.

```bash
npm test
npm run build
npm run preview
```

`npm run preview` serves the completed production build at an HTTP address,
normally `http://127.0.0.1:4173/`.

The frontend contains no chart library. The Token Price Deflator is a small accessible SVG chart with an always-visible register of its seven current constituents. The Shortlist is a 15-slot editorial view of the general-purpose enterprise API shelf, rendered as paired input/output markers on a common logarithmic price scale. The Tape sorts all six columns in the browser and provides URL-shareable search, provider, source, price, context, frontier-basket, capability, lifecycle, and provenance filters. The Compare view costs two to four selected models against a shared request volume and keeps its selections and workload assumptions in the URL. Rent vs Run compares current posted API routes with a transparent NVIDIA NIM capacity plan. Users choose an NVIDIA-verified hardware, tensor-parallel, precision, and optimization profile; its tensor-parallel value fixes GPUs per deployment, while throughput, utilization, GPU-hour, and software-cost assumptions remain visible and shareable. A break-even is accepted only when it occurs within modeled output capacity. Model cards surface strictly cheaper stable matches that preserve all recorded modalities, capabilities, and context, with direct two-model comparison links. When venue data exists, a model card also shows up to four conservative configuration groups and their source-labelled quotes; The Spreads ranks every non-zero like-for-like market gap. The large offers feed is fetched only on those market routes. The Shortlist, Deflator, comparison results, Rent vs Run result, model cards, venue panels, and market spreads each generate a 1200 × 630 PNG from their structured data. Every image includes the canonical site origin, the price-file date, and an explicit source line, then uses native file sharing, clipboard copy, or download according to browser support. A current machine note appears between the chart and Latest moves; a missing, invalid, or stale note is omitted without affecting the page.

## Editorial and weekly reviews

The front page leads with a recent weekly review and two Market Notes, followed by decision tools and the price ledger. Editorial remains readable if the price feed is loading or unavailable; source-health warnings stay beside the ledger. A weekly edition leads for fourteen days after its coverage ends, then yields to the most recent note.

Reviewed content lives in `site/src/content/market-notes.json`. Model notes retain their calculator and model-card links. Entries with `kind: "weekly"` use a dated coverage window, exact verification cutoff, release register, takeaways, existing-model updates and a separate announcements section. Set `editionStatus: "week-so-far"` for an incomplete week. Use the Monday start date in the slug and preserve it when completing an edition, so its URL and RSS identity remain stable. The `modelKeys` array controls which model-specific RSS feeds receive the review; do not invent keys or tariffs for models not on the ledger.

The Monday 07:00 Europe/Zurich editorial automation researches the previous complete Monday–Sunday and prepares a local draft for review. Its state is ignored at `collector/state/weekly-review.json`; drafts and source coverage are kept under `outputs/weekly-review-YYYY-MM-DD/`. Missing source coverage must remain explicit. A weight-verification date is not a launch date, and service-plan changes do not count as new models. Draft preparation does not approve publication.

## Publishing to GitHub Pages

`deploy/publish.sh` builds the site, checks out the remote `gh-pages` branch in a validated temporary directory, replaces its contents with `site/dist`, and pushes only when the branch changes. The default repository is `git@github.com:mctar/marginaltoken.git`. Override it when needed:

```bash
MARGINALTOKEN_REPO=git@github.com:OWNER/REPO.git deploy/publish.sh
```

The first successful run bootstraps `gh-pages` if the branch does not exist. Git authentication and authorisation must already work for the account running the service.

For hugin, copy the units to the user systemd directory. The supplied service expects the checkout at `~/marginaltoken`; edit `WorkingDirectory` when the path differs.

```bash
mkdir -p ~/.config/systemd/user
cp deploy/marginaltoken.service deploy/marginaltoken.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now marginaltoken.timer
systemctl --user start marginaltoken.service
journalctl --user -u marginaltoken.service -n 50
```

Enable lingering for the service account if hugin does not already have it. GitHub Pages must serve from the `gh-pages` branch. Add `marginaltoken.com` in the repository Pages settings, configure the domain's apex DNS records for GitHub Pages, verify the domain, and select Enforce HTTPS when the certificate is ready.

### Alternate hugin hostname

The GitHub Pages `CNAME` remains `marginaltoken.com`. To expose the same build at
`marginaltoken.btrbot.com` without changing the canonical Pages domain, serve
`site/dist` locally on hugin:

```bash
cp deploy/marginaltoken-web.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now marginaltoken-web.service
```

Add this rule before the final `http_status:404` entry in hugin's Cloudflare
tunnel configuration:

```yaml
- hostname: marginaltoken.btrbot.com
  service: http://127.0.0.1:4180
```

Then route the hostname to the existing tunnel and restart it:

```bash
sudo cloudflared tunnel route dns --overwrite-dns TUNNEL_ID marginaltoken.btrbot.com
sudo systemctl restart cloudflared
```

The hourly publisher rebuilds `site/dist`, so the alternate hostname follows
the same validated feed revisions as GitHub Pages.

## Updating first-party prices

Add the model metadata and a reviewed fallback rate to `collector/model-register.json`, preserving the OpenRouter-compatible `provider/model` key when one exists. Add or extend that provider's strict parser in `collector/official.py` and a compact source fixture in `collector/tests/test_official.py`. Standard uncached, non-batch, global rates are used. For context tiers, record the lowest standard tier; for time-banded prices, record the highest standard rate. Explain either choice in `rate_note`.

The first OpenRouter appearance of a paid model from a registered provider is written to `collector/state/firstparty-review-pending.json` and published in source health. Verification adds it to `collector/model-register.json`; an intentionally excluded variant is added to `collector/firstparty-reviewed.json` with a review date and reason. The queue is persistent, so an hourly rerun cannot silently clear an unresolved signal.

## Updating The Shortlist

`site/src/lib/shortlist.ts` defines 15 permanent editorial slots rather than discovering models from names. When a lab releases a production successor, verify its standard API rate, add its key to the front of the appropriate slot's `candidates` list, and keep the prior key as a fallback. Do not add dated snapshots, image/audio variants, coding-only models, fast modes, or extra provider tiers. Preview models are used only when they are the current enterprise-facing top tier and are labelled in the visualization. A first-party model row remains authoritative; OpenRouter-only entries are visibly marked as routed quotes.

## Venue offers

`collector/endpoints.py` preserves standard per-host OpenRouter offers and cache rates, then verifies or supplements fields from supported direct marketplace catalogs. Every offer carries its price source; mixed-source configuration fields carry separate provenance. Deterministic serving-configuration keys summarize price ranges only within conservative comparison groups. Model cards expose the leading declared configurations and widest spreads with expandable, source-labelled offer tables, while The Spreads ranks all non-zero comparable gaps. Batch or priority tiers, offer history, and claims of equivalent quality, throughput, reliability, or contractual terms remain outside this edition.

## Market notes

Reviewed editorial notes live in `site/src/content/market-notes.json`. Each has a permanent slug, publication and evidence-check dates, a byline and source links. Model notes also have a calculator link selecting the relevant model and published billing plan. The homepage shows the latest compact entry, `/notes/` preserves the archive, and each note has a static entry document with its own canonical URL and article metadata. Notes remain readable independently of price-feed availability and hourly revisions. To publish another reviewed note, add a record to the same register and build the site; no route or component changes are needed.

Use `kind: "standalone"` for notes about specialist models without a comparable ledger entry. These retain the article, sources and editorial RSS entry while omitting model-card and calculator links; publication does not create a price row or model-specific feed.

## Decision tools

`python3 collector/decisions.py` publishes `data/decisions.json` independently of the core price tape. Repository metadata is cached for 24 hours and checked against the exact model repository ID. Weight files, gated access, source dates, and license IDs are disclosed. Known permissive licenses are distinguished from custom and unknown terms; this is not an assessment of full open source AI. First-party billing plans currently cover Anthropic, OpenAI, and conservatively parsed Google text-token rows. Missing and ambiguous rates are omitted. A changed source format retains dated last-good records; records older than seven days are excluded by the frontend even if publication stops.

The Open models route has an eight-slot reviewed shortlist, a searchable stable-model shelf, license and tool filters, and a four-model comparison tray. Successors require a matching verified weight repository. The Tape and model cards expose the same classification.

Compare supports explicit lab standard, batch, and long-context plans; routed venue quotes; cache reads and writes; reasoning; cache token-hour storage; token and regional multipliers; and manual rate overrides. Unknown rates required by the workload prevent a complete estimate. Workload presets are illustrative. Outcome mode uses visitor-supplied success rates and bounded independent retries (1–10 attempts), charging API and human review costs on every attempt and dividing by expected accepted tasks. Zero acceptance has no finite cost per successful task. Scenario JSON import/export and shared URLs preserve aggregate assumptions; no prompts or evaluation task data are uploaded. Share images show modeled monthly cost and label entered assumptions.

The hourly service runs the decision collector alongside existing collectors, while its public source checks are cached daily. Deploy the updated unit and reload the user service manager when enabling this collector on an existing installation.

## NVIDIA NIM profiles

`collector/nvidia.py` verifies the reviewed NIM register against NVIDIA's lifecycle catalog and support matrices. It understands both the current machine-readable support rows and the per-model optimized-profile tables used by older NIM releases. On a successful collection it records the exact GPU labels, tensor-parallel counts, precisions, and optimization modes published for each model. A failed source check preserves the last-good register and marks that source stale; profile compatibility is never presented as measured throughput.

## Planning, watches and histories

`/plan/` contains mixed-fleet economics, local CSV repricing and evaluation/budget filtering. `/watch/` manages up to 20 browser-saved scenarios. Model cards carry scoped hosting facts, step plots, lifecycle events, accessible quote tables and CSV exports. Rent vs Run supports verified NIM profiles and declared custom runtimes, owned or rented hardware, memory fit and entered operating costs.

Usage imports are limited to 2 MiB / 10,000 rows. Download a template from Plan. Normalized `input_tokens` includes cache reads/writes; `output_tokens` is answer-only, with `reasoning_tokens` additional. OpenAI output includes reasoning, which is subtracted before charging once. Anthropic input is uncached, so cache fields are added; output already includes thinking. Provider formats are flattened aggregate exports using the shown column conventions, not every vendor's dashboard CSV layout. Nonzero usage needs a request count. `min_prompt_tokens` and `max_prompt_tokens` must bracket the inclusive average, and every bucket must fit its chosen tariff. `cache_duration` defaults to `5m`; `1h` requires a reported one-hour write price. Non-text, tool, cache-storage and negotiated fees require separate billing. Repricing fixes token counts and does not assert output equivalence.

Evaluations require model, task, suite, version, setting, accepted, total, date and source. Use exact ledger keys and describe the measured snapshot/runtime/effort in `setting`. Moving provider aliases are not accepted as evaluation identities. Only one configuration per model and task/suite/version is compared; quality thresholds can use the lower 95% Wilson bound. There are no invented benchmark scores or provider credentials.

The register is the only editable selection policy. Add reviewed identities, explicit stage, identity evidence, family and order to `collector/model-register.json`; add first-party fallback facts only when confirmed. A newly registered same-family successor can propagate through hourly verification without editing separate selection arrays. Unknown listings remain in the persistent review queue. Update the generated compatibility export with `python3 -m collector.export_register`. Historical aliases preserve their original quote identity; API successors are never interchangeable aliases.

The 14 October 2026 editorial review selects Gemini 4 Argon for Google's premium Shortlist slot and the standard Qwen3.8 Max (0902) snapshot for Qwen. Gemini 3.8 Flash remains Google's basket representative. The Qwen snapshot is an explicitly reviewed exception to the usual undated Shortlist policy; its routed quote is not a first-party tariff, a Prime serving tier, or the separately released open-weight model.

Argon's detailed plans cover Standard, Batch, Flex and Priority. The collector reads current and scheduled input, output and implicit-cache rates separately. Calculators label the introductory period and expose the December rates as planning scenarios; `lab:standard` follows the applicable dated rate. Expired introductory rates are excluded, while all plans still require recent source verification. Argon supports implicit cache hits for prompts of at least 4,096 tokens, with no explicit writes or storage. Calculators use the default synchronous 65,536-token output limit and shared 1,048,576-token context; background long decode requires separate capacity planning.

`collector/hosting-reviewed.json` records scoped, dated primary-source terms; cards mark reviews overdue after 30 days. The existing editorial watch checks consequential policy changes. `site/scripts/feeds.mjs` builds notes, price and lifecycle RSS plus individual feeds under `/feeds/model/<provider>/<model>.xml`; stable GUIDs and XML escaping prevent repeat stories and malformed feeds. A delisting does not establish provider retirement.

To preview against copied live feeds without modifying the tracked ledger, set `MARGINALTOKEN_DATA_DIR=/absolute/path/to/copied/feeds` for the production build. The normal build and deployment use the repository's `data/` directory.

The Open Models table defaults to stable releases. Its shareable `previews=1` switch also includes preview releases with current, matching weight verification; experimental models remain on the Tape. This display setting does not alter the curated open Shortlist or Frontier Basket.

Opus 5.5 has an explicit optional Fast billing plan, parsed from Anthropic's pricing page. The parser accepts both the original cache-first columns and the newer input/output-first table, including Haiku's combined context tiers. Fast cache rates use the parsed Standard multipliers only when the source confirms they apply; Fast is never combined with Batch. Standard remains the calculator default and the basket observation. Missing or ambiguous Fast rows are omitted without blocking valid Standard/Batch rows, and existing caches without the newly reviewed option refresh immediately.

`collector/weights-reviewed.json` holds dated deployment examples and license explanations for exact weight repositories. The weights collector follows a license link only if it identifies a listed file in that same repository, with common LICENSE filename fallbacks. A reviewed name is applied only when the currently fetched license file matches the reviewed SHA-256; otherwise the source metadata label remains. A public-HTML-only review, such as gated Muse Spark Open, does not override automated metadata or trigger gated raw-file downloads. The metadata schema refreshes older cached records once. Model cards show deployment examples with their review date, pinned evidence and a 30-day overdue marker. Publisher examples are distinct from verified NIM profiles, memory minima and measured throughput.

Exact `modelMappings` in `collector/weights-reviewed.json` can repair a reviewed upstream repository ID. They apply only to the named canonical model and listed old repository, preserve the reported identity and evidence in the price record, and leave other IDs unchanged. The independent weights collector must still verify the exact repository and weight files before the model appears in Open Models. Super VL uses this correction; it does not gain a curated slot or a different hosted precision.

Market Notes can select `calculatorKind: "infrastructure"` to link to a model’s custom Rent vs Run scenario. These notes omit an unrelated comparison model and do not supply unmeasured hardware assumptions. API comparison notes retain explicit plan selections.
