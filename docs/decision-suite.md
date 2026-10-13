# Marginal Token decision tools

Requested by Thordur on 13 October 2026: implement all eight improvements from the ideas list. Publication follows review of the concrete changes.

The site helps people understand AI costs and decide what to run. Its current price tape, comparison calculator, open-weight shelf, and NIM planner are useful inputs, but visitors still have to reconcile identities, model a mixed fleet elsewhere, and translate their own usage into calculator assumptions. Manual selection lists also make routine successor updates dependent on editorial checking.

## Completion criteria

| Improvement | Reader outcome and required checks |
|---|---|
| Shared register | One reviewed source defines canonical keys, exact known aliases, API IDs, approved families, lifecycle, basket policy, and both shortlists. Verified same-family successors can be promoted without changing family policy. Unverified candidates stay pending. Aliases preserve history and quoted venue identity. |
| Mixed fleet | Price a first model plus an explicitly entered escalation fraction, charging the initial attempt on every request and the second attempt on escalated requests. Show accepted-task cost from conditional acceptance assumptions, review costs, and escalation sensitivity. Missing required rates and incompatible context prevent a complete estimate. |
| Usage import | Import bounded aggregate CSVs locally; support documented OpenAI and Anthropic token conventions plus a normalized template. Validate counts, separate cache usage, count reasoning once, and disclose where unknown prompt bands or billing terms prevent exact repricing. Reprice against selected current quotes. |
| Capability within budget | Import evaluation counts for exact models and compatible task/suite versions. Filter by monthly budget and entered acceptance threshold; disclose sample sizes and provenance. Price never supplies a quality score. |
| Hosting cards | Separate developer, serving host, and router. Display dated, sourced published retention/training/region terms for reviewed products alongside exact serving configurations. Unreported or product-dependent terms remain explicit. |
| Broader Rent vs Run | Retain verified NIM profiles and add declared custom serving plans. Include memory fit, owned versus rented hardware, electricity, staffing, redundancy, software and operating costs, plus throughput/utilization sensitivity. Capacity excludes standby replicas. |
| Workload watchlists | Save and remove bounded scenarios in browser storage. On return, compare saved quote baselines, lifecycle and requirements with current feeds. Provide import/export and public RSS for notes, price changes and retirements, including model-specific feeds. No account is required. |
| Model histories | Show dated input/output quote history and lifecycle/promotion events on model cards, with accessible tables and CSV download. Preserve unknown historical provenance and distinguish announced dates from inferred promotion-end expectations. |

## Implementation stages

1. Shared register, canonical identity and verified successor selection.
2. Plan tools: shared quote handling, fleet economics, usage import and evaluation/budget view.
3. Hosting facts, broader infrastructure costs, watchlists, RSS and model timelines.

Each stage has its own commit and reviewable PR. The complete branch must pass collector tests, arithmetic/import tests, frontend tests, production builds and browser checks before publication is requested.

## Product decisions

- Keep the existing editorial families, including OpenAI Sol and Anthropic Opus, as basket policy. Family changes need review.
- Use reader-supplied evaluation results first. Independent results can use the same versioned import format when exact variants and methods match.
- Published data-handling terms describe the named product and scope, not every service from that vendor.
- Custom deployment profiles and throughput are entered assumptions; verified NIM compatibility remains separately identified.
- Aggregate imports stay in the browser. Watchlists store only scenarios the visitor explicitly saves, with visible deletion/export controls.
- Public feeds supply RSS. Email/push delivery and API credential connections are later capabilities, consistent with the proposed browser/RSS starting point.

## Verification goals

All eight reader flows must be reachable and usable with current feeds. Regression checks cover alias deduplication, family/verification gates, escalation boundaries, zero acceptance, cache/reasoning normalization, incompatible evaluation suites, missing rates, memory/capacity limits, corrupted stored scenarios and stable RSS identifiers. Browser checks cover desktop and narrow layouts, keyboard labels, empty/error states and actual calculator results. Existing basket history must remain intact.
