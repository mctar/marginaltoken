import assert from 'node:assert/strict'
import test from 'node:test'
import { capabilityOptions, supportsCapability } from '../src/lib/capabilities.ts'
import type { PriceModel } from '../src/lib/types.ts'

function model(overrides: Partial<PriceModel>): PriceModel {
  return {
    key: 'lab/model',
    display: 'Model',
    provider: 'lab',
    input_mtok: 1,
    output_mtok: 2,
    context: 128_000,
    source: 'openrouter',
    ...overrides,
  }
}

test('offers audio input and audio output as distinct filters', () => {
  assert.ok(capabilityOptions.some((option) => option.value === 'audio' && option.label === 'Audio input'))
  assert.ok(capabilityOptions.some((option) => option.value === 'audio-output' && option.label === 'Audio output'))
})

test('requires declared output audio for the audio-output filter', () => {
  const listener = model({ inputModalities: ['audio', 'text'], outputModalities: ['text'] })
  const speaker = model({ inputModalities: ['text'], outputModalities: ['audio', 'text'] })

  assert.equal(supportsCapability(listener, 'audio'), true)
  assert.equal(supportsCapability(listener, 'audio-output'), false)
  assert.equal(supportsCapability(speaker, 'audio'), false)
  assert.equal(supportsCapability(speaker, 'audio-output'), true)
})
