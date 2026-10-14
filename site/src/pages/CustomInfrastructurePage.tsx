import { useState, useEffect } from 'react'
import { matchesOpenness, decisionFor, weightsLabel } from '../lib/decisions'
import { quotesFor } from '../lib/quotes'
import {
  calculateInfrastructure,
  infrastructurePath,
  defaultInfrastructureAssumptions,
  type InfrastructureAssumptions,
} from '../lib/infrastructure'
import OperatingCosts, { parseOperating } from '../components/OperatingCosts'
import { NumberInput, money } from './PlanPage'
import type { PricesFeed, OffersFeed, DecisionsFeed } from '../lib/types'
import { modelPath } from '../lib/models'

const runtimes = [
  ['vllm', 'vLLM', 'https://docs.vllm.ai/en/latest/'],
  ['sglang', 'SGLang', 'https://docs.sglang.io/'],
  ['llamacpp', 'llama.cpp', 'https://github.com/ggml-org/llama.cpp'],
  ['custom', 'Other / custom', ''],
]
export default function CustomInfrastructurePage({
  prices,
  offers,
  decisions,
}: {
  prices: PricesFeed
  offers: OffersFeed | null
  decisions: DecisionsFeed | null
}) {
  const p = new URLSearchParams(window.location.search)
  const models = prices.models
    .filter(
      (m) =>
        matchesOpenness(m, 'weights', decisions) &&
        (m.releaseStage ?? 'stable') === 'stable',
    )
    .sort((a, b) => a.display.localeCompare(b.display))
  const [key, setKey] = useState(
    p.get('model') ??
      models.find((m) => /(?:^|-)8b(?:-|$)/i.test(m.key))?.key ??
      models[0]?.key ??
      '',
  )
  const [runtime, setRuntime] = useState(p.get('runtime') ?? 'vllm'),
    [quoteId, setQuote] = useState(p.get('quote') ?? 'tape'),
    [message, setMessage] = useState('')
  const num = (name: string, fallback: number) =>
    p.has(name) &&
    Number.isFinite(Number(p.get(name))) &&
    Number(p.get(name)) >= 0
      ? Math.min(1e12, Number(p.get(name)))
      : fallback
  const [a, setA] = useState<InfrastructureAssumptions>(() => ({
    ...defaultInfrastructureAssumptions,
    inputMillions: num('input', 100),
    outputMillions: num('output', 25),
    gpuHourly: num('gpu', 1),
    gpusPerReplica: num('count', 1),
    outputTokensPerSecond: num('throughput', 50),
    utilizationPct: num('utilization', 50),
    licensePerGpuYear: num('license', 0),
    ...parseOperating(p),
    gpuMemoryGB: num('gpuMemoryGB', 24),
    weightsGB: num('weightsGB', 0),
    kvGB: num('kvGB', 4),
  }))
  const model = models.find((m) => m.key === key) ?? models[0]
  const qs = model ? quotesFor(model, decisions, offers) : [],
    q = qs.find((q) => q.id === quoteId) ?? qs[0]
  const quoteModel =
    model && q
      ? {
          ...model,
          input_mtok: q.plan.input_mtok,
          output_mtok: q.plan.output_mtok,
        }
      : null
  const r = quoteModel
    ? calculateInfrastructure(quoteModel, null, 'tape', a)
    : null
  const update = (value: Partial<InfrastructureAssumptions>) =>
    setA((old) => ({ ...old, ...value }))
  const problems = [
    ...(r?.problems ?? []),
    ...(!r?.memoryRequiredGB || !r.memoryAvailableGB
      ? [
          'Enter model weight size and GPU memory to assess a custom deployment.',
        ]
      : []),
    ...(q && (q.plan.minimumPromptTokens || q.plan.maximumPromptTokens)
      ? [
          'This API quote has per-request context bands. Aggregate token volume cannot verify the tier; compare a bucketed workload in Plan.',
        ]
      : []),
  ]
  useEffect(() => {
    if (!model) return
    const path = infrastructurePath(model.key, 'tape', a)
    window.history.replaceState(
      null,
      '',
      path +
        '&mode=custom&runtime=' +
        encodeURIComponent(runtime) +
        '&quote=' +
        encodeURIComponent(q?.id ?? 'tape'),
    )
  }, [model?.key, a, runtime, q?.id])
  if (!model || !r || !q)
    return (
      <main
        id="main"
        className="plan-page mx-auto max-w-publication px-4 pt-10 sm:px-6"
      >
        <header className="page-heading">
          <h1>Rent vs Run</h1>
        </header>
        <p>
          No models have current, matching weight verification. Refresh the
          decision feed before sizing a custom deployment.
        </p>
        <a href="/infrastructure/">Verified NIM profiles →</a>
      </main>
    )
  const weights = decisionFor(model, decisions)?.weights
  return (
    <main
      id="main"
      className="plan-page mx-auto max-w-publication px-4 pt-10 sm:px-6 sm:pt-14"
    >
      <header className="page-heading">
        <p className="section-kicker">Inference economics · Custom serving</p>
        <h1>Size your own run.</h1>
        <p>
          Compare a hosted quote with entered hardware and operating assumptions
          for a model with verified weights.
        </p>
      </header>
      <nav className="plan-tabs">
        <a href="/infrastructure/">Verified NIM profiles</a>
        <a href="/infrastructure/?mode=custom" aria-current="page">
          Custom deployment
        </a>
      </nav>
      <section className="plan-panel">
        <div className="plan-columns">
          <label className="decision-select">
            <span>Model with verified weights</span>
            <select
              value={model.key}
              onChange={(e) => {
                setKey(e.target.value)
                setQuote('tape')
                update({ weightsGB: 0 })
              }}
            >
              {models.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.display} · {m.key}
                </option>
              ))}
            </select>
          </label>
          <label className="decision-select">
            <span>Serving runtime (declared assumption)</span>
            <select
              value={runtime}
              onChange={(e) => setRuntime(e.target.value)}
            >
              {runtimes.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="decision-note">
          {weightsLabel(weights)} ·{' '}
          <a href={weights?.licenseUrl}>Exact model license</a> ·{' '}
          <a href={modelPath(model.key)}>Model card</a> ·{' '}
          {runtimes.find(([id]) => id === runtime)?.[2] && (
            <a href={runtimes.find(([id]) => id === runtime)?.[2]}>
              Runtime documentation
            </a>
          )}
          . Runtime compatibility, quantization and throughput must be measured
          for this exact configuration.
        </p>
        <label className="decision-select">
          <span>Hosted API quote · {q.source}</span>
          <select value={q.id} onChange={(e) => setQuote(e.target.value)}>
            {qs.map((quote) => (
              <option key={quote.id} value={quote.id}>
                {quote.plan.label}
              </option>
            ))}
          </select>
        </label>
        <p className="decision-note">
          <a href={q.sourceUrl}>Quote source</a> ·{' '}
          {q.verifiedAt?.slice(0, 10) ?? prices.asOf}. The comparison uses
          uncached text-token rates; prompt bands, caching, tools and regional
          adjustments require a workload calculation.
        </p>
        <div className="plan-fields">
          {(
            [
              ['inputMillions', 'Input / month (million tokens)'],
              ['outputMillions', 'Output / month (million tokens)'],
              ['gpuHourly', 'Rented GPU ($ / hour)'],
              ['gpusPerReplica', 'GPUs / deployment'],
              ['outputTokensPerSecond', 'Aggregate output tokens / second'],
              ['utilizationPct', 'Usable utilization (%)'],
              ['licensePerGpuYear', 'Software / GPU / year ($)'],
            ] as [keyof InfrastructureAssumptions, string][]
          ).map(([field, label]) => (
            <NumberInput
              key={field}
              label={label}
              max={field === 'utilizationPct' ? 100 : undefined}
              value={a[field] as number}
              onChange={(n) =>
                update({
                  [field]:
                    field === 'gpusPerReplica' ? Math.max(1, Math.floor(n)) : n,
                })
              }
            />
          ))}
        </div>
        <label className="decision-select">
          <span>
            Memory example · entered capacity, no price or compatibility claim
          </span>
          <select
            defaultValue="custom"
            onChange={(e) =>
              update({ gpuMemoryGB: Number(e.target.value), gpusPerReplica: 1 })
            }
          >
            <option value="custom" disabled>
              Custom memory
            </option>
            <option value="16">Single GPU · 16 GB</option>
            <option value="24">Single GPU · 24 GB</option>
            <option value="48">Single GPU · 48 GB</option>
            <option value="80">Single GPU · 80 GB</option>
          </select>
        </label>
        <OperatingCosts value={a} onChange={update} />
      </section>
      <section className="plan-panel" aria-live="polite">
        <h2>
          {problems.length
            ? 'Plan incomplete'
            : r.saving >= 0
              ? 'Running is cheaper under these assumptions.'
              : 'Renting is cheaper under these assumptions.'}
        </h2>
        {problems.length > 0 && (
          <ul>
            {problems.map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
        )}
        <div className="plan-metrics">
          <div>
            <span>Hosted API / month</span>
            <strong>{money(r.apiMonthly)}</strong>
          </div>
          <div>
            <span>Run / month</span>
            <strong>{problems.length ? '—' : money(r.runMonthly)}</strong>
          </div>
          <div>
            <span>Active + standby</span>
            <strong>
              {r.replicas} + {r.standbyReplicas}
            </strong>
          </div>
          <div>
            <span>Memory required / available</span>
            <strong>
              {r.memoryRequiredGB?.toFixed(1) ?? '?'} /{' '}
              {r.memoryAvailableGB?.toFixed(1) ?? '?'} GB
            </strong>
          </div>
        </div>
        <p>
          Modeled run costs: compute {money(r.computeMonthly)}, power{' '}
          {money(r.powerMonthly)}, software {money(r.softwareMonthly)}, staffing
          and other costs {money(r.fixedMonthly)}. Standby replicas are excluded
          from serving capacity.
        </p>
        <h3>Capacity sensitivity</h3>
        <div className="plan-table-wrap">
          <table className="plan-table">
            <thead>
              <tr>
                <th>Entered throughput</th>
                <th>Usable utilization</th>
                <th>Active deployments</th>
                <th>Run / month</th>
              </tr>
            </thead>
            <tbody>
              {[0.5, 1, 1.5].flatMap((t) =>
                [0.5, 1].map((u) => {
                  const s = calculateInfrastructure(quoteModel!, null, 'tape', {
                    ...a,
                    outputTokensPerSecond: a.outputTokensPerSecond * t,
                    utilizationPct: a.utilizationPct * u,
                  })
                  return (
                    <tr key={`${t}-${u}`}>
                      <td>{(a.outputTokensPerSecond * t).toFixed(0)} tok/s</td>
                      <td>{(a.utilizationPct * u).toFixed(0)}%</td>
                      <td>{s.replicas}</td>
                      <td>
                        {problems.length || !s.complete
                          ? 'Incomplete'
                          : money(s.runMonthly)}
                      </td>
                    </tr>
                  )
                }),
              )}
            </tbody>
          </table>
        </div>
        <p className="decision-note">
          These are sensitivity scenarios, not benchmarks. Input prefill,
          concurrency, queueing, outages and performance degradation under load
          can change capacity. Matching weight availability does not prove this
          runtime supports this configuration.
        </p>
        <button
          className="plan-button"
          onClick={() =>
            navigator.clipboard
              ?.writeText(window.location.href)
              .then(() => setMessage('Scenario link copied.'))
              .catch(() =>
                setMessage('Copy the scenario from the address bar.'),
              )
          }
        >
          Copy scenario link
        </button>
        <p role="status">{message}</p>
      </section>
    </main>
  )
}
