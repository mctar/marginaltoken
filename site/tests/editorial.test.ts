import test from 'node:test'
import assert from 'node:assert/strict'
import { frontPageStories, marketNotes, type WeeklyReview } from '../src/lib/market-notes.ts'
import { feedItems } from '../scripts/feeds.mjs'

// Fixed dates keep time-dependent behavior independent of the newest edition.
const weekly: WeeklyReview = { ...marketNotes.find((note): note is WeeklyReview => note.kind === 'weekly')!,
  date: '2026-10-16', periodStart: '2026-10-12', periodEnd: '2026-10-18' }
const model = marketNotes.find((note) => note.kind !== 'weekly' && note.kind !== 'standalone')!

test('a current weekly edition leads ahead of daily notes without repeating a story', () => {
  const newer = { ...model, date: '2026-10-20' }
  const { lead, recent } = frontPageStories([newer, weekly], new Date('2026-10-20T08:00:00Z'))
  assert.equal(lead?.slug, weekly.slug)
  assert.deepEqual(recent.map((note) => note.slug), [newer.slug])
})

test('old editions yield to recent reporting and future-dated notes do not lead', () => {
  const current = { ...model, date: '2026-11-02' }
  const future = { ...weekly, date: '2026-11-09', slug: 'future' }
  const { lead } = frontPageStories([future, current, weekly], new Date('2026-11-02T07:00:00Z'))
  assert.equal(lead?.slug, current.slug)
  assert.equal(frontPageStories([], new Date('2026-11-02')).lead, undefined)
})

test('weekly RSS items reach every covered canonical model with a stable edition identity', () => {
  const review = { ...weekly, modelKeys: ['lab/alias', 'lab/canonical', 'lab/other'] }
  const register = { models: { 'lab/canonical': { aliases: ['lab/alias'] } } }
  const [item] = feedItems([review], [], register)
  assert.deepEqual(item.keys, ['lab/canonical', 'lab/other'])
  const [completed] = feedItems([{ ...review, title: 'Completed week', periodEnd: '2026-10-18' }], [], register)
  assert.equal(item.guid, completed.guid)
  const [legacy] = feedItems([{ ...model, modelKey: 'lab/alias', comparisonModelKey: 'lab/other' }], [], register)
  assert.deepEqual(legacy.keys, ['lab/canonical', 'lab/other'])
})

test('standalone notes reach editorial RSS without inventing a ledger identity', () => {
  const note = marketNotes.find((note) => note.kind === 'standalone')!
  assert.ok(note)
  const [item] = feedItems([note], [], { models: {} })
  assert.equal(item.kind, 'note')
  assert.deepEqual(item.keys, [])
  assert.equal(item.link, `https://marginaltoken.com/notes/${note.slug}/`)
})

test('weekly release dates stay inside the stated window and links have explicit destinations', () => {
  for (const review of marketNotes.filter((note): note is WeeklyReview => note.kind === 'weekly')) {
    assert.ok(review.periodStart <= review.periodEnd)
    assert.ok(review.periodEnd <= review.cutoff.slice(0, 10))
    for (const entry of review.releases) {
      assert.ok(entry.date >= review.periodStart && entry.date <= review.periodEnd, entry.name)
      assert.ok(entry.links.some((link) => link.href.startsWith('https://')), entry.name)
    }
    for (const item of [...review.releases, ...review.updates, ...review.watching, ...review.takeaways]) {
      for (const link of item.links) assert.match(link.href, /^(https:\/\/|\/(?!\/))/)
    }
  }
})
