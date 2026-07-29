const providerNames: Record<string, string> = {
  'x-ai': 'xAI',
  mistralai: 'Mistral',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  deepseek: 'DeepSeek',
}

export function providerName(provider: string): string {
  return providerNames[provider] ?? provider.replace(/(^|-)([a-z])/g, (_, gap, letter) => `${gap}${letter.toUpperCase()}`)
}

export function longDate(date: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`))
}

export function shortDate(date: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`))
}

export function price(value: number): string {
  const decimals = value < 0.01 ? 4 : value < 1 ? 3 : 2
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: 4,
  })}`
}

export function contextSize(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 ? 2 : 0)}m`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return value.toLocaleString('en-US')
}
