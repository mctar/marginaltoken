import { useEffect, useState } from 'react'
import Footer from './components/Footer'
import Header from './components/Header'
import SourceWatch from './components/SourceWatch'
import { loadFeed } from './lib/data'
import type { FeedData } from './lib/types'
import OpenPage from './pages/OpenPage'
import FrontPage from './pages/FrontPage'
import ComparePage from './pages/ComparePage'
import InfrastructurePage from './pages/InfrastructurePage'
import MethodologyPage from './pages/MethodologyPage'
import ModelPage, { MissingModelPage } from './pages/ModelPage'
import SpreadsPage from './pages/SpreadsPage'
import TapePage from './pages/TapePage'
import NotesPage from './pages/NotesPage'
import PlanPage from './pages/PlanPage'
import { marketNotes } from './lib/market-notes'

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: FeedData }

type Route = '/' | '/tape/' | '/spreads/' | '/compare/' | '/infrastructure/' | '/methodology/' | '/model/' | '/open/' | '/notes/' | '/plan/'

function routeFor(pathname: string): Route {
  const normalized = pathname.endsWith('/') ? pathname : `${pathname}/`
  if (normalized === '/open/') return '/open/'
  if (normalized === '/plan/') return '/plan/'
  if (normalized === '/tape/') return '/tape/'
  if (normalized === '/spreads/') return '/spreads/'
  if (normalized === '/compare/') return '/compare/'
  if (normalized === '/infrastructure/') return '/infrastructure/'
  if (normalized === '/methodology/') return '/methodology/'
  if (normalized.startsWith('/notes/')) return '/notes/'
  if (normalized.startsWith('/model/')) return '/model/'
  return '/'
}

function modelKeyFor(pathname: string): string | null {
  const match = pathname.match(/^\/model\/(.+?)\/?$/)
  if (!match) return null
  try {
    return match[1].split('/').map(decodeURIComponent).join('/')
  } catch {
    return null
  }
}

export default function App() {
  const [state, setState] = useState<State>({ status: 'loading' })
  const route = routeFor(window.location.pathname)
  const modelKey = route === '/model/' ? modelKeyFor(window.location.pathname) : null

  useEffect(() => {
    if (route === '/notes/') return
    loadFeed(
      route === '/model/' || route === '/spreads/' || route === '/infrastructure/' || route === '/compare/' || route === '/plan/',
      route === '/infrastructure/',
    )
      .then((data) => setState({ status: 'ready', data }))
      .catch((error: unknown) => setState({ status: 'error', message: error instanceof Error ? error.message : String(error) }))
  }, [route])

  if (route === '/notes/') {
    return (
      <div className="min-h-screen">
        <a className="skip-link" href="#main">Skip to content</a>
        <Header asOf={marketNotes[0]?.date ?? ''} route={route} dateline="Market notes · Evidence and implications" />
        <NotesPage pathname={window.location.pathname} />
        <Footer />
      </div>
    )
  }

  if (state.status === 'loading') {
    return <div className="loading-page">Reading the tape.</div>
  }
  if (state.status === 'error') {
    return (
      <div className="loading-page error-page">
        <strong>The price file could not be read.</strong>
        <span>{state.message}</span>
      </div>
    )
  }

  const { data } = state
  const model = modelKey ? data.prices.models.find((candidate) => candidate.key === modelKey) : null
  const offerModel = modelKey ? data.offers?.models.find((candidate) => candidate.key === modelKey) ?? null : null
  return (
    <div className="min-h-screen">
      <a className="skip-link" href="#main">Skip to content</a>
      <Header asOf={data.meta.asOf} route={route} />
      <SourceWatch provenance={data.provenance} />
      {route === '/tape/' && <TapePage prices={data.prices} decisions={data.decisions ?? null} />}
      {route === '/open/' && <OpenPage prices={data.prices} decisions={data.decisions ?? null} />}
      {route === '/spreads/' && <SpreadsPage prices={data.prices} offers={data.offers} />}
      {route === '/compare/' && <ComparePage prices={data.prices} meta={data.meta} decisions={data.decisions ?? null} offers={data.offers} />}
      {route === '/plan/' && <PlanPage data={data} />}
      {route === '/infrastructure/' && (
        <InfrastructurePage prices={data.prices} offers={data.offers} deployment={data.deployment} meta={data.meta} />
      )}
      {route === '/methodology/' && <MethodologyPage meta={data.meta} provenance={data.provenance} />}
      {route === '/model/' && (model ? (
        <ModelPage
          model={model}
          decision={data.decisions?.models.find((row) => row.key === model.key)}
          models={data.prices.models}
          asOf={data.meta.asOf}
          offerModel={offerModel}
          offersAsOf={data.offers?.asOf ?? null}
        />
      ) : <MissingModelPage />)}
      {route === '/' && <FrontPage data={data} />}
      <Footer generatedAt={data.meta.generatedAt} modelCount={data.meta.modelCount} />
    </div>
  )
}
