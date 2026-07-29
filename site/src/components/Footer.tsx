type FooterProps = {
  generatedAt: string
  modelCount: number
}

function displayTimestamp(value: string): string {
  return value.endsWith('Z') ? `${value.slice(0, -1)}+00:00` : value
}

export default function Footer({ generatedAt, modelCount }: FooterProps) {
  const timestamp = displayTimestamp(generatedAt)

  return (
    <footer className="mt-20 border-t-2 border-ink">
      <div className="mx-auto max-w-publication px-4 py-8 text-xs text-ink-muted sm:px-6">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>
            Generated <time dateTime={generatedAt}>{timestamp}</time>
          </span>
          <span aria-hidden="true">·</span>
          <span>{modelCount} {modelCount === 1 ? 'model' : 'models'} tracked</span>
          <span aria-hidden="true">·</span>
          <a className="editorial-link" href="https://marginaltoken.com">
            marginaltoken.com
          </a>
        </p>
        <p className="mt-3">
          A poka-yoke build by{' '}
          <a className="editorial-link" href="https://gervilabs.com/">
            Gervi Labs
          </a>
        </p>
      </div>
    </footer>
  )
}
