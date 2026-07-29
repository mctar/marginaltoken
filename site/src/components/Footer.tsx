export default function Footer() {
  return (
    <footer className="mt-20 border-t-2 border-ink">
      <div className="mx-auto flex max-w-publication flex-col gap-3 px-4 py-8 text-xs text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          A sibling publication of{' '}
          <a className="editorial-link" href="https://saaspocalyptics.btrbot.com">
            SaaSpocalyptics
          </a>
        </p>
        <p className="flex gap-5">
          <a className="editorial-link" href="/data/prices.json">
            Open data
          </a>
          <span>Not investment advice</span>
        </p>
      </div>
    </footer>
  )
}
