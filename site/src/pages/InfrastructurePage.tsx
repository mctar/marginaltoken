import { useEffect, useMemo, useState } from 'react'
import ShareImageButton from '../components/ShareImageButton'
import {
  apiQuotes,
  calculateInfrastructure,
  defaultInfrastructureAssumptions,
  infrastructurePath,
  nonNegative,
  type ApiBasis,
  type InfrastructureAssumptions,
  type InfrastructureResult,
} from '../lib/infrastructure'
import { createInfrastructureShareImage } from '../lib/share-image'
import { shareImageFilename } from '../lib/share'
import type { DeploymentFeed, DeploymentModel, MetaFeed, OffersFeed, PriceModel, PricesFeed } from '../lib/types'

function parameter(params: URLSearchParams, name: string, fallback: number): string {
  const raw = params.get(name)
  return raw !== null && Number.isFinite(Number(raw)) && Number(raw) >= 0 ? raw : String(fallback)
}

function money(value: number): string {
  const digits = value < 100 ? 2 : 0
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}

function tokenVolume(millions: number): string {
  if (!Number.isFinite(millions)) return 'Unbounded'
  if (millions >= 1_000_000) return `${(millions / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 2 })}T`
  if (millions >= 1_000) return `${(millions / 1_000).toLocaleString('en-US', { maximumFractionDigits: 2 })}B`
  return `${millions.toLocaleString('en-US', { maximumFractionDigits: 1 })}M`
}

function lifecycleLabel(model: DeploymentModel): string {
  if (model.lifecycle === 'certified-production') return 'NIM Certified · Production'
  if (model.lifecycle === 'certified-feature') return 'NIM Certified · Feature'
  return 'NIM available'
}

function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value)
  return Promise.reject(new Error('Clipboard unavailable'))
}

function CostCurve({ result, assumptions }: { result: InfrastructureResult; assumptions: InfrastructureAssumptions }) {
  const total = assumptions.inputMillions + assumptions.outputMillions
  const outputShare = assumptions.outputMillions / Math.max(1, total)
  const candidateBreakEven = result.breakEvenWithinCapacity ? result.breakEvenMillions ?? 0 : 0
  const maximumX = Math.max(total * 1.35, result.totalCapacityMillions * 1.5, candidateBreakEven * 1.4, 1)
  const points = Array.from({ length: 81 }, (_, index) => {
    const tokens = maximumX * index / 80
    const api = tokens * (
      result.selectedQuote.input_mtok * (1 - outputShare)
      + result.selectedQuote.output_mtok * outputShare
    )
    const output = tokens * outputShare
    const replicas = output > 0 && result.outputCapacityPerReplica > 0
      ? Math.max(1, Math.ceil(output / result.outputCapacityPerReplica))
      : 1
    return { tokens, api, run: result.costPerReplica * replicas }
  })
  const maximumY = Math.max(...points.flatMap((point) => [point.api, point.run]), 1) * 1.08
  const width = 900
  const height = 330
  const left = 72
  const top = 25
  const plotWidth = width - left - 20
  const plotHeight = height - top - 48
  const x = (value: number) => left + value / maximumX * plotWidth
  const y = (value: number) => top + (1 - value / maximumY) * plotHeight
  const apiPath = points.map((point, index) => `${index ? 'L' : 'M'}${x(point.tokens).toFixed(1)},${y(point.api).toFixed(1)}`).join(' ')
  const runPath = points.map((point, index) => `${index ? 'L' : 'M'}${x(point.tokens).toFixed(1)},${y(point.run).toFixed(1)}`).join(' ')

  return (
    <div className="infrastructure-chart-wrap">
      <svg className="infrastructure-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="run-chart-title run-chart-description">
        <title id="run-chart-title">Modeled monthly API and self-hosted NIM cost</title>
        <desc id="run-chart-description">A linear API cost line and stepwise self-hosted cost line based on the visible assumptions.</desc>
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
          <g key={fraction}>
            <line x1={left} x2={left + plotWidth} y1={y(maximumY * fraction)} y2={y(maximumY * fraction)} />
            <text x={left - 12} y={y(maximumY * fraction) + 4} textAnchor="end">{money(maximumY * fraction)}</text>
          </g>
        ))}
        <path className="api-line" d={apiPath} />
        <path className="run-line" d={runPath} />
        <line className="workload-mark" x1={x(Math.min(total, maximumX))} x2={x(Math.min(total, maximumX))} y1={top} y2={top + plotHeight} />
        <text className="workload-label" x={x(Math.min(total, maximumX)) - 6} y={top + 12} textAnchor="end">YOUR LOAD</text>
        <text x={left} y={height - 8}>{tokenVolume(0)}</text>
        <text x={left + plotWidth} y={height - 8} textAnchor="end">{tokenVolume(maximumX)} TOKENS / MONTH</text>
      </svg>
      <div className="infrastructure-legend" aria-hidden="true">
        <span><i className="api" />API quote</span>
        <span><i className="run" />Modeled NIM capacity</span>
      </div>
    </div>
  )
}

export default function InfrastructurePage({
  prices,
  offers,
  deployment,
  meta,
}: {
  prices: PricesFeed
  offers: OffersFeed | null
  deployment: DeploymentFeed | null
  meta: MetaFeed
}) {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const available = useMemo(() => {
    if (!deployment) return []
    const byKey = new Map(prices.models.map((model) => [model.key, model]))
    return deployment.models
      .map((record) => ({ record, model: byKey.get(record.key) }))
      .filter((entry): entry is { record: DeploymentModel; model: PriceModel } => Boolean(entry.model))
  }, [deployment, prices.models])
  const requestedKey = params.get('model')
  const defaultKey = available.find((entry) => entry.model.key === 'nvidia/nemotron-3-super-120b-a12b')?.model.key
    ?? available[0]?.model.key
    ?? ''
  const [modelKey, setModelKey] = useState(() => available.some((entry) => entry.model.key === requestedKey) ? requestedKey! : defaultKey)
  const basisParam = params.get('basis')
  const [basis, setBasis] = useState<ApiBasis>(() => basisParam === 'cheapest' || basisParam === 'tape' ? basisParam : 'median')
  const [inputMillions, setInputMillions] = useState(() => parameter(params, 'input', defaultInfrastructureAssumptions.inputMillions))
  const [outputMillions, setOutputMillions] = useState(() => parameter(params, 'output', defaultInfrastructureAssumptions.outputMillions))
  const [gpuHourly, setGpuHourly] = useState(() => parameter(params, 'gpu', defaultInfrastructureAssumptions.gpuHourly))
  const [gpusPerReplica, setGpusPerReplica] = useState(() => parameter(params, 'count', defaultInfrastructureAssumptions.gpusPerReplica))
  const [throughput, setThroughput] = useState(() => parameter(params, 'throughput', defaultInfrastructureAssumptions.outputTokensPerSecond))
  const [utilization, setUtilization] = useState(() => parameter(params, 'utilization', defaultInfrastructureAssumptions.utilizationPct))
  const [license, setLicense] = useState(() => parameter(params, 'license', defaultInfrastructureAssumptions.licensePerGpuYear))
  const [shareStatus, setShareStatus] = useState('')

  const assumptions: InfrastructureAssumptions = {
    inputMillions: nonNegative(inputMillions),
    outputMillions: nonNegative(outputMillions),
    gpuHourly: nonNegative(gpuHourly),
    gpusPerReplica: Math.max(1, nonNegative(gpusPerReplica, 1)),
    outputTokensPerSecond: nonNegative(throughput),
    utilizationPct: Math.min(100, nonNegative(utilization)),
    licensePerGpuYear: nonNegative(license),
  }
  const selected = available.find((entry) => entry.model.key === modelKey) ?? available[0]
  const offerModel = offers?.models.find((candidate) => candidate.key === selected?.model.key || candidate.canonicalKey === selected?.model.key) ?? null
  const quotes = selected ? apiQuotes(selected.model, offerModel, assumptions) : []
  const result = selected ? calculateInfrastructure(selected.model, offerModel, basis, assumptions) : null

  useEffect(() => {
    if (!modelKey) return
    window.history.replaceState(null, '', infrastructurePath(modelKey, basis, assumptions))
    setShareStatus('')
  }, [modelKey, basis, inputMillions, outputMillions, gpuHourly, gpusPerReplica, throughput, utilization, license])

  if (!deployment || !selected || !result) {
    return (
      <main id="main" className="infrastructure-page mx-auto max-w-publication px-4 pt-10 sm:px-6 sm:pt-14">
        <header className="page-heading"><p className="section-kicker">Inference economics</p><h1>Rent vs Run</h1></header>
        <div className="compare-empty"><strong>The NVIDIA deployment file is unavailable.</strong><p>The price tape remains unaffected.</p></div>
      </main>
    )
  }

  const totalMillions = assumptions.inputMillions + assumptions.outputMillions
  const apiWins = result.saving < 0
  const delta = Math.abs(result.saving)
  const sourceText = `NVIDIA NIM support matrix + ${quotes.length} posted API ${quotes.length === 1 ? 'quote' : 'quotes'} · user-supplied operating assumptions`

  const shareLink = async () => {
    try {
      await copyText(window.location.href)
      setShareStatus('Scenario link copied')
    } catch {
      setShareStatus('Copy unavailable — use the address bar')
    }
  }

  return (
    <main id="main" className="infrastructure-page mx-auto max-w-publication px-4 pt-10 sm:px-6 sm:pt-14">
      <header className="page-heading infrastructure-heading">
        <p className="section-kicker">Inference economics · NVIDIA NIM first</p>
        <h1>Rent tokens, or run the model?</h1>
        <p>Put a posted API quote against a transparent capacity plan. This is an assumption-driven planning model—not an NVIDIA benchmark, hardware recommendation, or total-cost guarantee.</p>
      </header>

      {deployment.status !== 'fresh' && (
        <div className={`infrastructure-source-alert ${deployment.status}`} role="status">
          <strong>NVIDIA deployment verification is using {deployment.status === 'stale' ? 'stale' : 'last-good'} records.</strong>
          <span>The calculator remains available, but the dated NIM support links should be checked before a deployment decision.</span>
        </div>
      )}

      <section className="infrastructure-workbench" aria-label="Rent versus run assumptions">
        <div className="infrastructure-model-panel">
          <div className="compare-panel-heading"><span>01</span><div><p className="section-kicker">Deployment candidate</p><h2>Choose a NIM</h2></div></div>
          <label className="infrastructure-select">
            <span>Model</span>
            <select value={selected.model.key} onChange={(event) => setModelKey(event.target.value)}>
              {available.map((entry) => <option value={entry.model.key} key={entry.model.key}>{entry.model.display} · {lifecycleLabel(entry.record)}</option>)}
            </select>
          </label>
          <div className="nim-record">
            <span className={`nim-status ${selected.record.lifecycle}`}>{lifecycleLabel(selected.record)}</span>
            <strong>{selected.record.nvidiaModelId}</strong>
            <small>{selected.record.status === 'fresh' ? 'Verified' : selected.record.status.replace('_', ' ')} {selected.record.verifiedAt} · <a href={selected.record.sourceUrl}>official source</a> · <a href={selected.record.catalogUrl}>NVIDIA catalog</a></small>
          </div>
          <label className="infrastructure-select">
            <span>API comparison basis</span>
            <select value={basis} onChange={(event) => setBasis(event.target.value as ApiBasis)}>
              <option value="median">Median posted route ({quotes.length})</option>
              <option value="cheapest">Cheapest posted route</option>
              <option value="tape">The Tape rate</option>
            </select>
          </label>
          <p className="input-note">The median is the middle complete route quote for this exact model and workload—not a negotiated enterprise rate.</p>
        </div>

        <div className="infrastructure-assumptions-panel">
          <div className="compare-panel-heading"><span>02</span><div><p className="section-kicker">Your assumptions</p><h2>Size the run</h2></div></div>
          <div className="infrastructure-fields">
            <label><span>Input tokens / month (millions)</span><input type="number" min="0" step="100" value={inputMillions} onChange={(event) => setInputMillions(event.target.value)} /></label>
            <label><span>Output tokens / month (millions)</span><input type="number" min="0" step="100" value={outputMillions} onChange={(event) => setOutputMillions(event.target.value)} /></label>
            <label><span>GPU cost / hour</span><input type="number" min="0" step="0.1" value={gpuHourly} onChange={(event) => setGpuHourly(event.target.value)} /></label>
            <label><span>GPUs / deployment</span><input type="number" min="1" step="1" value={gpusPerReplica} onChange={(event) => setGpusPerReplica(event.target.value)} /></label>
            <label><span>Aggregate output tok/s</span><input type="number" min="0" step="50" value={throughput} onChange={(event) => setThroughput(event.target.value)} /></label>
            <label><span>Usable utilization</span><span className="input-suffix"><input type="number" min="0" max="100" step="5" value={utilization} onChange={(event) => setUtilization(event.target.value)} /><i>%</i></span></label>
            <label><span>Software / GPU / year</span><span className="input-suffix"><i>$</i><input type="number" min="0" step="500" value={license} onChange={(event) => setLicense(event.target.value)} /></span></label>
          </div>
          <p className="input-note">Throughput is aggregate generated-token throughput for one deployment. The default $4,500 software assumption reflects NVIDIA AI Enterprise’s published starting point; hardware, power, staffing, storage, networking and support terms may differ.</p>
        </div>
      </section>

      <section className="infrastructure-results" aria-labelledby="rent-run-result">
        <div className="infrastructure-results-heading">
          <div><p className="section-kicker">The modeled mark</p><h2 id="rent-run-result">{apiWins ? 'Rent is cheaper here.' : 'Run is cheaper here.'}</h2><p>{tokenVolume(totalMillions)} tokens per month · {result.replicas} modeled {result.replicas === 1 ? 'deployment' : 'deployments'} · {tokenVolume(result.outputCapacityPerReplica)} output-token capacity each.</p></div>
          <div className="compare-share">
            <div className="compare-share-actions">
              <ShareImageButton
                createImage={() => createInfrastructureShareImage({ model: selected.model, deployment: selected.record, result, assumptions, asOf: meta.asOf })}
                filename={shareImageFilename(`rent-vs-run-${selected.model.display}`)}
                shareTitle={`${selected.model.display}: rent vs run — The Marginal Token`}
                shareText="A sourced API-versus-NIM planning scenario with visible assumptions."
              />
              <button className="share-link-button" type="button" onClick={shareLink}>Share link</button>
            </div>
            <span className="share-link-status" aria-live="polite">{shareStatus}</span>
          </div>
        </div>

        <div className="rent-run-totals">
          <article><span>Rent · {result.selectedQuote.label}</span><strong>{money(result.apiMonthly)}</strong><small>estimated monthly API spend</small></article>
          <article className={!apiWins ? 'winner' : ''}><span>Run · modeled NIM capacity</span><strong>{money(result.runMonthly)}</strong><small>{result.replicas} × {money(result.costPerReplica)} deployments</small></article>
          <article className="delta"><span>Difference</span><strong>{money(delta)}</strong><small>{apiWins ? 'API advantage / month' : 'modeled run advantage / month'}</small></article>
        </div>

        <CostCurve result={result} assumptions={assumptions} />

        <div className={`break-even-note ${result.breakEvenWithinCapacity ? 'viable' : 'not-viable'}`}>
          <span>First-deployment break-even</span>
          {result.breakEvenWithinCapacity && result.breakEvenMillions !== null ? (
            <><strong>{tokenVolume(result.breakEvenMillions)} total tokens / month</strong><p>At the current input/output mix, the API line reaches one modeled deployment’s fixed monthly cost before that deployment exhausts its output capacity.</p></>
          ) : (
            <><strong>No crossover before modeled capacity is exhausted.</strong><p>Under these price and throughput assumptions, another deployment is required before API spend reaches one deployment’s cost. Running does not establish a durable cost advantage.</p></>
          )}
        </div>

        <p className="infrastructure-source">Source: {sourceText}. Price file {meta.asOf}; NIM record {deployment.asOf}. API rates exclude caching, batch, priority, regional and negotiated adjustments. Throughput is not independently benchmarked and input-prefill pressure is not modeled.</p>
      </section>
    </main>
  )
}
