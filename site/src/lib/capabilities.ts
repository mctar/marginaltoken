import type { PriceModel } from './types'

export type Capability = 'vision' | 'audio' | 'audio-output' | 'video' | 'reasoning' | 'tools' | 'structured'

export const capabilityOptions: ReadonlyArray<{ value: Capability; label: string }> = [
  { value: 'vision', label: 'Vision input' },
  { value: 'audio', label: 'Audio input' },
  { value: 'audio-output', label: 'Audio output' },
  { value: 'video', label: 'Video input' },
  { value: 'reasoning', label: 'Reasoning' },
  { value: 'tools', label: 'Tool calling' },
  { value: 'structured', label: 'Structured output' },
]

export function supportsCapability(model: PriceModel, capability: Capability): boolean {
  if (capability === 'vision') return model.inputModalities?.includes('image') ?? false
  if (capability === 'audio') return model.inputModalities?.includes('audio') ?? false
  if (capability === 'audio-output') return model.outputModalities?.includes('audio') ?? false
  if (capability === 'video') return model.inputModalities?.includes('video') ?? false
  if (capability === 'reasoning') return model.supportsReasoning ?? false
  if (capability === 'tools') return model.supportsTools ?? false
  return model.supportsStructuredOutput ?? false
}
