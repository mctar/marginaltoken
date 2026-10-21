import { quoteBill } from './planning.ts'
import { cacheWriteField } from './economics.ts'
import type { Quote } from './quotes.ts'
import type { PriceModel } from './types'
import { canonicalModelKey, modelRegister } from './register.ts'

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024
// RFC-style quoted fields, escaped quotes, CRLF and embedded newlines. No eval.
export function csvRows(text: string): Record<string, string>[] {
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES)
    throw new Error('CSV must be at most 2 MiB.')
  const rows: string[][] = [],
    row: string[] = []
  let field = '',
    quoted = false,
    closed = false
  const finishField = () => {
    row.push(field)
    field = ''
    closed = false
  }
  for (const char of text.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n') +
    '\n') {
    if (char === '"') {
      if (quoted) {
        quoted = false
        closed = true
      } else if (closed) {
        field += '"'
        quoted = true
        closed = false
      } else if (!field) quoted = true
      else throw new Error('Unexpected quote in CSV.')
    } else if (quoted) field += char
    else if (char === ',' || char === '\n') {
      finishField()
      if (char === '\n') {
        if (row.some((v) => v.trim())) rows.push([...row])
        row.length = 0
        if (rows.length > 10001)
          throw new Error('CSV may contain at most 10,000 data rows.')
      }
    } else if (closed) throw new Error('Unexpected text after a quoted field.')
    else field += char
  }
  if (quoted) throw new Error('Unclosed quoted field in CSV.')
  const headers = rows.shift()?.map((v) => v.trim()) ?? []
  if (
    !headers.length ||
    new Set(headers).size !== headers.length ||
    headers.some((v) => !v)
  )
    throw new Error('CSV needs unique, nonempty column names.')
  return rows.map((values, i) => {
    if (values.length !== headers.length)
      throw new Error(`Row ${i + 2} has the wrong number of fields.`)
    return Object.fromEntries(headers.map((h, j) => [h, values[j].trim()]))
  })
}
function count(
  row: Record<string, string>,
  key: string,
  optional = false,
): number {
  if (optional && !row[key]) return 0
  if (!row[key]?.trim() || !/^\d+(?:\.\d+)?$/.test(row[key]))
    throw new Error(`Invalid or missing ${key}.`)
  const n = Number(row[key])
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error(`${key} must be a nonnegative whole count.`)
  return n
}
function bounded(
  value: string | undefined,
  name: string,
  required = true,
): string {
  if ((required && !value) || (value?.length ?? 0) > 250)
    throw new Error(`Invalid or missing ${name}.`)
  return value ?? ''
}
export type UsageRow = {
  model: string
  period: string
  requests: number
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  minPrompt?: number
  maxPrompt?: number
  quote: string
  cacheDuration: '5m' | '30m' | '1h' | '12h'
}
export type UsageFormat = 'normalized' | 'openai' | 'anthropic'
export function importUsage(text: string, format: UsageFormat): UsageRow[] {
  const result = csvRows(text).map((r) => {
    if (
      [
        'input_audio_tokens',
        'output_audio_tokens',
        'input_image_tokens',
        'output_image_tokens',
      ].some((key) => r[key] && count(r, key) > 0)
    )
      throw new Error(
        'This importer supports text-token usage only. Separate audio and image charges.',
      )
    const requests = count(
      r,
      format === 'normalized' ? 'requests' : 'num_model_requests',
    )
    const read = count(
      r,
      format === 'anthropic'
        ? 'cache_read_input_tokens'
        : format === 'openai'
          ? 'input_cached_tokens'
          : 'cache_read_tokens',
      true,
    )
    const write = count(
      r,
      format === 'anthropic'
        ? 'cache_creation_input_tokens'
        : format === 'openai'
          ? 'input_cache_write_tokens'
          : 'cache_write_tokens',
      true,
    )
    let input = count(r, 'input_tokens'),
      output = count(r, 'output_tokens')
    const reasoning =
      format === 'anthropic' ? 0 : count(r, 'reasoning_tokens', true)
    if (format === 'anthropic') input += read + write
    if (format === 'openai') output -= reasoning
    if (
      ![input, output, read + write].every(Number.isSafeInteger) ||
      output < 0 ||
      read + write > input
    )
      throw new Error(
        'Cache/reasoning counts exceed their inclusive totals or safe count limits.',
      )
    if (requests === 0 && input + output + reasoning > 0)
      throw new Error('Nonzero tokens require a request count.')
    const minPrompt = r.min_prompt_tokens
      ? count(r, 'min_prompt_tokens')
      : undefined
    const maxPrompt = r.max_prompt_tokens
      ? count(r, 'max_prompt_tokens')
      : undefined
    if (
      (minPrompt === undefined) !== (maxPrompt === undefined) ||
      (minPrompt !== undefined &&
        (minPrompt > maxPrompt! ||
          (requests > 0 &&
            (input / requests < minPrompt || input / requests > maxPrompt!))))
    )
      throw new Error(
        'Prompt bounds must bracket the inclusive average and be supplied together.',
      )
    if (r.cache_duration && !['5m', '30m', '1h', '12h'].includes(r.cache_duration))
      throw new Error('cache_duration must be 5m, 30m, 1h or 12h.')
    return {
      model: canonicalModelKey(bounded(r.model, 'model')),
      period: bounded(r.period, 'period', false),
      requests,
      input,
      output,
      reasoning,
      cacheRead: read,
      cacheWrite: write,
      minPrompt,
      maxPrompt,
      quote: bounded(r.quote, 'quote', false),
      cacheDuration: (r.cache_duration || '5m') as '5m' | '30m' | '1h' | '12h',
    }
  })
  if (!result.length) throw new Error('CSV contains no usage rows.')
  return result
}
export function repriceUsage(row: UsageRow, model: PriceModel, quote: Quote) {
  const requests = row.requests || 1
  const result = quoteBill(
    model,
    row.cacheDuration !== '5m'
      ? {
          ...quote,
          plan: {
            ...quote.plan,
            cache_write_mtok: quote.plan[cacheWriteField(row.cacheDuration)],
          },
        }
      : quote,
    {
      calls: row.requests,
      inputTokens: row.input / requests,
      outputTokens: row.output / requests,
      reasoningTokens: row.reasoning / requests,
      cacheReadPct: row.input ? (row.cacheRead / row.input) * 100 : 0,
      cacheWritePct: row.input ? (row.cacheWrite / row.input) * 100 : 0,
      reviewHourly: 0,
    },
  )
  const problems = [...result.problems]
  if (
    (quote.plan.minimumPromptTokens !== undefined ||
      quote.plan.maximumPromptTokens !== undefined ||
      /up to [\d,]+ (?:input |prompt )?tokens/i.test(model.rateNote ?? '')) &&
    row.requests > 0
  ) {
    if (row.minPrompt === undefined || row.maxPrompt === undefined)
      problems.push(
        'Supply min_prompt_tokens and max_prompt_tokens for this bucket. Average usage cannot establish a price band.',
      )
    else {
      if (
        quote.plan.minimumPromptTokens !== undefined &&
        row.minPrompt < quote.plan.minimumPromptTokens
      )
        problems.push(
          'This bucket includes prompts below the selected price band.',
        )
      if (
        quote.plan.maximumPromptTokens !== undefined &&
        row.maxPrompt > quote.plan.maximumPromptTokens
      )
        problems.push(
          'Split this bucket: some prompts exceed the selected price band.',
        )
    }
  }
  if (row.maxPrompt !== undefined && row.maxPrompt > (quote.context ?? 0))
    problems.push('Some prompts exceed the quote’s context limit.')
  return { ...result, problems, complete: problems.length === 0 }
}
export type Evaluation = {
  model: string
  task: string
  suite: string
  version: string
  setting: string
  accepted: number
  total: number
  date: string
  source: string
  group: string
}
export function importEvaluations(text: string): Evaluation[] {
  const seen = new Set<string>()
  const rows = csvRows(text).map((r) => {
    const mapped = canonicalModelKey(r.model ?? '')
    if (
      modelRegister[mapped]?.apiIdFloating &&
      r.model === modelRegister[mapped]?.apiId
    )
      throw new Error(
        'Evaluation uses a moving provider alias. Enter the exact provider/model ledger key and measured snapshot in setting.',
      )

    const model = canonicalModelKey(bounded(r.model, 'exact model')),
      task = bounded(r.task, 'task'),
      suite = bounded(r.suite, 'suite'),
      version = bounded(r.version, 'version'),
      setting = bounded(r.setting, 'setting')
    const accepted = count(r, 'accepted'),
      total = count(r, 'total')
    if (!total || accepted > total)
      throw new Error('Evaluation requires 0 ≤ accepted ≤ total and total > 0.')
    const date = bounded(r.date, 'date'),
      source = bounded(r.source, 'source')
    if (
      !/^\d{4}-\d\d-\d\d$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date
    )
      throw new Error('Evaluation date must be YYYY-MM-DD.')
    const group = JSON.stringify([task, suite, version]),
      identity = JSON.stringify([model, group])
    if (seen.has(identity))
      throw new Error(
        'Duplicate model in one task/suite/version. Import a single measured configuration per model.',
      )
    seen.add(identity)
    return {
      model,
      task,
      suite,
      version,
      setting,
      accepted,
      total,
      date,
      source,
      group,
    }
  })
  if (!rows.length) throw new Error('CSV contains no evaluation rows.')
  return rows
}
export function csvText(rows: (string | number | undefined)[][]): string {
  return (
    rows
      .map((row) =>
        row
          .map((value) => {
            let s = String(value ?? '')
            if (/^(?:\s*[=+@\-]|[\t\r])/.test(s)) s = "'" + s
            return '"' + s.replaceAll('"', '""') + '"'
          })
          .join(','),
      )
      .join('\r\n') + '\r\n'
  )
}
export function downloadText(name: string, text: string, mime = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
