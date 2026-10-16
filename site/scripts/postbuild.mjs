import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFeeds } from './feeds.mjs'

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const siteDir = path.dirname(scriptsDir)
const rootDir = path.dirname(siteDir)
const distDir = path.join(siteDir, 'dist')
const dataDir = process.env.MARGINALTOKEN_DATA_DIR || path.join(rootDir,'data')

await cp(dataDir, path.join(distDir, 'data'), { recursive: true })
await copyFile(path.join(rootDir, 'CNAME'), path.join(distDir, 'CNAME'))
await writeFile(path.join(distDir, '.nojekyll'), '')

const shell = await readFile(path.join(distDir, 'index.html'), 'utf8')

for (const route of ['tape', 'methodology', 'model', 'plan', 'watch']) {
  const routeDir = path.join(distDir, route)
  await mkdir(routeDir, { recursive: true })
  await copyFile(path.join(distDir, 'index.html'), path.join(routeDir, 'index.html'))
}

const openTitle = 'Open model weights & licenses — The Marginal Token'
const openDescription = 'Explore verified model weight repositories, license terms, hosted API prices, and workload cost comparisons.'
const openUrl = 'https://marginaltoken.com/open/'
const openHtml = shell.replace('<title>The Marginal Token</title>', `<title>${openTitle}</title>`)
  .replaceAll('content="Independent AI model prices, weekly release reviews, and practical tools for comparing API and self-hosting costs."', `content="${openDescription}"`)
  .replace('<link rel="canonical" href="https://marginaltoken.com/" />', `<link rel="canonical" href="${openUrl}" />`)
  .replace('<meta property="og:title" content="The Marginal Token" />', `<meta property="og:title" content="${openTitle}" />`)
  .replace('<meta property="og:url" content="https://marginaltoken.com/" />', `<meta property="og:url" content="${openUrl}" />`)
  .replace('<meta name="twitter:title" content="The Marginal Token" />', `<meta name="twitter:title" content="${openTitle}" />`)
await mkdir(path.join(distDir, 'open'), { recursive: true })
await writeFile(path.join(distDir, 'open', 'index.html'), openHtml)

const infrastructureTitle = 'Rent vs Run AI inference — The Marginal Token'
const infrastructureDescription = 'Compare posted AI API prices with a transparent NVIDIA NIM capacity plan and find whether a modeled break-even exists.'
const infrastructureUrl = 'https://marginaltoken.com/infrastructure/'
let infrastructureHtml = shell
  .replace('<title>The Marginal Token</title>', `<title>${infrastructureTitle}</title>`)
  .replaceAll(
    'content="Independent AI model prices, weekly release reviews, and practical tools for comparing API and self-hosting costs."',
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
const compareDescription = 'Compare model billing plans, cache and reasoning costs, retries, human review, and cost per successful task using your workload assumptions.'
const compareUrl = 'https://marginaltoken.com/compare/'
let compareHtml = shell
  .replace('<title>The Marginal Token</title>', `<title>${compareTitle}</title>`)
  .replaceAll(
    'content="Independent AI model prices, weekly release reviews, and practical tools for comparing API and self-hosting costs."',
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
    'content="Independent AI model prices, weekly release reviews, and practical tools for comparing API and self-hosting costs."',
    `content="${spreadsDescription}"`,
  )
  .replace('<link rel="canonical" href="https://marginaltoken.com/" />', `<link rel="canonical" href="${spreadsUrl}" />`)
  .replace('<meta property="og:title" content="The Marginal Token" />', `<meta property="og:title" content="${spreadsTitle}" />`)
  .replace('<meta property="og:url" content="https://marginaltoken.com/" />', `<meta property="og:url" content="${spreadsUrl}" />`)
  .replace('<meta name="twitter:title" content="The Marginal Token" />', `<meta name="twitter:title" content="${spreadsTitle}" />`)
const spreadsDir = path.join(distDir, 'spreads')
await mkdir(spreadsDir, { recursive: true })
await writeFile(path.join(spreadsDir, 'index.html'), spreadsHtml)

const prices = JSON.parse(await readFile(path.join(dataDir, 'prices.json'), 'utf8'))
const history = JSON.parse(await readFile(path.join(dataDir, 'history.json'), 'utf8'))
const changes = JSON.parse(await readFile(path.join(dataDir, 'changes.json'), 'utf8'))
const register = JSON.parse(await readFile(path.join(rootDir, 'collector/model-register.json'), 'utf8'))
await copyFile(path.join(rootDir,'collector/hosting-reviewed.json'),path.join(distDir,'data/hosting.json'))
// A collector-produced register includes the active basket. Cold builds publish
// reviewed identities and policy without pretending they have freshly promoted.
try { await readFile(path.join(dataDir,'model-register.json')) }
catch { await writeFile(path.join(distDir,'data/model-register.json'),JSON.stringify(register,null,2)+'\n') }
const escapeAttribute = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')

const replaceMeta = (html, selector, from, to) => {
  if (!html.includes(from)) throw new Error(`Missing ${selector} metadata placeholder`)
  return html.replace(from, to)
}

const marketNotes = JSON.parse(await readFile(path.join(siteDir, 'src/content/market-notes.json'), 'utf8'))
const editorialShell = (title, description, url) => shell
  .replace('<title>The Marginal Token</title>', `<title>${escapeAttribute(title)}</title>`)
  .replaceAll('content="Independent AI model prices, weekly release reviews, and practical tools for comparing API and self-hosting costs."', `content="${escapeAttribute(description)}"`)
  .replace('<link rel="canonical" href="https://marginaltoken.com/" />', `<link rel="canonical" href="${escapeAttribute(url)}" />`)
  .replace('<meta property="og:title" content="The Marginal Token" />', `<meta property="og:title" content="${escapeAttribute(title)}" />`)
  .replace('<meta property="og:url" content="https://marginaltoken.com/" />', `<meta property="og:url" content="${escapeAttribute(url)}" />`)
  .replace('<meta name="twitter:title" content="The Marginal Token" />', `<meta name="twitter:title" content="${escapeAttribute(title)}" />`)
const notesDir = path.join(distDir, 'notes')
for(const [route,title,description] of [['plan','Plan AI workload costs','Mixed fleets, local usage repricing and measured capability within your budget.'],['watch','Watch AI workload costs','Browser-saved workloads and public feeds for price and lifecycle changes.']]) {
  await writeFile(path.join(distDir,route,'index.html'),editorialShell(`${title} — The Marginal Token`,description,`https://marginaltoken.com/${route}/`))
}
await writeFeeds(distDir,{notes:marketNotes,changes:changes.changes,register,generatedAt:prices.generatedAt,keys:[...prices.models.map((m) => m.key),...history.points.map((p) => p.key)]})
await mkdir(notesDir, { recursive: true })
await writeFile(path.join(notesDir, 'index.html'), editorialShell(
  'Market notes — The Marginal Token',
  'Weekly model-release reviews and short notes on the cost of buying and running AI, linked to verified sources and practical tools.',
  'https://marginaltoken.com/notes/',
))
const noteSlugs = new Set()
for (const note of marketNotes) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(note.slug) || noteSlugs.has(note.slug)) {
    throw new Error(`Invalid or duplicate market note slug: ${note.slug}`)
  }
  noteSlugs.add(note.slug)
  const url = `https://marginaltoken.com/notes/${note.slug}/`
  const structuredData = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: note.title,
    description: note.summary,
    datePublished: note.date,
    dateModified: note.checked,
    ...(note.kind === 'weekly' ? { temporalCoverage: `${note.periodStart}/${note.periodEnd}`, articleSection: 'Weekly review' } : {}),
    author: { '@type': 'Person', name: note.author },
    publisher: { '@type': 'Organization', name: 'The Marginal Token', url: 'https://marginaltoken.com/' },
    mainEntityOfPage: url,
    citation: note.sources.map((source) => source.href),
  }).replaceAll('<', '\\u003c')
  const noteHtml = editorialShell(`${note.title} — The Marginal Token`, note.summary, url)
    .replace('<meta property="og:type" content="website" />', '<meta property="og:type" content="article" />')
    .replace('</head>', `    <meta property="article:published_time" content="${escapeAttribute(note.date)}" />\n    <script type="application/ld+json">${structuredData}</script>\n  </head>`)
  await mkdir(path.join(notesDir, note.slug), { recursive: true })
  await writeFile(path.join(notesDir, note.slug, 'index.html'), noteHtml)
}

const currentKeys=new Set(prices.models.map((m) => m.key))
const archived=new Map()
for(const point of [...history.points].sort((a,b) => a.date.localeCompare(b.date))) {
  if(currentKeys.has(point.key)) continue
  const event=changes.changes.find((e) => e.key===point.key)
  archived.set(point.key,{...point,display:event?.display ?? point.key,archived:true})
}
for (const model of [...prices.models,...archived.values()]) {
  const segments = model.key.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) continue

  const routePath = `/model/${segments.map(encodeURIComponent).join('/')}/`
  const canonicalUrl = `https://marginaltoken.com${routePath}`
  const title = `${model.display} ${model.archived ? 'archived prices' : 'pricing & model card'} — The Marginal Token`
  const description = model.archived ? `Archived quote history for ${model.display}. Last observed ${model.date}; this listing has no current tape quote.` : `Current standard API pricing for ${model.display}: $${model.input_mtok} input and $${model.output_mtok} output per million tokens.`
  let modelHtml = shell
    .replace('<title>The Marginal Token</title>', `<title>${escapeAttribute(title)}</title>`)
  modelHtml = replaceMeta(
    modelHtml,
    'description',
    'content="Independent AI model prices, weekly release reviews, and practical tools for comparing API and self-hosting costs."',
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
    'content="Independent AI model prices, weekly release reviews, and practical tools for comparing API and self-hosting costs."',
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
    'content="Independent AI model prices, weekly release reviews, and practical tools for comparing API and self-hosting costs."',
    `content="${escapeAttribute(description)}"`,
  )
  const modelDir = path.join(distDir, 'model', ...segments)
  await mkdir(modelDir, { recursive: true })
  await writeFile(path.join(modelDir, 'index.html'), modelHtml)
}

await copyFile(path.join(distDir, 'index.html'), path.join(distDir, '404.html'))
