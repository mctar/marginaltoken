# The Marginal Token

The Marginal Token is a static publication about the posted price of AI model tokens. It combines a standard-library Python collector, a public JSON feed, and a Vite, React, and Tailwind frontend.

The live site is intended for `https://marginaltoken.com`. Phase 1 has no backend, browser credentials, analytics, cookies, or trackers.

## Project layout

```text
collector/   Fetch, normalize, validate, diff, and index prices
data/        Four committed public feed files
site/        Static three-route publication
deploy/      GitHub Pages publisher and systemd units
```

OpenRouter provides the broad tape. `collector/firstparty.json` supplies checked list prices for one eligible flagship from Anthropic, OpenAI, Google, Mistral, DeepSeek, and xAI. Curated rows replace matching OpenRouter rows.

## Feed contract

Every file carries the same `generatedAt` revision timestamp.

- `data/prices.json`: current normalized models, provenance, context, and per-million-token rates.
- `data/history.json`: the inception snapshot plus one point per model for each detected price change.
- `data/changes.json`: up to 500 typed `price`, `listed`, `delisted`, and `basket` events, newest first.
- `data/meta.json`: the current index, persisted base, current basket, and chart-ready index history.

The Deflator is an equal-weighted output-price index. The basket contains the cheapest entry marked `index_eligible` for each first-party provider. The current mean is divided by the inception mean and multiplied by 100. A newly eligible cheaper flagship affects the index and produces a basket event.

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

Failures return exit status zero and leave `data/` untouched. Operational status is written to the ignored `collector/state/heartbeat.json` file. A successful feed change creates `collector/state/publish-pending`. That marker remains until publication succeeds, which makes a failed build or push retryable on the next timer run.

Useful test overrides:

```bash
python3 collector/collect.py --source-file fixture.json --min-models 1
MARGINALTOKEN_MODELS_URL=https://example.test/models python3 collector/collect.py
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

The Vite development server reads the four root feed files directly. The production build copies them into `site/dist/data`, includes `CNAME` and `.nojekyll`, and creates static entry documents for `/tape/` and `/methodology/`.

```bash
npm test
npm run build
npm run preview
```

`npm run preview` serves the completed production build at an HTTP address,
normally `http://127.0.0.1:4173/`.

The frontend contains no chart library. The Deflator is a small accessible SVG chart. The Tape sorts all six columns in the browser and can be reduced to first-party rows.

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

## Updating first-party prices

Edit `collector/firstparty.json`, preserving the OpenRouter-compatible `provider/model` key when one exists. Update `source_url`, `checked`, and `rate_note` with every review. Standard uncached, non-batch, global rates are used. For tiered products, record the lowest standard context tier and explain it in `rate_note`.

## Phase 2 placeholder

`collector/endpoints.py` records the intended boundary for per-host OpenRouter prices. The Spreads view, cache and batch tracking, a full Cut Log, calculators, RSS, and generated social images are not part of Phase 1.
