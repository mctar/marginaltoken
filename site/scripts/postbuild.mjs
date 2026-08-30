import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const siteDir = path.dirname(scriptsDir)
const rootDir = path.dirname(siteDir)
const distDir = path.join(siteDir, 'dist')

await cp(path.join(rootDir, 'data'), path.join(distDir, 'data'), { recursive: true })
await copyFile(path.join(rootDir, 'CNAME'), path.join(distDir, 'CNAME'))
await writeFile(path.join(distDir, '.nojekyll'), '')

const shell = await readFile(path.join(distDir, 'index.html'), 'utf8')

for (const route of ['tape', 'methodology', 'model']) {
  const routeDir = path.join(distDir, route)
  await mkdir(routeDir, { recursive: true })
  await copyFile(path.join(distDir, 'index.html'), path.join(routeDir, 'index.html'))
}

const infrastructureTitle = 'Rent vs Run AI inference — The Marginal Token'
const infrastructureDescription = 'Compare posted AI API prices with a transparent NVIDIA NIM capacity plan and find whether a modeled break-even exists.'
const infrastructureUrl = 'https://marginaltoken.com/infrastructure/'
let infrastructureHtml = shell
  .replace('<title>The Marginal Token</title>', `<title>${infrastructureTitle}</title>`)
  .replaceAll(
    'content="The independent price tape marking frontier AI intelligence to market—model by model, million tokens at a time."',
    `content="${infrastructureDescription}"`,
  )
  .replace('<link rel="canonical" href="https://marginaltoken.com/" />', `<link rel="canonical" href="${infrastructureUrl}" />`)
  .replace('<meta property="og:title" content="The Marginal Token" />', `<meta property="og:title" content="${infrastructureTitle}" />`)
  .replace('<meta property="og:url" content="https://marginaltoken.com/" />', `<meta property="og:url" content="${infrastructureUrl}" />`)
  .replace('<meta name="twitter:title" content="The Marginal Token" />', `<meta name="twitter:title" content="${infrastructureTitle}" />`)
const infrastructureDir = path.join(distDir, 'infrastructure')
await mkdir(infrastructureDir, { recursive: true })
await writeFile(path.join(infrastructureDir, 'index.html'), infrastructureHtml)

const compareTitle = 'AI model cost comparison — The Marginal Token'
const compareDescription = 'Compare current AI model API prices against your workload, from cost per request to estimated monthly spend.'
const compareUrl = 'https://marginaltoken.com/compare/'
let compareHtml = shell
  .replace('<title>The Marginal Token</title>', `<title>${compareTitle}</title>`)
  .replaceAll(
    'content="The independent price tape marking frontier AI intelligence to market—model by model, million tokens at a time."',
    `content="${compareDescription}"`,
  )
  .replace('<link rel="canonical" href="https://marginaltoken.com/" />', `<link rel="canonical" href="${compareUrl}" />`)
  .replace('<meta property="og:title" content="The Marginal Token" />', `<meta property="og:title" content="${compareTitle}" />`)
  .replace('<meta property="og:url" content="https://marginaltoken.com/" />', `<meta property="og:url" content="${compareUrl}" />`)
  .replace('<meta name="twitter:title" content="The Marginal Token" />', `<meta name="twitter:title" content="${compareTitle}" />`)
const compareDir = path.join(distDir, 'compare')
await mkdir(compareDir, { recursive: true })
await writeFile(path.join(compareDir, 'index.html'), compareHtml)

const spreadsTitle = 'AI model price spreads — The Marginal Token'
const spreadsDescription = 'Compare like-for-like routed AI model API prices across serving venues and find the widest posted price gaps.'
const spreadsUrl = 'https://marginaltoken.com/spreads/'
let spreadsHtml = shell
  .replace('<title>The Marginal Token</title>', `<title>${spreadsTitle}</title>`)
  .replaceAll(
    'content="The independent price tape marking frontier AI intelligence to market—model by model, million tokens at a time."',
    `content="${spreadsDescription}"`,
  )
  .replace('<link rel="canonical" href="https://marginaltoken.com/" />', `<link rel="canonical" href="${spreadsUrl}" />`)
  .replace('<meta property="og:title" content="The Marginal Token" />', `<meta property="og:title" content="${spreadsTitle}" />`)
  .replace('<meta property="og:url" content="https://marginaltoken.com/" />', `<meta property="og:url" content="${spreadsUrl}" />`)
  .replace('<meta name="twitter:title" content="The Marginal Token" />', `<meta name="twitter:title" content="${spreadsTitle}" />`)
const spreadsDir = path.join(distDir, 'spreads')
await mkdir(spreadsDir, { recursive: true })
await writeFile(path.join(spreadsDir, 'index.html'), spreadsHtml)

const prices = JSON.parse(await readFile(path.join(rootDir, 'data', 'prices.json'), 'utf8'))
const escapeAttribute = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')

const replaceMeta = (html, selector, from, to) => {
  if (!html.includes(from)) throw new Error(`Missing ${selector} metadata placeholder`)
  return html.replace(from, to)
}

for (const model of prices.models) {
  const segments = model.key.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) continue

  const routePath = `/model/${segments.map(encodeURIComponent).join('/')}/`
  const canonicalUrl = `https://marginaltoken.com${routePath}`
  const title = `${model.display} pricing & model card — The Marginal Token`
  const description = `Current standard API pricing for ${model.display}: $${model.input_mtok} input and $${model.output_mtok} output per million tokens.`
  let modelHtml = shell
    .replace('<title>The Marginal Token</title>', `<title>${escapeAttribute(title)}</title>`)
  modelHtml = replaceMeta(
    modelHtml,
    'description',
    'content="The independent price tape marking frontier AI intelligence to market—model by model, million tokens at a time."',
    `content="${escapeAttribute(description)}"`,
  )
  modelHtml = replaceMeta(
    modelHtml,
    'canonical URL',
    '<link rel="canonical" href="https://marginaltoken.com/" />',
    `<link rel="canonical" href="${escapeAttribute(canonicalUrl)}" />`,
  )
  modelHtml = replaceMeta(
    modelHtml,
    'Open Graph title',
    '<meta property="og:title" content="The Marginal Token" />',
    `<meta property="og:title" content="${escapeAttribute(title)}" />`,
  )
  modelHtml = replaceMeta(
    modelHtml,
    'Open Graph description',
    'content="The independent price tape marking frontier AI intelligence to market—model by model, million tokens at a time."',
    `content="${escapeAttribute(description)}"`,
  )
  modelHtml = replaceMeta(
    modelHtml,
    'Open Graph URL',
    '<meta property="og:url" content="https://marginaltoken.com/" />',
    `<meta property="og:url" content="${escapeAttribute(canonicalUrl)}" />`,
  )
  modelHtml = replaceMeta(
    modelHtml,
    'Twitter title',
    '<meta name="twitter:title" content="The Marginal Token" />',
    `<meta name="twitter:title" content="${escapeAttribute(title)}" />`,
  )
  modelHtml = replaceMeta(
    modelHtml,
    'Twitter description',
    'content="The independent price tape marking frontier AI intelligence to market—model by model, million tokens at a time."',
    `content="${escapeAttribute(description)}"`,
  )
  const modelDir = path.join(distDir, 'model', ...segments)
  await mkdir(modelDir, { recursive: true })
  await writeFile(path.join(modelDir, 'index.html'), modelHtml)
}

await copyFile(path.join(distDir, 'index.html'), path.join(distDir, '404.html'))
