> ## Documentation Index
> Fetch the complete documentation index at: https://docs.particle.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Usage & billing

> Token and web-search pricing, prepaid credits, and daily usage by SKU.

Prepaid credits, transparent per-token pricing, and exact metered usage. Chat and Responses use different usage field names; early steering terminals are an exception to receiving usage immediately.

## Prices

Default prices in USD per million tokens (account-specific overrides may apply; the Billing page always shows your effective prices):

| Model | Input (uncached) | Cached input | Output |
| - | - | - | - |
| `particle-1` | \$0.25 | \$0.03 | \$1.00 |
| `deepseek-v41-flash-1017` | \$0.25 | \$0.03 | \$1.00 |
| `glm-5.3-flash` | \$0.12 | \$0.03 | \$0.40 |

`particle-1` has independent price rules; the rates above are its current defaults. These are the **peak (standard)** prices. Scheduled off-peak pricing applies automatically:

| Period | Daily window (America/New\_York, follows DST) |
| - | - |
| Peak (standard) | 04:00 – 20:30 |
| Off-peak | 20:30 – 04:00 |

Off-peak defaults are **50% of the peak defaults** for every token rate — \$0.125 input / \$0.015 cached input / \$0.50 output on `deepseek-v41-flash-1017` and `particle-1`, and \$0.06 / \$0.015 / \$0.20 on `glm-5.3-flash`. Account-specific overrides apply per period independently. The period is selected once per request after routing and cannot be changed by request headers; the selected price is locked for the whole request, even across a period boundary. [Flex](#flex-pricing) discounts apply on top of the selected period's rates.

### Flex pricing

Requests whose effective [service tier](https://docs.particle.ai/service-tiers.html.md) is `flex` receive **50% off** their applicable uncached input, cached input, and output token prices, including account-specific token prices. Check `X-Particle-Service-Tier` to confirm the effective tier: requesting `flex` does not guarantee it if your account is not entitled to that tier. Tool fees are unchanged.

### Web search

Hosted web search costs **\$2.50 per 1,000 searches** (\$0.0025 per search) by default. Account-specific prices may apply; check **Tool pricing** on the platform Billing page. A successful search is charged even if it returns no results. Failed search calls are not charged.

The search fee is separate from model token charges. Search results included in the model's prompt also count toward input tokens. Flex discounts the model tokens, but does not discount the search fee.

## Token categories

* **Input tokens** — everything in `prompt_tokens` except the cached portion: `input = prompt_tokens − cached_tokens`.
* **Cached input tokens** — the prefix served from cache (`usage.prompt_tokens_details.cached_tokens`), billed at the cached rate. See [Prompt caching](https://docs.particle.ai/prompt-caching.html.md).
* **Output tokens** — `completion_tokens`, which **includes** reasoning tokens. Reasoning is a subset reported in `usage.completion_tokens_details.reasoning_tokens`, not a separate charge.

**Usage object**

```
"usage": {
  "prompt_tokens": 18234,
  "completion_tokens": 412,
  "total_tokens": 18646,
  "prompt_tokens_details": { "cached_tokens": 16384 },
  "completion_tokens_details": { "reasoning_tokens": 256 }
}
```

## How a request is billed

1. **Pre-flight:** the gateway checks that your account has a positive credit balance. Empty → `402 insufficient_credits`, nothing processed.
2. **Generation:** the API reports exact prompt/completion token counts.
3. **Settlement:** cost is computed per token category and charged to your credit balance. You are never billed without a usage record, and never have a usage record without a charge (free-access keys record at zero cost).

## Responses and steering

[Responses terminal usage](https://docs.particle.ai/responses.md#usage) reports `input_tokens`, `output_tokens`, `input_tokens_details.cached_tokens`, and `output_tokens_details.reasoning_tokens`. Cached input and reasoning are subsets, not additional tokens to add to the total.

Each automatic steering successor is a separately metered generation with its own input, output, and token budget. The original can continue generating privately while the successor runs; its entire hidden tail remains billable. Its early `response.incomplete` with reason `steered` has `usage: null`, not zero usage. Check platform usage records for the original's settled charge; the successor's usage does not include it.

Closing the WebSocket cancels remaining work on that connection, including hidden drains and other lanes, but does not undo charges for work already performed. See [Mid-turn steering](https://docs.particle.ai/steering.md#cost-and-cache-behavior).

## Credits

* Credits are prepaid via the platform Billing page (card top-up, optional auto top-up threshold).
* Balance is shared across all keys of your account; usage is attributed per key.
* Refunds/adjustments appear as separate usage records, not balance edits.

## Visibility

* **Per response:** Chat's `usage` object or terminal usage chunk, and Responses' terminal `response.usage`, report exact counts when available. An early steered terminal has no final usage; do not treat it as free or compute the whole conversation's cost from the successor alone.
* **Portal:** platform.particle.ai shows per-key usage history, spend by model, and detailed usage records.
* **Analytics API:** programmatic rollups (see [the platform section](https://docs.particle.ai/data-retention.html.md)) for 1/7/30/90-day windows.

## Detailed daily usage

In [the platform](https://platform.particle.ai/), select your team, open **Billing**, and choose **View detailed billing** beside **Recent credit activity**. You can also open [Daily billing line items](https://platform.particle.ai/?section=usage-details) directly.

A SKU identifies a billable product: a model such as `particle-ai/particle-1` or the **Web search** tool. The view breaks usage down by **UTC day, SKU, pricing period, and pricing treatment** across the selected team's API keys.

1. Choose **Today**, **Last 7 days**, **Last 30 days**, or **Last 90 days**. Each period includes the current UTC day; the selected date range appears above the totals.
2. Keep **All SKUs** to see all usage, or select a model or **Web search** to inspect it.
3. Read the daily rows below the **Total cost**, **Tokens**, and **Searches** totals. Totals cover all matching rows in the selected period, including rows on other pages. The table shows 50 rows per page, with **Previous** and **Next** controls when needed.

| Column | Meaning |
| - | - |
| **Day (UTC)** | The UTC calendar day when usage was recorded. |
| **SKU / model** | The public model ID or **Web search**. |
| **Period** | **Off-peak** for standard token prices, **Peak** for peak token prices, or **Unknown** when the recorded price version cannot be identified. Web-search rows show a dash. |
| **Pricing** | **Standard**, **Flex · 50% off**, or **No charge** for free-access usage. Different pricing treatments appear as separate rows, even for the same day and SKU. |
| **Requests** | Recorded model request count. Web-search rows show a dash; their quantity is in **Searches**. |
| **Cached input** / **Uncached input** | Input token counts split by cache usage. |
| **Output** | Output token count, including reasoning tokens. |
| **Searches** | Completed search count for **Web search**. Model rows show a dash. |
| **Cost (USD)** | The recorded charge for that row, including any applicable discount or free-access entitlement. |

For example, if you use the same model at Standard and Flex pricing and run a hosted web search on one day, that day has separate Standard model, Flex model, and Web search rows. The model rows show tokens and their charges; the Web search row shows searches and their fees. Use **All SKUs** to see their combined cost.

Costs reflect charges recorded at the time of usage; historical usage is not recalculated using today's prices. Peak and off-peak rows stay separate even when both use Flex. Pricing periods come from the recorded price version, including retired prices; legacy records without a version use the standard/off-peak period. **No charge** refers to free-access usage. Days without recorded usage have no rows.

> [!NOTE]
>
> **Charges for completed work**
>
> Requests rejected before any billable work produce no usage and no debit. A completed hosted web search is charged even if model admission or generation later fails, or the client disconnects. If a stream fails mid-generation, tokens generated so far are billed. Detailed usage shows the recorded token and search charges separately.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.