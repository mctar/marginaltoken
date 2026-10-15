import register from '../../../collector/model-register.json' with { type: 'json' }
import { modelRegister } from './register.ts'
import type {
  DecisionModel,
  DecisionsFeed,
  PriceModel,
  WeightsRecord,
} from './types'

export function currentVerification(
  record: { status: string; verifiedAt: string },
  now = Date.now(),
): boolean {
  const checked = Date.parse(record.verifiedAt)
  return (
    record.status !== 'stale' &&
    Number.isFinite(checked) &&
    now - checked <= 7 * 86400000 &&
    checked <= now + 600000
  )
}

export type OpennessFilter =
  | 'all'
  | 'weights'
  | 'permissive'
  | 'custom'
  | 'unknown'
export function decisionFor(
  model: PriceModel,
  feed?: DecisionsFeed | null,
): DecisionModel | undefined {
  const record = feed?.models.find((row) => row.key === model.key)
  // A refreshed model register must not inherit another release's license.
  if (record?.weights && record.weights.repository !== model.huggingFaceId)
    return { key: record.key, billing: record.billing }
  return record
}
export function weightsLabel(weights?: WeightsRecord): string {
  if (!weights?.weightsAvailable) return 'Weights unverified'
  if (!currentVerification(weights)) return 'Weights · stale verification'
  return weights.licenseClass === 'permissive'
    ? 'Open weights · permissive'
    : weights.licenseClass === 'custom'
      ? 'Open weights · custom terms'
      : 'Open weights · license unverified'
}
export function matchesOpenness(
  model: PriceModel,
  filter: OpennessFilter,
  feed?: DecisionsFeed | null,
): boolean {
  if (filter === 'all') return true
  const weights = decisionFor(model, feed)?.weights
  const verified = Boolean(
    weights?.weightsAvailable && currentVerification(weights),
  )
  if (filter === 'weights') return verified
  if (filter === 'unknown')
    return !verified || weights?.licenseClass === 'unknown'
  return verified && weights?.licenseClass === filter
}

export function openModels(
  models: PriceModel[],
  feed?: DecisionsFeed | null,
  includePreviews = false,
): PriceModel[] {
  return models.filter((model) => {
    const stage = model.releaseStage ?? 'stable'
    return (stage === 'stable' || (includePreviews && stage === 'preview')) &&
      matchesOpenness(model, 'weights', feed)
  })
}
export function validDecisions(value: unknown): value is DecisionsFeed {
  const f = value as DecisionsFeed | null
  return Boolean(
    f &&
      f.version === 1 &&
      typeof f.asOf === 'string' &&
      Array.isArray(f.models) &&
      f.models.every(
        (m) =>
          m &&
          typeof m === 'object' &&
          typeof m.key === 'string' &&
          (!m.weights ||
            (typeof m.weights.repository === 'string' &&
              typeof m.weights.verifiedAt === 'string' &&
              typeof m.weights.license === 'string' &&
              typeof m.weights.licenseName === 'string' &&
              typeof m.weights.weightsAvailable === 'boolean' &&
              typeof m.weights.gated === 'boolean' &&
              ['permissive', 'custom', 'unknown'].includes(
                m.weights.licenseClass,
              ) &&
              ['fresh', 'last_good', 'stale'].includes(m.weights.status) &&
              /^https:\/\/huggingface\.co\//.test(m.weights.sourceUrl) &&
              /^https:\/\/huggingface\.co\//.test(m.weights.licenseUrl))) &&
          (!m.billing ||
            (typeof m.billing.verifiedAt === 'string' &&
              Array.isArray(m.billing.plans) &&
              /^https:\/\//.test(m.billing.sourceUrl) &&
              ['fresh', 'last_good', 'stale'].includes(m.billing.status) &&
              m.billing.plans.every(
                (p) =>
                  p &&
                  typeof p === 'object' &&
                  typeof p.id === 'string' &&
                  typeof p.label === 'string' &&
                  [p.input_mtok, p.output_mtok].every(
                    (n) => Number.isFinite(n) && n >= 0,
                  ) &&
                  [
                    p.reasoning_mtok,
                    p.cached_input_mtok,
                    p.cache_write_mtok,
                    p.cacheWriteHour_mtok,
                    p.cache_storage_mtok_hour,
                    p.minimumPromptTokens,
                    p.maximumPromptTokens,
                    p.minimumCachePromptTokens,
                    p.contextWindowTokens,
                    p.maximumOutputTokens,
                  ].every(
                    (n) => n === undefined || (Number.isFinite(n) && n >= 0),
                  ) &&
                  [p.validThrough, p.effectiveFrom].every(
                    (d) => d === undefined || validBillingDate(d),
                  ) &&
                  (p.notes === undefined || typeof p.notes === 'string') &&
                  (p.cacheMode === undefined || p.cacheMode === 'implicit') &&
                  (p.scheduledRates === undefined ||
                    (Array.isArray(p.scheduledRates) &&
                      p.scheduledRates.every(
                        (r) =>
                          r &&
                          validBillingDate(r.effectiveFrom) &&
                          [
                            r.input_mtok,
                            r.output_mtok,
                            r.cached_input_mtok,
                          ].every((n) => Number.isFinite(n) && n >= 0),
                      ) &&
                      new Set(p.scheduledRates.map((r) => r.effectiveFrom))
                        .size === p.scheduledRates.length)),
              ))),
      ),
  )
}

function validBillingDate(value: string): boolean {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  )
}

// Reviewed editorial slots. A successor must have verified weights to enter.
export const OPEN_SHORTLIST: readonly (readonly string[])[] =
  register.openShortlist

export function openShortlist(
  models: PriceModel[],
  feed?: DecisionsFeed | null,
): PriceModel[] {
  const byKey = new Map(
    models
      .filter(
        (m) =>
          (m.releaseStage ?? 'stable') === 'stable' &&
          matchesOpenness(m, 'weights', feed),
      )
      .map((m) => [m.key, m]),
  )
  return OPEN_SHORTLIST.map((slot) =>
    [
      ...models
        .filter(
          (m) =>
            m.provider === slot[0].split('/')[0] &&
            (m.identityReviewed ?? modelRegister[m.key]?.approved) &&
            (m.family ?? modelRegister[m.key]?.family) ===
              modelRegister[slot[0]]?.family &&
            byKey.has(m.key),
        )
        .sort(
          (a, b) =>
            (b.selectionOrder ?? modelRegister[b.key]?.order ?? 0) -
            (a.selectionOrder ?? modelRegister[a.key]?.order ?? 0),
        ),
      ...slot.map((key) => byKey.get(key)),
    ].find(Boolean),
  ).filter((m): m is PriceModel => Boolean(m))
}
