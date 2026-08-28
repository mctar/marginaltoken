import type { PriceModel } from './types'

export function modelPath(key: string): string {
  return `/model/${key.split('/').map(encodeURIComponent).join('/')}/`
}

export function capabilityTags(model: PriceModel): string[] {
  const tags: string[] = []
  if (model.inputModalities?.includes('image')) tags.push('Vision')
  if (model.inputModalities?.includes('audio')) tags.push('Audio')
  if (model.outputModalities?.includes('audio')) tags.push('Audio output')
  if (model.inputModalities?.includes('video')) tags.push('Video')
  if (model.supportsReasoning) tags.push('Reasoning')
  if (model.supportsTools) tags.push('Tool calling')
  if (model.supportsStructuredOutput) tags.push('Structured output')
  if (model.releaseStage === 'preview') tags.push('Preview')
  if (model.releaseStage === 'experimental') tags.push('Experimental')
  return tags
}

export function modalityList(values?: string[]): string {
  if (!values?.length) return 'Not specified'
  return values.map((value) => value.charAt(0).toUpperCase() + value.slice(1)).join(', ')
}
