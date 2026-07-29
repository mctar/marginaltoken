import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { contextSize, price, providerName } from '../lib/format'
import type { PriceModel, PricesFeed } from '../lib/types'

type SortKey = 'display' | 'provider' | 'input_mtok' | 'output_mtok' | 'context' | 'source'
type Direction = 'asc' | 'desc'
type SourceFilter = 'all' | 'firstparty' | 'openrouter'
type RowLimit = '50' | '100' | 'all'
type PriceBand = 'under-1' | '1-5' | '5-15' | '15-50' | '50-plus'
type ContextBand = 'under-128k' | '128k-256k' | '256k-1m' | '1m-plus'
type Capability = 'vision' | 'audio' | 'video' | 'reasoning' | 'tools' | 'structured'
type ReleaseStage = 'stable' | 'preview' | 'experimental'

const columns: Array<{ key: SortKey; label: string; align?: 'right' }> = [
  { key: 'display', label: 'Model' },
  { key: 'provider', label: 'Provider' },
  { key: 'input_mtok', label: 'Input / Mtok', align: 'right' },
  { key: 'output_mtok', label: 'Output / Mtok', align: 'right' },
  { key: 'context', label: 'Context', align: 'right' },
  { key: 'source', label: 'Source' },
]

const priceBands: Array<{ value: PriceBand; label: string }> = [
  { value: 'under-1', label: 'Under $1' },
  { value: '1-5', label: '$1 to $5' },
  { value: '5-15', label: '$5 to $15' },
  { value: '15-50', label: '$15 to $50' },
  { value: '50-plus', label: '$50 and above' },
]

const contextBands: Array<{ value: ContextBand; label: string }> = [
  { value: 'under-128k', label: 'Under 128k' },
  { value: '128k-256k', label: '128k to 255k' },
  { value: '256k-1m', label: '256k to 999k' },
  { value: '1m-plus', label: '1m and above' },
]

const capabilities: Array<{ value: Capability; label: string }> = [
  { value: 'vision', label: 'Vision input' },
  { value: 'audio', label: 'Audio input' },
  { value: 'video', label: 'Video input' },
  { value: 'reasoning', label: 'Reasoning' },
  { value: 'tools', label: 'Tool calling' },
  { value: 'structured', label: 'Structured output' },
]

const releaseStages: Array<{ value: ReleaseStage; label: string }> = [
  { value: 'stable', label: 'Stable' },
  { value: 'preview', label: 'Preview' },
  { value: 'experimental', label: 'Experimental' },
]

function compare(a: PriceModel, b: PriceModel, key: SortKey): number {
  const left = a[key]
  const right = b[key]
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right))
}

function searchParams(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams()
  return new URLSearchParams(window.location.search)
}

function initialValue(name: string): string {
  return searchParams().get(name) ?? ''
}

function initialEnum<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const value = initialValue(name)
  return allowed.includes(value as T) ? (value as T) : fallback
}

function initialList<T extends string>(name: string, allowed?: readonly T[]): T[] {
  const values = searchParams()
    .getAll(name)
    .flatMap((value) => value.split(','))
    .filter(Boolean) as T[]
  return [...new Set(allowed ? values.filter((value) => allowed.includes(value)) : values)]
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function toggleValue<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((candidate) => candidate !== value) : [...values, value]
}

function matchesPriceBand(value: number, band: PriceBand): boolean {
  if (band === 'under-1') return value < 1
  if (band === '1-5') return value >= 1 && value < 5
  if (band === '5-15') return value >= 5 && value < 15
  if (band === '15-50') return value >= 15 && value < 50
  return value >= 50
}

function matchesContextBand(value: number, band: ContextBand): boolean {
  if (band === 'under-128k') return value < 128000
  if (band === '128k-256k') return value >= 128000 && value < 256000
  if (band === '256k-1m') return value >= 256000 && value < 1000000
  return value >= 1000000
}

function supportsCapability(model: PriceModel, capability: Capability): boolean {
  if (capability === 'vision') return model.inputModalities?.includes('image') ?? false
  if (capability === 'audio') return model.inputModalities?.includes('audio') ?? false
  if (capability === 'video') return model.inputModalities?.includes('video') ?? false
  if (capability === 'reasoning') return model.supportsReasoning ?? false
  if (capability === 'tools') return model.supportsTools ?? false
  return model.supportsStructuredOutput ?? false
}

function capabilityTags(model: PriceModel): string[] {
  const tags: string[] = []
  if (model.inputModalities?.includes('image')) tags.push('Vision')
  if (model.inputModalities?.includes('audio')) tags.push('Audio')
  if (model.inputModalities?.includes('video')) tags.push('Video')
  if (model.supportsReasoning) tags.push('Reasoning')
  if (model.supportsTools) tags.push('Tools')
  if (model.supportsStructuredOutput) tags.push('Structured')
  if (model.releaseStage === 'preview') tags.push('Preview')
  if (model.releaseStage === 'experimental') tags.push('Experimental')
  return tags
}

function numericMaximum(value: string): number | null {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function FilterDisclosure({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  return (
    <details className="filter-disclosure" name="tape-filters">
      <summary>
        {label}
        {count > 0 && <span>{count}</span>}
      </summary>
      <div className="filter-popover">{children}</div>
    </details>
  )
}

function FilterOption({
  checked,
  count,
  label,
  onChange,
}: {
  checked: boolean
  count?: number
  label: string
  onChange: () => void
}) {
  return (
    <label className="filter-option">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{label}</span>
      {typeof count === 'number' && <small>{count}</small>}
    </label>
  )
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button type="button" className="filter-chip" onClick={onRemove} aria-label={`Remove ${label} filter`}>
      {label} <span aria-hidden="true">×</span>
    </button>
  )
}

export default function TapePage({ prices }: { prices: PricesFeed }) {
  const [query, setQuery] = useState(() => initialValue('q'))
  const [providerQuery, setProviderQuery] = useState('')
  const [selectedProviders, setSelectedProviders] = useState<string[]>(() => initialList('provider'))
  const [source, setSource] = useState<SourceFilter>(() =>
    initialEnum('source', ['all', 'firstparty', 'openrouter'] as const, 'all'),
  )
  const [selectedPriceBands, setSelectedPriceBands] = useState<PriceBand[]>(() =>
    initialList('price', priceBands.map((band) => band.value)),
  )
  const [maximumInput, setMaximumInput] = useState(() => initialValue('max_input'))
  const [maximumOutput, setMaximumOutput] = useState(() => initialValue('max_output'))
  const [selectedContextBands, setSelectedContextBands] = useState<ContextBand[]>(() =>
    initialList('context', contextBands.map((band) => band.value)),
  )
  const [selectedCapabilities, setSelectedCapabilities] = useState<Capability[]>(() =>
    initialList('capability', capabilities.map((capability) => capability.value)),
  )
  const [selectedReleaseStages, setSelectedReleaseStages] = useState<ReleaseStage[]>(() =>
    initialList('stage', releaseStages.map((stage) => stage.value)),
  )
  const [basketOnly, setBasketOnly] = useState(() => initialValue('basket') === '1')
  const [expiringOnly, setExpiringOnly] = useState(() => initialValue('expiring') === '1')
  const [huggingFaceOnly, setHuggingFaceOnly] = useState(() => initialValue('hugging_face') === '1')
  const [sortKey, setSortKey] = useState<SortKey>(() =>
    initialEnum('sort', columns.map((column) => column.key), 'output_mtok'),
  )
  const [direction, setDirection] = useState<Direction>(() => initialEnum('direction', ['asc', 'desc'] as const, 'asc'))
  const [rowLimit, setRowLimit] = useState<RowLimit>(() => initialEnum('limit', ['50', '100', 'all'] as const, '50'))

  const providerOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const model of prices.models) counts.set(model.provider, (counts.get(model.provider) ?? 0) + 1)
    return [...counts.entries()]
      .map(([value, count]) => ({ value, count, label: providerName(value) }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  }, [prices.models])

  const visibleProviderOptions = useMemo(() => {
    const normalized = normalizeSearch(providerQuery)
    if (!normalized) return providerOptions
    return providerOptions.filter((provider) => normalizeSearch(`${provider.label} ${provider.value}`).includes(normalized))
  }, [providerOptions, providerQuery])

  const priceBandCounts = useMemo(
    () => new Map(priceBands.map((band) => [band.value, prices.models.filter((model) => matchesPriceBand(model.output_mtok, band.value)).length])),
    [prices.models],
  )
  const contextBandCounts = useMemo(
    () => new Map(contextBands.map((band) => [band.value, prices.models.filter((model) => matchesContextBand(model.context, band.value)).length])),
    [prices.models],
  )
  const capabilityCounts = useMemo(
    () => new Map(capabilities.map((capability) => [capability.value, prices.models.filter((model) => supportsCapability(model, capability.value)).length])),
    [prices.models],
  )
  const releaseStageCounts = useMemo(
    () => new Map(releaseStages.map((stage) => [stage.value, prices.models.filter((model) => (model.releaseStage ?? 'stable') === stage.value).length])),
    [prices.models],
  )

  const rows = useMemo(() => {
    const terms = normalizeSearch(query).split(/\s+/).filter(Boolean)
    const inputLimit = numericMaximum(maximumInput)
    const outputLimit = numericMaximum(maximumOutput)
    const filtered = prices.models.filter((model) => {
      const haystack = normalizeSearch(`${model.display} ${model.key} ${model.provider} ${providerName(model.provider)}`)
      if (terms.some((term) => !haystack.includes(term))) return false
      if (selectedProviders.length > 0 && !selectedProviders.includes(model.provider)) return false
      if (source !== 'all' && model.source !== source) return false
      if (selectedPriceBands.length > 0 && !selectedPriceBands.some((band) => matchesPriceBand(model.output_mtok, band))) return false
      if (inputLimit !== null && model.input_mtok > inputLimit) return false
      if (outputLimit !== null && model.output_mtok > outputLimit) return false
      if (selectedContextBands.length > 0 && !selectedContextBands.some((band) => matchesContextBand(model.context, band))) return false
      if (selectedCapabilities.some((capability) => !supportsCapability(model, capability))) return false
      if (selectedReleaseStages.length > 0 && !selectedReleaseStages.includes(model.releaseStage ?? 'stable')) return false
      if (basketOnly && !model.indexEligible) return false
      if (expiringOnly && !model.expirationDate) return false
      if (huggingFaceOnly && !model.huggingFaceId) return false
      return true
    })
    return [...filtered].sort((a, b) => {
      const result = compare(a, b, sortKey) || a.key.localeCompare(b.key)
      return direction === 'asc' ? result : -result
    })
  }, [
    basketOnly,
    direction,
    expiringOnly,
    huggingFaceOnly,
    maximumInput,
    maximumOutput,
    prices.models,
    query,
    selectedCapabilities,
    selectedContextBands,
    selectedPriceBands,
    selectedProviders,
    selectedReleaseStages,
    sortKey,
    source,
  ])

  const visibleRows = rowLimit === 'all' ? rows : rows.slice(0, Number(rowLimit))
  const activeFilterCount =
    Number(Boolean(query.trim())) +
    selectedProviders.length +
    Number(source !== 'all') +
    selectedPriceBands.length +
    Number(Boolean(maximumInput)) +
    Number(Boolean(maximumOutput)) +
    selectedContextBands.length +
    selectedCapabilities.length +
    selectedReleaseStages.length +
    Number(basketOnly) +
    Number(expiringOnly) +
    Number(huggingFaceOnly)

  useEffect(() => {
    const params = new URLSearchParams()
    if (query.trim()) params.set('q', query.trim())
    for (const provider of [...selectedProviders].sort()) params.append('provider', provider)
    if (source !== 'all') params.set('source', source)
    for (const band of selectedPriceBands) params.append('price', band)
    if (maximumInput) params.set('max_input', maximumInput)
    if (maximumOutput) params.set('max_output', maximumOutput)
    for (const band of selectedContextBands) params.append('context', band)
    for (const capability of selectedCapabilities) params.append('capability', capability)
    for (const stage of selectedReleaseStages) params.append('stage', stage)
    if (basketOnly) params.set('basket', '1')
    if (expiringOnly) params.set('expiring', '1')
    if (huggingFaceOnly) params.set('hugging_face', '1')
    if (sortKey !== 'output_mtok') params.set('sort', sortKey)
    if (direction !== 'asc') params.set('direction', direction)
    if (rowLimit !== '50') params.set('limit', rowLimit)
    const nextSearch = params.toString()
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
    window.history.replaceState(null, '', nextUrl)
  }, [
    basketOnly,
    direction,
    expiringOnly,
    huggingFaceOnly,
    maximumInput,
    maximumOutput,
    query,
    rowLimit,
    selectedCapabilities,
    selectedContextBands,
    selectedPriceBands,
    selectedProviders,
    selectedReleaseStages,
    sortKey,
    source,
  ])

  const sort = (key: SortKey) => {
    if (key === sortKey) setDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setDirection('asc')
    }
  }

  const clearFilters = () => {
    setQuery('')
    setProviderQuery('')
    setSelectedProviders([])
    setSource('all')
    setSelectedPriceBands([])
    setMaximumInput('')
    setMaximumOutput('')
    setSelectedContextBands([])
    setSelectedCapabilities([])
    setSelectedReleaseStages([])
    setBasketOnly(false)
    setExpiringOnly(false)
    setHuggingFaceOnly(false)
  }

  return (
    <main id="main" className="mx-auto max-w-publication px-4 pt-10 sm:px-6 sm:pt-14">
      <header className="page-heading">
        <p className="section-kicker">Current prices</p>
        <h1>The Tape</h1>
        <p>
          Standard input and output prices in US dollars per million tokens. Search the full market or narrow it by provider, price, context, and objective API capabilities.
        </p>
      </header>

      <section className="tape-filter-panel" aria-label="Filter models">
        <div className="tape-search-row">
          <label className="tape-search">
            <span>Search the tape</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Model, family, provider, or ID"
              autoComplete="off"
            />
          </label>
          <p aria-live="polite">
            {rows.length.toLocaleString('en-US')} of {prices.models.length.toLocaleString('en-US')} models
          </p>
        </div>

        <div className="tape-filter-toolbar">
          <div className="filter-toggle" role="group" aria-label="Filter price source">
            {([
              ['all', 'All'],
              ['firstparty', 'First party'],
              ['openrouter', 'OpenRouter'],
            ] as Array<[SourceFilter, string]>).map(([value, label]) => (
              <button type="button" key={value} className={source === value ? 'active' : ''} onClick={() => setSource(value)}>
                {label}
              </button>
            ))}
          </div>

          <div className="filter-facets">
            <FilterDisclosure label="Provider" count={selectedProviders.length}>
              <label className="facet-search">
                <span>Find a provider</span>
                <input
                  type="search"
                  value={providerQuery}
                  onChange={(event) => setProviderQuery(event.target.value)}
                  placeholder={`Search ${providerOptions.length} providers`}
                />
              </label>
              <div className="facet-options provider-options">
                {visibleProviderOptions.map((provider) => (
                  <FilterOption
                    key={provider.value}
                    checked={selectedProviders.includes(provider.value)}
                    count={provider.count}
                    label={provider.label}
                    onChange={() => setSelectedProviders((current) => toggleValue(current, provider.value))}
                  />
                ))}
              </div>
            </FilterDisclosure>

            <FilterDisclosure
              label="Price"
              count={selectedPriceBands.length + Number(Boolean(maximumInput)) + Number(Boolean(maximumOutput))}
            >
              <fieldset className="facet-options">
                <legend>Output price per million tokens</legend>
                {priceBands.map((band) => (
                  <FilterOption
                    key={band.value}
                    checked={selectedPriceBands.includes(band.value)}
                    count={priceBandCounts.get(band.value)}
                    label={band.label}
                    onChange={() => setSelectedPriceBands((current) => toggleValue(current, band.value))}
                  />
                ))}
              </fieldset>
              <div className="price-inputs">
                <label>
                  <span>Maximum input</span>
                  <input type="number" min="0" step="0.01" inputMode="decimal" value={maximumInput} onChange={(event) => setMaximumInput(event.target.value)} placeholder="Any" />
                </label>
                <label>
                  <span>Maximum output</span>
                  <input type="number" min="0" step="0.01" inputMode="decimal" value={maximumOutput} onChange={(event) => setMaximumOutput(event.target.value)} placeholder="Any" />
                </label>
              </div>
            </FilterDisclosure>

            <FilterDisclosure label="Context" count={selectedContextBands.length}>
              <fieldset className="facet-options">
                <legend>Input context window</legend>
                {contextBands.map((band) => (
                  <FilterOption
                    key={band.value}
                    checked={selectedContextBands.includes(band.value)}
                    count={contextBandCounts.get(band.value)}
                    label={band.label}
                    onChange={() => setSelectedContextBands((current) => toggleValue(current, band.value))}
                  />
                ))}
              </fieldset>
            </FilterDisclosure>

            <FilterDisclosure label="Capabilities" count={selectedCapabilities.length}>
              <fieldset className="facet-options">
                <legend>Require every selected capability</legend>
                {capabilities.map((capability) => (
                  <FilterOption
                    key={capability.value}
                    checked={selectedCapabilities.includes(capability.value)}
                    count={capabilityCounts.get(capability.value)}
                    label={capability.label}
                    onChange={() => setSelectedCapabilities((current) => toggleValue(current, capability.value))}
                  />
                ))}
              </fieldset>
            </FilterDisclosure>

            <FilterDisclosure
              label="More"
              count={selectedReleaseStages.length + Number(basketOnly) + Number(expiringOnly) + Number(huggingFaceOnly)}
            >
              <fieldset className="facet-options">
                <legend>Release stage</legend>
                {releaseStages.map((stage) => (
                  <FilterOption
                    key={stage.value}
                    checked={selectedReleaseStages.includes(stage.value)}
                    count={releaseStageCounts.get(stage.value)}
                    label={stage.label}
                    onChange={() => setSelectedReleaseStages((current) => toggleValue(current, stage.value))}
                  />
                ))}
              </fieldset>
              <div className="facet-options facet-options-separated">
                <FilterOption checked={basketOnly} label="Deflator basket" onChange={() => setBasketOnly((current) => !current)} />
                <FilterOption checked={expiringOnly} label="Has expiration date" onChange={() => setExpiringOnly((current) => !current)} />
                <FilterOption checked={huggingFaceOnly} label="Hugging Face-linked" onChange={() => setHuggingFaceOnly((current) => !current)} />
              </div>
            </FilterDisclosure>
          </div>
        </div>

        {activeFilterCount > 0 && (
          <div className="active-filters" aria-label="Active filters">
            {query.trim() && <FilterChip label={`Search: ${query.trim()}`} onRemove={() => setQuery('')} />}
            {selectedProviders.map((provider) => (
              <FilterChip key={provider} label={providerName(provider)} onRemove={() => setSelectedProviders((current) => current.filter((value) => value !== provider))} />
            ))}
            {source !== 'all' && <FilterChip label={source === 'firstparty' ? 'First party' : 'OpenRouter'} onRemove={() => setSource('all')} />}
            {selectedPriceBands.map((value) => (
              <FilterChip key={value} label={priceBands.find((band) => band.value === value)?.label ?? value} onRemove={() => setSelectedPriceBands((current) => current.filter((band) => band !== value))} />
            ))}
            {maximumInput && <FilterChip label={`Input ≤ $${maximumInput}`} onRemove={() => setMaximumInput('')} />}
            {maximumOutput && <FilterChip label={`Output ≤ $${maximumOutput}`} onRemove={() => setMaximumOutput('')} />}
            {selectedContextBands.map((value) => (
              <FilterChip key={value} label={contextBands.find((band) => band.value === value)?.label ?? value} onRemove={() => setSelectedContextBands((current) => current.filter((band) => band !== value))} />
            ))}
            {selectedCapabilities.map((value) => (
              <FilterChip key={value} label={capabilities.find((capability) => capability.value === value)?.label ?? value} onRemove={() => setSelectedCapabilities((current) => current.filter((capability) => capability !== value))} />
            ))}
            {selectedReleaseStages.map((value) => (
              <FilterChip key={value} label={releaseStages.find((stage) => stage.value === value)?.label ?? value} onRemove={() => setSelectedReleaseStages((current) => current.filter((stage) => stage !== value))} />
            ))}
            {basketOnly && <FilterChip label="Deflator basket" onRemove={() => setBasketOnly(false)} />}
            {expiringOnly && <FilterChip label="Has expiration date" onRemove={() => setExpiringOnly(false)} />}
            {huggingFaceOnly && <FilterChip label="Hugging Face-linked" onRemove={() => setHuggingFaceOnly(false)} />}
            <button type="button" className="clear-filters" onClick={clearFilters}>Clear all</button>
          </div>
        )}
      </section>

      <div className="tape-results-bar">
        <p>
          Showing {visibleRows.length.toLocaleString('en-US')} of {rows.length.toLocaleString('en-US')} matching models
        </p>
        <label>
          Rows
          <select value={rowLimit} onChange={(event) => setRowLimit(event.target.value as RowLimit)}>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="all">All</option>
          </select>
        </label>
      </div>

      <div className="table-scroll">
        <table className="price-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={column.align === 'right' ? 'numeric' : ''}
                  aria-sort={sortKey === column.key ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <button type="button" onClick={() => sort(column.key)}>
                    {column.label}
                    {sortKey === column.key && <span aria-hidden="true">{direction === 'asc' ? ' ↑' : ' ↓'}</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((model) => {
              const tags = capabilityTags(model)
              return (
                <tr key={model.key}>
                  <th scope="row">
                    <span>{model.display}</span>
                    <small>{model.key}</small>
                    {tags.length > 0 && (
                      <span className="model-tags" aria-label={`Capabilities: ${tags.join(', ')}`}>
                        {tags.map((tag) => <span key={tag}>{tag}</span>)}
                      </span>
                    )}
                  </th>
                  <td className="provider-cell">{providerName(model.provider)}</td>
                  <td className="numeric">{price(model.input_mtok)}</td>
                  <td className="numeric output-price">{price(model.output_mtok)}</td>
                  <td className="numeric">{contextSize(model.context)}</td>
                  <td>
                    {model.source === 'firstparty' && model.sourceUrl ? (
                      <a className="source-link" href={model.sourceUrl} title={model.rateNote}>
                        First party
                      </a>
                    ) : (
                      <a className="source-link" href={`https://openrouter.ai/${model.key}`}>
                        OpenRouter
                      </a>
                    )}
                    {model.checked && <small className="source-date">Checked {model.checked}</small>}
                  </td>
                </tr>
              )
            })}
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="empty-tape">
                  <strong>No models match these filters.</strong>
                  <button type="button" onClick={clearFilters}>Clear all filters</button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  )
}
