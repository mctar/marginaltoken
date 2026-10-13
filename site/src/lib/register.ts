import register from '../../../collector/model-register.json' with { type: 'json' }
export type ModelRecord = { provider: string; family: string; order: number; aliases: string[]; apiId?: string; approved: boolean; stage?: string; display?: string; lifecycle?: { status: string; date: string; successor?: string; detail?: string; sourceUrl: string }; events?: { date: string; kind: string; label: string; sourceUrl: string }[] }
export const modelRegister = register.models as Record<string,ModelRecord>
export function canonicalModelKey(value: string): string {
  if (modelRegister[value]) return value
  const candidates = Object.entries(modelRegister).filter(([,r]) => r.aliases.includes(value) || r.apiId === value)
  return candidates.length === 1 ? candidates[0][0] : value
}
