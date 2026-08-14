# The Marginal Token

The Marginal Token is a static publication about the posted price of AI model tokens. It combines a standard-library Python collector, a public JSON feed, and a Vite, React, and Tailwind frontend.

The live site is intended for `https://marginaltoken.com`. Phase 1 has no backend, browser credentials, analytics, cookies, or trackers.

## Project layout

```text
collector/   Fetch, normalize, validate, diff, and index prices
data/        Five committed public feed files
site/        Static three-route publication
deploy/      GitHub Pages publisher and systemd units
```

OpenRouter provides the broad tape. Official pricing adapters scan Anthropic, OpenAI, Google, Mistral, Moonshot AI, DeepSeek, and xAI independently on every hourly run. `collector/firstparty.json` is the reviewed cold-start fallback and model register. Each provider has exactly one index representative; the Anthropic, OpenAI, and Google registers also track additional current model tiers. Verified first-party rows replace matching OpenRouter rows.

## Feed contract

The five deterministic files carry the same `generatedAt` revision timestamp. An optional machine note is published only when it matches that revision.

- `data/prices.json`: current normalized models, provenance, context, per-million-token rates, input modalities, API capabilities, release stage, and optional lifecycle metadata.
- `data/history.json`: the inception snapshot plus one point per model for each detected price change.
- `data/changes.json`: up to 500 typed `price`, `listed`, `delisted`, and `basket` events, newest first.
- `data/meta.json`: the current index, persisted base, current basket, and chart-ready index history.
- `data/provenance.json`: provider freshness plus matching-key differences between verified first-party and OpenRouter prices.
- `data/brief.json`: an optional, revision-matched headline and two-sentence note generated locally from verified events.

The Deflator is an equal-weighted output-price index. The basket contains one current, production, general-purpose frontier representative per independent provider, using its public first-party standard global API rate. The current mean is divided by the inception mean and multiplied by 100. Genuine successor substitutions affect the index and produce a basket event; provider additions and methodology corrections are rebased rather than reported as price moves.

## Collector

The collector uses Python 3.11 or newer and no packages outside the standard library.

```bash
python3 collector/collect.py
```

OpenRouter prices are converted from dollars per token to dollars per million tokens with `Decimal`, then rounded to four decimal places. Free rows, batch variants, aliases, negative variable-price routers, and malformed entries are excluded.

The collector refuses to replace the feed when:

- the request, JSON parse, or curated-file validation fails;
- fewer than 100 normalized models remain;
- the model count falls below 80% of the previous revision;
- duplicate identifiers or an empty index basket are found.

Failures return a non-zero exit status and leave `data/` untouched. This makes the systemd unit visibly fail and prevents it from publishing after a bad collection. Operational status is written to the ignored `collector/state/heartbeat.json` file. A successful feed change creates `collector/state/publish-pending`. That marker remains until publication succeeds, which makes a failed build or push retryable on the next timer run.

Official sources have independent last-good snapshots in `collector/state/firstparty-last-good.json`. One unavailable or changed provider page therefore cannot erase another provider's verified data. A source is marked stale after 48 hours without successful verification, and the public source-health feed distinguishes fresh, last-good, stale, and manual fallback data. Matching OpenRouter prices are compared field by field and disagreements are published while the verified first-party rate remains authoritative.

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

The Vite development server reads the five root feed files directly. The production build copies them into `site/dist/data`, includes `CNAME` and `.nojekyll`, and creates static entry documents for `/tape/` and `/methodology/`.

```bash
npm test
npm run build
npm run preview
```

`npm run preview` serves the completed production build at an HTTP address,
normally `http://127.0.0.1:4173/`.

The frontend contains no chart library. The Deflator is a small accessible SVG chart. The Shortlist is a 15-slot editorial view of the general-purpose enterprise API shelf, rendered as paired input/output markers on a common logarithmic price scale. The Tape sorts all six columns in the browser and provides URL-shareable search, provider, source, price, context, basket, capability, lifecycle, and provenance filters. The Compare view costs two to four selected models against a shared request volume and keeps its selections and workload assumptions in the URL. Model cards surface strictly cheaper stable matches that preserve all recorded modalities, capabilities, and context, with direct two-model comparison links. A current machine note appears between the chart and Latest moves; a missing, invalid, or stale note is omitted without affecting the page.

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

Add the model metadata and a reviewed fallback rate to `collector/firstparty.json`, preserving the OpenRouter-compatible `provider/model` key when one exists. Add or extend that provider's strict parser in `collector/official.py` and a compact source fixture in `collector/tests/test_official.py`. Standard uncached, non-batch, global rates are used. For tiered products, record the lowest standard context tier and explain it in `rate_note`.

## Updating The Shortlist

`site/src/lib/shortlist.ts` defines 15 permanent editorial slots rather than discovering models from names. When a lab releases a production successor, verify its standard API rate, add its key to the front of the appropriate slot's `candidates` list, and keep the prior key as a fallback. Do not add dated snapshots, image/audio variants, coding-only models, fast modes, or extra provider tiers. Preview models are used only when they are the current enterprise-facing top tier and are labelled in the visualization. A first-party model row remains authoritative; OpenRouter-only entries are visibly marked as routed quotes.

## Phase 2 placeholder

`collector/endpoints.py` records the intended boundary for per-host OpenRouter prices. The Spreads view, cache and batch tracking, a full Cut Log, calculators, RSS, and generated social images are not part of Phase 1.
