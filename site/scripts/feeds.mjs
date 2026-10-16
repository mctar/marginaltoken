import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const xml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
export function storyId(event) {
  const identity = [
    event.type,
    event.key,
    event.date,
    event.field,
    event.from,
    event.to,
    event.kind,
  ]
  return (
    'urn:marginal-token:' +
    createHash('sha256').update(JSON.stringify(identity)).digest('hex')
  )
}
export function rss(title, href, items, generatedAt) {
  const unique = [...new Map(items.map((item) => [item.guid, item])).values()]
    .filter((i) => Number.isFinite(Date.parse(i.date)))
    .sort(
      (a, b) => b.date.localeCompare(a.date) || a.guid.localeCompare(b.guid),
    )
    .slice(0, 200)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${xml(title)}</title><link>https://marginaltoken.com/</link><description>Changes that affect the cost of buying and running AI.</description><language>en</language><lastBuildDate>${new Date(generatedAt).toUTCString()}</lastBuildDate><atom:link href="${xml(href)}" rel="self" type="application/rss+xml"/>${unique.map((i) => `<item><title>${xml(i.title)}</title><link>${xml(i.link)}</link><guid isPermaLink="false">${xml(i.guid)}</guid><pubDate>${new Date(i.date).toUTCString()}</pubDate><description>${xml(i.description)}</description></item>`).join('')}</channel></rss>\n`
}
export function feedItems(notes, changes, register) {
  const canonical = (key) =>
    Object.entries(register.models).find(([, r]) =>
      r.aliases?.includes(key),
    )?.[0] ?? key
  const noteItems = notes.map((n) => ({
    kind: 'note',
    keys: [canonical(n.modelKey), ...(n.comparisonModelKey ? [canonical(n.comparisonModelKey)] : [])],
    title: n.title,
    date: n.date,
    link: `https://marginaltoken.com/notes/${n.slug}/`,
    guid: `urn:marginal-token:note:${n.slug}`,
    description: n.summary,
  }))
  const changeItems = changes
    .filter((e) => e.type !== 'basket')
    .map((e) => ({
      kind: e.type === 'price' ? 'price' : 'lifecycle',
      keys: [canonical(e.key)],
      title:
        e.type === 'price'
          ? `${e.display}: ${e.field === 'input_mtok' ? 'input' : 'output'} quote $${e.from} → $${e.to} / million tokens`
          : `${e.display}: ${canonical(e.key) !== e.key ? 'routed alias ledger entry' : e.type === 'listed' ? 'observed listing' : 'removed from tape'}`,
      date: e.date,
      link: `https://marginaltoken.com/model/${canonical(e.key).split('/').map(encodeURIComponent).join('/')}/`,
      guid: storyId(e),
      description:
        canonical(e.key) !== e.key
          ? `Routed ID ${e.key}: its observations are retained under ${canonical(e.key)}. This ledger entry does not establish retirement of the canonical model.`
          : e.type === 'delisted'
            ? 'The listing was removed from the price tape. This does not establish provider retirement; check its model card and official sources.'
            : 'Observed ledger change. The model card shows saved quotes and source details; historical observations may lack provenance.',
    }))
  const lifecycle = []
  for (const [key, r] of Object.entries(register.models)) {
    const events = [
      ...(r.events ?? []),
      ...(r.lifecycle
        ? [
            {
              date: r.lifecycle.date,
              kind: r.lifecycle.status,
              label: r.lifecycle.detail ?? r.lifecycle.status,
              sourceUrl: r.lifecycle.sourceUrl,
            },
          ]
        : []),
    ]
    for (const e of events)
      lifecycle.push({
        kind: 'lifecycle',
        keys: [key],
        title: `${r.display ?? key}: ${e.kind === 'expectation' ? 'expected date, requires recheck' : e.kind}`,
        date: e.announcedAt ?? e.date,
        link: `https://marginaltoken.com/model/${key}/`,
        guid: storyId({ ...e, key, type: 'lifecycle' }),
        description: `${e.date}: ${e.label} Source: ${e.sourceUrl}`,
      })
  }
  return [...noteItems, ...changeItems, ...lifecycle]
}
export async function writeFeeds(
  distDir,
  { notes, changes, register, generatedAt, keys },
) {
  const dir = path.join(distDir, 'feeds')
  await mkdir(dir, { recursive: true })
  const items = feedItems(notes, changes, register)
  for (const [name, kind, title] of [
    ['notes', 'note', 'Market notes'],
    ['prices', 'price', 'Price changes'],
    ['lifecycle', 'lifecycle', 'Listings and lifecycle'],
  ])
    await writeFile(
      path.join(dir, name + '.xml'),
      rss(
        `${title} — The Marginal Token`,
        `https://marginaltoken.com/feeds/${name}.xml`,
        items.filter((i) => i.kind === kind),
        generatedAt,
      ),
    )
  for (const key of [...new Set([...keys, ...Object.keys(register.models)])]) {
    const segments = key.split('/')
    if (
      segments.length < 2 ||
      segments.some((s) => !s || s === '.' || s === '..' || s.includes('\\'))
    )
      continue
    const filename = path.join(dir, 'model', ...segments) + '.xml'
    await mkdir(path.dirname(filename), { recursive: true })
    await writeFile(
      filename,
      rss(
        `${register.models[key]?.display ?? key} — The Marginal Token`,
        `https://marginaltoken.com/feeds/model/${segments.map(encodeURIComponent).join('/')}.xml`,
        items.filter((i) => i.keys.includes(key)),
        generatedAt,
      ),
    )
  }
}
