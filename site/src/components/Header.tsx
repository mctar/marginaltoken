import { longDate } from '../lib/format'

type HeaderProps = {
  asOf: string
  route: string
}

const navigation = [
  { href: '/', label: 'Front' },
  { href: '/tape/', label: 'The Tape' },
  { href: '/spreads/', label: 'Spreads' },
  { href: '/compare/', label: 'Compare' },
  { href: '/infrastructure/', label: 'Rent vs Run' },
  { href: '/methodology/', label: 'Methodology' },
]

export default function Header({ asOf, route }: HeaderProps) {
  return (
    <header className="publication-header">
      <div className="mx-auto max-w-publication px-4 sm:px-6">
        <div className="edition-line">
          <span>Price of intelligence</span>
          <span className="hidden sm:inline">Independent open data</span>
        </div>
        <div className="masthead-rule">
          <a className="masthead" href="/" aria-label="The Marginal Token front page">
            The Marginal Token
          </a>
        </div>
        <p className="dateline">Price file as of {longDate(asOf)}</p>
        <nav className="section-nav" aria-label="Primary navigation">
          {navigation.map((item) => {
            const active = item.href === route
            return (
              <a key={item.href} href={item.href} aria-current={active ? 'page' : undefined}>
                {item.label}
              </a>
            )
          })}
        </nav>
      </div>
    </header>
  )
}
