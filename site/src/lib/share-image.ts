import { contextSize, longDate, price, providerName, shortDate } from './format'
import { capabilityTags } from './models'
import { comparableOfferGroups, widestOutputSpread, type SpreadConfidence, type SpreadRow } from './offers'
import { shareSourceLabel } from './share'
import { logPricePosition, selectShortlist, shortlistProviderColor } from './shortlist'
import type { InfrastructureAssumptions, InfrastructureResult } from './infrastructure'
import type { DeploymentModel, DeploymentProfile, IndexPoint, OfferModel, PriceModel } from './types'

export const SHARE_IMAGE_WIDTH = 1200
export const SHARE_IMAGE_HEIGHT = 630

const PAPER = '#fff1e5'
const PAPER_DEEP = '#fcede0'
const INK = '#2b2a28'
const MUTED = '#6b645e'
const FAINT = '#a39a91'
const RULE = 'rgba(43, 42, 40, 0.22)'
const TEAL = '#0d7680'
const CLARET = '#990f3d'
const BLUE = '#0f5499'
const SERIF = '"Source Serif 4", Georgia, serif'
const SANS = '"Libre Franklin", Arial, sans-serif'

type CanvasPair = {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
}

type FooterOptions = {
  source: string
  asOf: string
  path?: string
}

export type ComparisonShareResult = {
  model: PriceModel
  monthlyTotal: number
}

export type ComparisonShareWorkload = {
  calls: number
  inputTokens: number
  outputTokens: number
}

function createCanvas(): CanvasPair {
  const canvas = document.createElement('canvas')
  canvas.width = SHARE_IMAGE_WIDTH
  canvas.height = SHARE_IMAGE_HEIGHT
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Image export is not supported by this browser')
  context.textBaseline = 'alphabetic'
  return { canvas, context }
}

async function prepareCanvas(): Promise<CanvasPair> {
  await document.fonts?.ready
  const pair = createCanvas()
  const { context } = pair
  context.fillStyle = PAPER
  context.fillRect(0, 0, SHARE_IMAGE_WIDTH, SHARE_IMAGE_HEIGHT)
  context.fillStyle = INK
  context.fillRect(60, 28, 1080, 4)
  context.fillRect(60, 38, 1080, 1)
  context.font = `700 18px ${SANS}`
  context.letterSpacing = '1.5px'
  context.fillText('THE MARGINAL TOKEN', 60, 70)
  context.textAlign = 'right'
  context.fillStyle = MUTED
  context.font = `700 11px ${SANS}`
  context.letterSpacing = '1.8px'
  context.fillText('INDEPENDENT AI PRICE TAPE', 1140, 68)
  context.textAlign = 'left'
  context.letterSpacing = '0px'
  return pair
}

function drawTitle(context: CanvasRenderingContext2D, kicker: string, title: string, subtitle: string): void {
  context.fillStyle = MUTED
  context.font = `700 12px ${SANS}`
  context.letterSpacing = '1.8px'
  context.fillText(kicker.toUpperCase(), 60, 110)
  context.letterSpacing = '0px'
  context.fillStyle = INK
  context.font = `600 48px ${SERIF}`
  context.fillText(title, 60, 158)
  context.fillStyle = MUTED
  context.font = `400 19px ${SERIF}`
  fitAndFillText(context, subtitle, 60, 190, 850)
}

function drawFooter(context: CanvasRenderingContext2D, options: FooterOptions): void {
  context.strokeStyle = INK
  context.lineWidth = 1
  context.beginPath()
  context.moveTo(60, 566)
  context.lineTo(1140, 566)
  context.stroke()

  context.fillStyle = MUTED
  context.font = `700 10px ${SANS}`
  context.letterSpacing = '1px'
  fitAndFillText(context, `SOURCE · ${options.source}`.toUpperCase(), 60, 596, 700)
  context.textAlign = 'right'
  const path = options.path && options.path !== '/' ? ` · ${options.path}` : ''
  fitAndFillText(
    context,
    `MARGINALTOKEN.COM${path} · AS OF ${longDate(options.asOf).toUpperCase()}`,
    1140,
    596,
    400,
  )
  context.textAlign = 'left'
  context.letterSpacing = '0px'
}

function fitAndFillText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
): void {
  if (context.measureText(text).width <= maxWidth) {
    context.fillText(text, x, y)
    return
  }
  let shortened = text
  while (shortened.length > 1 && context.measureText(`${shortened}…`).width > maxWidth) {
    shortened = shortened.slice(0, -1)
  }
  context.fillText(`${shortened.trimEnd()}…`, x, y)
}

function drawWrappedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
): void {
  const words = text.split(/\s+/)
  let line = ''
  let lineIndex = 0
  for (let wordIndex = 0; wordIndex < words.length; wordIndex += 1) {
    const word = words[wordIndex]
    const candidate = line ? `${line} ${word}` : word
    if (context.measureText(candidate).width <= maxWidth || !line) {
      line = candidate
      continue
    }
    context.fillText(line, x, y + lineIndex * lineHeight)
    lineIndex += 1
    if (lineIndex >= maxLines - 1) {
      const rest = [word, ...words.slice(wordIndex + 1)].join(' ')
      fitAndFillText(context, rest, x, y + lineIndex * lineHeight, maxWidth)
      return
    }
    line = word
  }
  if (line && lineIndex < maxLines) context.fillText(line, x, y + lineIndex * lineHeight)
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Image export failed')), 'image/png')
  })
}

function shareMoney(value: number): string {
  const maximumFractionDigits = value < 0.01 ? 4 : value < 100 ? 2 : 0
  const minimumFractionDigits = value < 100 ? 2 : 0
  return `$${value.toLocaleString('en-US', { minimumFractionDigits, maximumFractionDigits })}`
}

export async function createDeflatorShareImage(options: {
  points: IndexPoint[]
  asOf: string
  basketCount: number
}): Promise<Blob> {
  const { canvas, context } = await prepareCanvas()
  const points = options.points.length > 0 ? options.points : [{ date: options.asOf, value: 100 }]
  const current = points.at(-1)!.value
  drawTitle(
    context,
    'Output price index',
    'The Deflator',
    `${options.basketCount} providers · equal weight · standard output API rates`,
  )

  context.textAlign = 'right'
  context.fillStyle = current < 100 ? TEAL : current > 100 ? CLARET : INK
  context.font = `600 54px ${SERIF}`
  context.fillText(current.toFixed(2), 1140, 158)
  context.fillStyle = MUTED
  context.font = `700 10px ${SANS}`
  context.letterSpacing = '1.3px'
  context.fillText('CURRENT READING', 1140, 181)
  context.textAlign = 'left'
  context.letterSpacing = '0px'

  const x = 95
  const y = 224
  const width = 1010
  const height = 275
  const values = points.map((point) => point.value)
  const rawMin = Math.min(...values, 100)
  const rawMax = Math.max(...values, 100)
  const spread = Math.max(rawMax - rawMin, 4)
  const minimum = Math.floor((rawMin - spread * 0.25) / 2) * 2
  const maximum = Math.ceil((rawMax + spread * 0.25) / 2) * 2
  const xFor = (index: number) => x + (points.length === 1 ? width / 2 : (index / (points.length - 1)) * width)
  const yFor = (value: number) => y + ((maximum - value) / (maximum - minimum)) * height
  const ticks = Array.from({ length: 5 }, (_, index) => maximum - ((maximum - minimum) * index) / 4)

  context.font = `600 11px ${SANS}`
  context.fillStyle = MUTED
  context.lineWidth = 1
  for (const tick of ticks) {
    const tickY = yFor(tick)
    context.strokeStyle = RULE
    context.beginPath()
    context.moveTo(x, tickY)
    context.lineTo(x + width, tickY)
    context.stroke()
    context.textAlign = 'right'
    context.fillText(tick.toFixed(0), x - 14, tickY + 4)
  }

  context.strokeStyle = MUTED
  context.setLineDash([6, 6])
  context.beginPath()
  context.moveTo(x, yFor(100))
  context.lineTo(x + width, yFor(100))
  context.stroke()
  context.setLineDash([])
  context.textAlign = 'right'
  context.fillText('INCEPTION 100', x + width, yFor(100) - 9)

  if (points.length === 1) {
    context.strokeStyle = MUTED
    context.lineWidth = 5
    context.beginPath()
    context.moveTo(x, yFor(points[0].value))
    context.lineTo(x + width, yFor(points[0].value))
    context.stroke()
  } else {
    context.lineWidth = 5
    context.lineCap = 'round'
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1]
      const point = points[index]
      context.strokeStyle = point.value <= previous.value ? TEAL : CLARET
      context.beginPath()
      context.moveTo(xFor(index - 1), yFor(previous.value))
      context.lineTo(xFor(index), yFor(point.value))
      context.stroke()
    }
  }

  for (let index = 0; index < points.length; index += 1) {
    context.beginPath()
    context.arc(xFor(index), yFor(points[index].value), 5, 0, Math.PI * 2)
    context.fillStyle = PAPER
    context.fill()
    context.strokeStyle = INK
    context.lineWidth = 3
    context.stroke()
  }

  context.fillStyle = MUTED
  context.font = `600 11px ${SANS}`
  if (points.length === 1) {
    context.textAlign = 'center'
    context.fillText(shortDate(points[0].date), x + width / 2, 528)
  } else {
    context.textAlign = 'left'
    context.fillText(shortDate(points[0].date), x, 528)
    context.textAlign = 'right'
    context.fillText(shortDate(points.at(-1)!.date), x + width, 528)
  }
  context.textAlign = 'left'
  drawFooter(context, {
    source: 'Official provider price pages · one current frontier model per provider',
    asOf: options.asOf,
  })
  return canvasToBlob(canvas)
}

export async function createShortlistShareImage(options: {
  models: PriceModel[]
  asOf: string
}): Promise<Blob> {
  const { canvas, context } = await prepareCanvas()
  const columns = selectShortlist(options.models)
  const quoted = columns.flatMap((column) => column.selections).filter((selection) => selection.model).length
  drawTitle(
    context,
    'Enterprise API shelf',
    'The Shortlist',
    `${quoted} current general-purpose models · input and output dollars per million tokens · log scale`,
  )

  context.font = `700 9px ${SANS}`
  context.textAlign = 'left'
  context.beginPath()
  context.arc(938, 185, 4, 0, Math.PI * 2)
  context.fillStyle = PAPER
  context.fill()
  context.strokeStyle = MUTED
  context.lineWidth = 2
  context.stroke()
  context.fillStyle = MUTED
  context.fillText('INPUT', 949, 188)
  context.beginPath()
  context.arc(1021, 185, 4, 0, Math.PI * 2)
  context.fill()
  context.fillText('OUTPUT', 1032, 188)

  const columnWidth = 255
  const gap = 20
  const left = 60
  const top = 218
  const rowHeight = 52

  columns.forEach((column, columnIndex) => {
    const columnX = left + columnIndex * (columnWidth + gap)
    if (columnIndex > 0) {
      context.strokeStyle = RULE
      context.lineWidth = 1
      context.beginPath()
      context.moveTo(columnX - gap / 2, top)
      context.lineTo(columnX - gap / 2, 548)
      context.stroke()
    }
    context.fillStyle = INK
    context.font = `600 21px ${SERIF}`
    context.fillText(column.title, columnX, top + 16)
    context.fillStyle = FAINT
    context.font = `600 9px ${SANS}`
    context.fillText('$0.1', columnX, top + 38)
    context.textAlign = 'right'
    context.fillText('$100', columnX + columnWidth, top + 38)
    context.textAlign = 'left'

    column.selections.forEach((selection, selectionIndex) => {
      const rowY = top + 48 + selectionIndex * rowHeight
      context.strokeStyle = RULE
      context.beginPath()
      context.moveTo(columnX, rowY)
      context.lineTo(columnX + columnWidth, rowY)
      context.stroke()
      context.fillStyle = MUTED
      context.font = `700 8px ${SANS}`
      context.letterSpacing = '0.8px'
      context.fillText(selection.tier.toUpperCase(), columnX, rowY + 11)
      context.letterSpacing = '0px'

      const model = selection.model
      if (!model) {
        context.fillStyle = FAINT
        context.font = `600 13px ${SERIF}`
        context.fillText('Awaiting a current quote', columnX, rowY + 28)
        return
      }

      context.textAlign = 'right'
      context.fillStyle = FAINT
      context.font = `700 8px ${SANS}`
      context.fillText(model.source === 'firstparty' ? 'FIRST-PARTY' : 'ROUTED', columnX + columnWidth, rowY + 11)
      context.textAlign = 'left'
      context.fillStyle = INK
      context.font = `600 13px ${SERIF}`
      fitAndFillText(context, model.display, columnX, rowY + 28, columnWidth)

      const plotStart = columnX
      const plotEnd = columnX + columnWidth
      const plotY = rowY + 39
      const inputX = plotStart + (logPricePosition(model.input_mtok) / 100) * columnWidth
      const outputX = plotStart + (logPricePosition(model.output_mtok) / 100) * columnWidth
      const color = shortlistProviderColor(model.provider)
      context.strokeStyle = RULE
      context.lineWidth = 1
      context.beginPath()
      context.moveTo(plotStart, plotY)
      context.lineTo(plotEnd, plotY)
      context.stroke()
      context.strokeStyle = color
      context.lineWidth = 3
      context.beginPath()
      context.moveTo(inputX, plotY)
      context.lineTo(outputX, plotY)
      context.stroke()
      context.beginPath()
      context.arc(inputX, plotY, 4, 0, Math.PI * 2)
      context.fillStyle = PAPER
      context.fill()
      context.strokeStyle = color
      context.lineWidth = 2
      context.stroke()
      context.beginPath()
      context.arc(outputX, plotY, 4, 0, Math.PI * 2)
      context.fillStyle = color
      context.fill()
    })
  })

  drawFooter(context, {
    source: 'Official lab price pages + OpenRouter routed listings · first party overrides',
    asOf: options.asOf,
  })
  return canvasToBlob(canvas)
}

export async function createComparisonShareImage(options: {
  results: ComparisonShareResult[]
  workload: ComparisonShareWorkload
  asOf: string
  path?: string
}): Promise<Blob> {
  if (options.results.length < 2) throw new Error('Add at least two models before sharing')
  const { canvas, context } = await prepareCanvas()
  drawTitle(
    context,
    'Costed comparison',
    'Monthly API cost',
    `${options.workload.calls.toLocaleString('en-US')} requests / month · ${options.workload.inputTokens.toLocaleString('en-US')} input + ${options.workload.outputTokens.toLocaleString('en-US')} output tokens each`,
  )

  const results = [...options.results].sort((a, b) => a.monthlyTotal - b.monthlyTotal)
  const maximum = Math.max(...results.map((result) => result.monthlyTotal), 0.000001)
  const minimum = Math.min(...results.map((result) => result.monthlyTotal))
  const rowHeight = Math.min(82, 310 / results.length)
  const top = 225
  const barLeft = 440
  const barWidth = 545

  results.forEach((result, index) => {
    const rowY = top + index * rowHeight
    const isCheapest = result.monthlyTotal === minimum
    context.strokeStyle = RULE
    context.lineWidth = 1
    context.beginPath()
    context.moveTo(60, rowY + rowHeight - 7)
    context.lineTo(1140, rowY + rowHeight - 7)
    context.stroke()
    context.fillStyle = MUTED
    context.font = `700 10px ${SANS}`
    context.letterSpacing = '1px'
    context.fillText(providerName(result.model.provider).toUpperCase(), 60, rowY + 17)
    context.letterSpacing = '0px'
    context.fillStyle = INK
    context.font = `600 22px ${SERIF}`
    fitAndFillText(context, result.model.display, 60, rowY + 45, 345)

    context.fillStyle = RULE
    context.fillRect(barLeft, rowY + 24, barWidth, 25)
    context.fillStyle = isCheapest ? TEAL : BLUE
    context.fillRect(barLeft, rowY + 24, Math.max(3, (result.monthlyTotal / maximum) * barWidth), 25)
    context.textAlign = 'right'
    context.fillStyle = INK
    context.font = `600 25px ${SERIF}`
    context.fillText(shareMoney(result.monthlyTotal), 1140, rowY + 46)
    if (isCheapest) {
      context.fillStyle = TEAL
      context.font = `700 9px ${SANS}`
      context.letterSpacing = '1px'
      context.fillText('LOWEST COST', 1140, rowY + 17)
      context.letterSpacing = '0px'
    }
    context.textAlign = 'left'
  })

  context.fillStyle = MUTED
  context.font = `400 15px ${SERIF}`
  context.fillText('Standard list prices only. Price is not a measure of model quality.', 60, 542)
  drawFooter(context, {
    source: 'The Marginal Token price file · official lab + OpenRouter routed rates',
    asOf: options.asOf,
    path: options.path,
  })
  return canvasToBlob(canvas)
}

export async function createModelShareImage(options: {
  model: PriceModel
  asOf: string
  path?: string
}): Promise<Blob> {
  const { canvas, context } = await prepareCanvas()
  const { model } = options
  drawTitle(
    context,
    `Model card · ${providerName(model.provider)}`,
    model.display,
    model.key,
  )

  const cards = [
    { label: 'Input', value: price(model.input_mtok), note: 'per million tokens' },
    { label: 'Output', value: price(model.output_mtok), note: 'per million tokens' },
    { label: 'Context', value: contextSize(model.context), note: 'input tokens' },
  ]
  const cardTop = 225
  const cardWidth = 340
  const gap = 30
  cards.forEach((card, index) => {
    const cardX = 60 + index * (cardWidth + gap)
    context.fillStyle = PAPER_DEEP
    context.fillRect(cardX, cardTop, cardWidth, 150)
    context.strokeStyle = RULE
    context.strokeRect(cardX, cardTop, cardWidth, 150)
    context.fillStyle = MUTED
    context.font = `700 11px ${SANS}`
    context.letterSpacing = '1.5px'
    context.fillText(card.label.toUpperCase(), cardX + 22, cardTop + 33)
    context.letterSpacing = '0px'
    context.fillStyle = INK
    context.font = `600 43px ${SERIF}`
    fitAndFillText(context, card.value, cardX + 22, cardTop + 91, cardWidth - 44)
    context.fillStyle = MUTED
    context.font = `600 11px ${SANS}`
    context.fillText(card.note.toUpperCase(), cardX + 22, cardTop + 122)
  })

  const tags = capabilityTags(model).slice(0, 7)
  context.fillStyle = MUTED
  context.font = `700 10px ${SANS}`
  context.letterSpacing = '1.2px'
  context.fillText('RECORDED CAPABILITIES', 60, 423)
  context.letterSpacing = '0px'
  let tagX = 60
  let tagY = 443
  context.font = `700 11px ${SANS}`
  for (const tag of tags.length > 0 ? tags : ['No additional capability metadata']) {
    const tagWidth = context.measureText(tag.toUpperCase()).width + 30
    if (tagX + tagWidth > 1140) {
      tagX = 60
      tagY += 42
    }
    context.fillStyle = PAPER_DEEP
    context.fillRect(tagX, tagY, tagWidth, 29)
    context.strokeStyle = RULE
    context.strokeRect(tagX, tagY, tagWidth, 29)
    context.fillStyle = INK
    context.fillText(tag.toUpperCase(), tagX + 15, tagY + 19)
    tagX += tagWidth + 10
  }

  context.fillStyle = MUTED
  context.font = `400 15px ${SERIF}`
  drawWrappedText(
    context,
    'Standard published API rates; cache, batch, priority, regional and long-context adjustments excluded unless noted.',
    60,
    528,
    1080,
    18,
    2,
  )
  drawFooter(context, {
    source: shareSourceLabel(model),
    asOf: options.asOf,
    path: options.path,
  })
  return canvasToBlob(canvas)
}

export async function createOffersShareImage(options: {
  model: PriceModel
  offerModel: OfferModel
  asOf: string
  path?: string
}): Promise<Blob> {
  const groups = comparableOfferGroups(options.offerModel).slice(0, 3)
  if (groups.length === 0) throw new Error('No comparable venue offers to share')

  const { canvas, context } = await prepareCanvas()
  drawTitle(
    context,
    'Venue market · like for like',
    `${options.model.display} venue offers`,
    `${groups.length} leading configurations · highest posted quote versus lowest within each match`,
  )

  context.textAlign = 'right'
  context.fillStyle = TEAL
  context.font = `600 42px ${SERIF}`
  context.fillText(`+${widestOutputSpread(groups).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`, 1140, 150)
  context.fillStyle = MUTED
  context.font = `700 9px ${SANS}`
  context.letterSpacing = '1.2px'
  context.fillText('WIDEST OUTPUT GAP', 1140, 173)
  context.textAlign = 'left'
  context.letterSpacing = '0px'

  const top = 220
  const rowHeight = 102
  groups.forEach((group, index) => {
    const y = top + index * rowHeight
    context.strokeStyle = RULE
    context.lineWidth = 1
    context.beginPath()
    context.moveTo(60, y + rowHeight - 10)
    context.lineTo(1140, y + rowHeight - 10)
    context.stroke()

    context.fillStyle = group.confidence === 'declared' ? TEAL : MUTED
    context.font = `700 9px ${SANS}`
    context.letterSpacing = '1px'
    context.fillText(group.confidence === 'declared' ? 'DECLARED MATCH' : 'NOMINAL MATCH', 60, y + 14)
    context.letterSpacing = '0px'
    context.fillStyle = INK
    context.font = `600 21px ${SERIF}`
    const precision = group.quantization === 'undisclosed' ? 'Precision undisclosed' : group.quantization.toUpperCase()
    fitAndFillText(context, `${precision} · ${contextSize(group.context)} context`, 60, y + 43, 360)
    context.fillStyle = MUTED
    context.font = `600 10px ${SANS}`
    context.fillText(`${group.offerCount} OFFERS · ${group.venueCount} VENUES`, 60, y + 66)

    const metrics = [
      { label: 'INPUT / MTOK', range: group.input_mtok },
      { label: 'OUTPUT / MTOK', range: group.output_mtok },
    ]
    metrics.forEach((metric, metricIndex) => {
      const x = 500 + metricIndex * 325
      context.fillStyle = MUTED
      context.font = `700 9px ${SANS}`
      context.letterSpacing = '1px'
      context.fillText(metric.label, x, y + 14)
      context.letterSpacing = '0px'
      context.fillStyle = INK
      context.font = `600 23px ${SERIF}`
      context.fillText(`${price(metric.range.min)}–${price(metric.range.max)}`, x, y + 43)
      context.fillStyle = TEAL
      context.font = `700 10px ${SANS}`
      const spread = metric.range.spreadPct ?? 0
      context.fillText(spread > 0 ? `HIGH QUOTE +${spread.toLocaleString('en-US', { maximumFractionDigits: 2 })}%` : 'NO SPREAD', x, y + 66)
    })
  })

  context.fillStyle = MUTED
  context.font = `400 14px ${SERIF}`
  context.fillText('Matching posted configurations only. Not a quality, latency, residency, reliability or SLA comparison.', 60, 542)
  drawFooter(context, {
    source: 'OpenRouter endpoints + direct venue catalogs · reported configurations',
    asOf: options.asOf,
    path: options.path,
  })
  return canvasToBlob(canvas)
}

export async function createSpreadsShareImage(options: {
  rows: SpreadRow[]
  asOf: string
  confidence: SpreadConfidence
  path?: string
}): Promise<Blob> {
  const rows = options.rows.slice(0, 5)
  if (rows.length === 0) throw new Error('No market price spreads to share')

  const { canvas, context } = await prepareCanvas()
  const confidenceLabel = options.confidence === 'all'
    ? 'declared + nominal matches'
    : `${options.confidence} matches`
  drawTitle(
    context,
    'Venue market · like for like',
    'The Spreads',
    `Leading posted price gaps · ${confidenceLabel} · highest quote premium over lowest`,
  )

  const top = 218
  const rowHeight = 61
  rows.forEach((row, index) => {
    const y = top + index * rowHeight
    context.strokeStyle = RULE
    context.lineWidth = 1
    context.beginPath()
    context.moveTo(60, y + rowHeight - 8)
    context.lineTo(1140, y + rowHeight - 8)
    context.stroke()

    context.fillStyle = MUTED
    context.font = `700 9px ${SANS}`
    context.letterSpacing = '1px'
    context.fillText(`${index + 1}`.padStart(2, '0'), 60, y + 15)
    context.letterSpacing = '0px'

    context.fillStyle = INK
    context.font = `600 19px ${SERIF}`
    fitAndFillText(context, row.model.display, 96, y + 21, 310)
    context.fillStyle = MUTED
    context.font = `700 8px ${SANS}`
    const precision = row.group.quantization === 'undisclosed' ? 'PRECISION UNDISCLOSED' : row.group.quantization.toUpperCase()
    fitAndFillText(
      context,
      `${precision} · ${contextSize(row.group.context).toUpperCase()} CONTEXT · ${row.group.venueCount} VENUES`,
      96,
      y + 40,
      330,
    )

    const metrics = [
      { x: 485, label: 'INPUT', range: row.group.input_mtok, gap: row.inputSpreadPct },
      { x: 720, label: 'OUTPUT', range: row.group.output_mtok, gap: row.outputSpreadPct },
    ]
    metrics.forEach((metric) => {
      context.fillStyle = MUTED
      context.font = `700 8px ${SANS}`
      context.letterSpacing = '1px'
      context.fillText(metric.label, metric.x, y + 12)
      context.letterSpacing = '0px'
      context.fillStyle = INK
      context.font = `600 17px ${SERIF}`
      context.fillText(`${price(metric.range.min)}–${price(metric.range.max)}`, metric.x, y + 35)
    })

    context.textAlign = 'right'
    context.fillStyle = TEAL
    context.font = `600 27px ${SERIF}`
    context.fillText(`+${row.widestSpreadPct.toLocaleString('en-US', { maximumFractionDigits: 2 })}%`, 1140, y + 28)
    context.fillStyle = MUTED
    context.font = `700 8px ${SANS}`
    context.letterSpacing = '1px'
    context.fillText('WIDEST GAP', 1140, y + 44)
    context.textAlign = 'left'
    context.letterSpacing = '0px'
  })

  context.fillStyle = MUTED
  context.font = `400 14px ${SERIF}`
  context.fillText('Posted routed prices only. Matching reported configurations; not a quality, latency, reliability or SLA comparison.', 60, 542)
  drawFooter(context, {
    source: 'OpenRouter endpoints + direct venue catalogs · reported configurations',
    asOf: options.asOf,
    path: options.path,
  })
  return canvasToBlob(canvas)
}

export async function createInfrastructureShareImage(options: {
  model: PriceModel
  deployment: DeploymentModel
  profile?: DeploymentProfile
  hardware: string
  result: InfrastructureResult
  assumptions: InfrastructureAssumptions
  asOf: string
}): Promise<Blob> {
  const { canvas, context } = await prepareCanvas()
  const lifecycle = options.deployment.lifecycle === 'certified-production'
    ? 'NIM CERTIFIED · PRODUCTION'
    : options.deployment.lifecycle === 'certified-feature'
      ? 'NIM CERTIFIED · FEATURE'
      : 'NIM AVAILABLE'
  const hardware = options.hardware.replace(/^NVIDIA-/, '').replaceAll('-', ' ')
  const profile = options.profile
    ? `TP${options.profile.tensorParallelism} · ${options.profile.precision}${options.profile.optimization ? ` · ${options.profile.optimization}` : ''}${options.profile.lora ? ' · LoRA' : ''}`
    : 'PROFILE UNAVAILABLE'
  drawTitle(
    context,
    'Inference economics · NVIDIA NIM first',
    'Rent vs Run',
    `${options.model.display} · ${lifecycle} · ${hardware} · ${profile}`,
  )

  const columns = [
    {
      x: 60,
      label: `RENT · ${options.result.selectedQuote.label}`,
      value: shareMoney(options.result.apiMonthly),
      note: 'ESTIMATED API / MONTH',
      color: BLUE,
    },
    {
      x: 420,
      label: 'RUN · MODELED NIM CAPACITY',
      value: shareMoney(options.result.runMonthly),
      note: `${options.result.replicas} DEPLOYMENT${options.result.replicas === 1 ? '' : 'S'} / MONTH`,
      color: TEAL,
    },
    {
      x: 780,
      label: 'DIFFERENCE',
      value: shareMoney(Math.abs(options.result.saving)),
      note: options.result.saving >= 0 ? 'MODELED RUN ADVANTAGE' : 'API ADVANTAGE',
      color: options.result.saving >= 0 ? TEAL : CLARET,
    },
  ]
  columns.forEach((column, index) => {
    if (index > 0) {
      context.strokeStyle = RULE
      context.beginPath()
      context.moveTo(column.x - 28, 225)
      context.lineTo(column.x - 28, 355)
      context.stroke()
    }
    context.fillStyle = MUTED
    context.font = `700 9px ${SANS}`
    context.letterSpacing = '1px'
    fitAndFillText(context, column.label, column.x, 245, 320)
    context.letterSpacing = '0px'
    context.fillStyle = column.color
    context.font = `600 48px ${SERIF}`
    context.fillText(column.value, column.x, 305)
    context.fillStyle = MUTED
    context.font = `700 9px ${SANS}`
    context.letterSpacing = '1px'
    context.fillText(column.note, column.x, 334)
    context.letterSpacing = '0px'
  })

  context.fillStyle = PAPER_DEEP
  context.fillRect(60, 382, 1080, 126)
  context.fillStyle = MUTED
  context.font = `700 10px ${SANS}`
  context.letterSpacing = '1.2px'
  context.fillText('VISIBLE PLANNING ASSUMPTIONS', 80, 407)
  context.letterSpacing = '0px'
  context.fillStyle = INK
  context.font = `600 19px ${SERIF}`
  const totalMillions = options.assumptions.inputMillions + options.assumptions.outputMillions
  const volume = totalMillions >= 1_000_000
    ? `${(totalMillions / 1_000_000).toFixed(2)}T`
    : `${(totalMillions / 1_000).toFixed(2)}B`
  context.fillText(`${volume} tokens / month`, 80, 443)
  fitAndFillText(context, hardware, 350, 443, 250)
  fitAndFillText(context, profile, 650, 443, 220)
  context.fillText(`${options.assumptions.outputTokensPerSecond.toLocaleString('en-US')} output tok/s`, 890, 443)
  context.fillStyle = MUTED
  context.font = `600 11px ${SANS}`
  context.fillText(`${shareMoney(options.assumptions.gpuHourly)} / GPU-hour`, 80, 476)
  context.fillText(`${options.assumptions.utilizationPct}% usable utilization`, 350, 476)
  context.fillText(`${shareMoney(options.assumptions.licensePerGpuYear)} software / GPU-year`, 650, 476)
  context.fillText('USER-SUPPLIED · NOT A BENCHMARK', 890, 476)

  context.fillStyle = MUTED
  context.font = `400 14px ${SERIF}`
  const verdict = options.result.breakEvenWithinCapacity && options.result.breakEvenMillions !== null
    ? `First-deployment break-even: ${(options.result.breakEvenMillions / 1_000).toLocaleString('en-US', { maximumFractionDigits: 2 })}B total tokens / month.`
    : 'No crossover before one modeled deployment exhausts its output capacity.'
  context.fillText(verdict, 60, 540)
  drawFooter(context, {
    source: 'NVIDIA NIM support matrix + posted API routes · visible user assumptions',
    asOf: options.asOf,
    path: '/infrastructure/',
  })
  return canvasToBlob(canvas)
}
