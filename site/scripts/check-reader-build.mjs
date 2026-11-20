import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const dist = new URL('../dist/', import.meta.url)
for (const route of [
  'explore',
  'understand',
  'costs',
  'ledger',
  'tape',
  'open',
  'compare',
  'watch',
  'spreads',
  'methodology',
  'plan',
  'infrastructure',
  'notes',
]) {
  const html = await readFile(new URL(route + '/index.html', dist), 'utf8')
  assert.ok(html.includes('rel="canonical" href="https://marginaltoken.com/' + route + '/"'), route)
}
const notes = JSON.parse(
  await readFile(new URL('../src/content/market-notes.json', import.meta.url)),
)
for (const note of notes) {
  const path = 'notes/' + note.slug + '/'
  const html = await readFile(new URL(path + 'index.html', dist), 'utf8')
  assert.ok(
    html.includes('rel="canonical" href="https://marginaltoken.com/' + path + '"'),
    note.slug,
  )
}
console.log(
  'Reader pages, legacy routes and all ' +
    notes.length +
    ' note pages have matching canonical URLs.',
)
