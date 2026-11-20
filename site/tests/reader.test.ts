import assert from 'node:assert/strict'
import test from 'node:test'
import { examples, meteredTotal, readQuantity } from '../src/lib/worked-examples.ts'
import { findProfiles, profiles, tasks } from '../src/lib/field-guide.ts'
import { marketNotes, frontPageStories } from '../src/lib/market-notes.ts'

test('each reader task leads to a sourced model even without hosted price data', () => {
  for (const task of tasks) assert.ok(findProfiles(task.id, '').length, task.label)
  for (const p of profiles) {
    assert.ok(p.source.startsWith('https://'))
    if (p.note)
      assert.ok(
        marketNotes.some((n) => n.slug === p.note),
        p.note,
      )
  }
  assert.equal(findProfiles('diarization', 'gated')[0]?.id, 'community-1')
  assert.equal(findProfiles('speech', 'not-a-model').length, 0)
})

test('voice and image tariffs use the documented meters with no rounding before summation', () => {
  assert.equal(meteredTotal(examples.voice.meters, ['600', '300']), 0.6)
  assert.equal(meteredTotal(examples.voice.meters, ['1', '0']), 0.05 / 60)
  assert.equal(meteredTotal(examples.voice.meters, ['0', '0']), 0)
  assert.ok(
    Math.abs(meteredTotal(examples.images.meters, ['100', '4000', '8000'])! - 0.03663) < 1e-12,
  )
  for (const invalid of ['', '  ', '-1', '4.5', 'NaN', 'Infinity'])
    assert.equal(readQuantity(invalid), null)
  assert.equal(meteredTotal(examples.voice.meters, ['3']), null)
})

test('editorial selection expires and future stories cannot lead', () => {
  const note = marketNotes.find((n) => n.featureUntil)!
  const weekly = marketNotes.find((n) => n.kind === 'weekly')!
  assert.equal(
    frontPageStories([weekly, note], new Date(note.date + 'T12:00:00Z')).lead?.slug,
    note.slug,
  )
  assert.equal(
    frontPageStories([weekly, note], new Date('2026-11-23T12:00:00Z')).lead?.slug,
    weekly.slug,
  )
})
