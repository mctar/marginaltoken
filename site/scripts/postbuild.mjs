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

const prices = JSON.parse(await readFile(path.join(rootDir, 'data', 'prices.json'), 'utf8'))
const escapeAttribute = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')

for (const model of prices.models) {
  const segments = model.key.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) continue

  const routePath = `/model/${segments.map(encodeURIComponent).join('/')}/`
  const canonicalUrl = `https://marginaltoken.com${routePath}`
  const title = `${model.display} pricing & model card — The Marginal Token`
  const description = `Current standard API pricing for ${model.display}: $${model.input_mtok} input and $${model.output_mtok} output per million tokens.`
  const metadata = [
    `<link rel="canonical" href="${escapeAttribute(canonicalUrl)}" />`,
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="The Marginal Token" />',
    `<meta property="og:title" content="${escapeAttribute(title)}" />`,
    `<meta property="og:description" content="${escapeAttribute(description)}" />`,
    `<meta property="og:url" content="${escapeAttribute(canonicalUrl)}" />`,
    '<meta name="twitter:card" content="summary" />',
  ].join('\n    ')
  const modelHtml = shell
    .replace('<title>The Marginal Token</title>', `<title>${escapeAttribute(title)}</title>`)
    .replace(
      'content="The Marginal Token tracks standard token prices across AI models and providers."',
      `content="${escapeAttribute(description)}"`,
    )
    .replace('</head>', `    ${metadata}\n  </head>`)
  const modelDir = path.join(distDir, 'model', ...segments)
  await mkdir(modelDir, { recursive: true })
  await writeFile(path.join(modelDir, 'index.html'), modelHtml)
}

await copyFile(path.join(distDir, 'index.html'), path.join(distDir, '404.html'))
