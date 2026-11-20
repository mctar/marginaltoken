import { longDate } from '../lib/format'

type HeaderProps = {
  asOf: string
  route: string
  dateline?: string
}

const navigation = [
  { href: '/', label: 'This week', sections: ['/', '/notes/'] },
  { href: '/explore/', label: 'Explore models', sections: ['/explore/', '/model/', '/open/', '/tape/', '/ledger/'] },
  { href: '/understand/', label: 'Understand', sections: ['/understand/'] },
  { href: '/costs/', label: 'Compare costs', sections: ['/costs/', '/compare/', '/infrastructure/', '/plan/', '/spreads/', '/watch/'] },
  { href: '/methodology/', label: 'About & sources', sections: ['/methodology/'] },
]

export default function Header({ asOf, route, dateline }: HeaderProps) {
  return (
    <header className="publication-header">
      <div className="mx-auto max-w-publication px-4 sm:px-6">
        <div className="masthead-rule">
          <a className="masthead" href="/" aria-label="The Marginal Token front page">
            The Marginal Token
          </a>
        </div>
        {!dateline && asOf && <p className="dateline">Price file as of {longDate(asOf)}</p>}
        <nav className="section-nav" aria-label="Primary navigation">
          {navigation.map((item) => {
            const active = item.sections.includes(route)
            return (
              <a key={item.href} href={item.href} aria-current={active ? (item.href === route ? 'page' : 'location') : undefined}>
                {item.label}
              </a>
            )
          })}
        </nav>
      </div>
    </header>
  )
}
