import { lazy, useEffect, useState } from 'react'
import ExplorePage from './pages/ExplorePage'
import UnderstandPage from './pages/UnderstandPage'
import CostsPage from './pages/CostsPage'
import FrontLedger from './components/FrontLedger'
import Footer from './components/Footer'
import Header from './components/Header'
import SourceWatch from './components/SourceWatch'
import { loadFeed } from './lib/data'
import type { FeedData } from './lib/types'
import OpenPage from './pages/OpenPage'
import FrontPage from './pages/FrontPage'
import MethodologyPage from './pages/MethodologyPage'
import ModelPage, { MissingModelPage } from './pages/ModelPage'
import TapePage from './pages/TapePage'
import NotesPage from './pages/NotesPage'
import { canonicalModelKey } from './lib/register'
import { marketNotes } from './lib/market-notes'

const ComparePage = lazy(() => import('./pages/ComparePage'))
const InfrastructurePage = lazy(() => import('./pages/InfrastructurePage'))
const SpreadsPage = lazy(() => import('./pages/SpreadsPage'))
const PlanPage = lazy(() => import('./pages/PlanPage'))
const WatchPage = lazy(() => import('./pages/WatchPage'))

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: FeedData }

type Route = '/explore/' | '/understand/' | '/costs/' | '/ledger/' | '/' | '/tape/' | '/spreads/' | '/compare/' | '/infrastructure/' | '/methodology/' | '/model/' | '/open/' | '/notes/' | '/plan/' | '/watch/'

function routeFor(pathname: string): Route {
  const normalized = pathname.endsWith('/') ? pathname : `${pathname}/`
  if (normalized === '/explore/' || normalized === '/understand/' || normalized === '/costs/' || normalized === '/ledger/') return normalized
  if (normalized === '/open/') return '/open/'
  if (normalized === '/plan/') return '/plan/'
  if (normalized === '/watch/') return '/watch/'
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
    return canonicalModelKey(match[1].split('/').map(decodeURIComponent).join('/'))
  } catch {
    return null
  }
}

export default function App() {
  const [state, setState] = useState<State>({ status: 'loading' })
  const route = routeFor(window.location.pathname)
  const modelKey = route === '/model/' ? modelKeyFor(window.location.pathname) : null

  useEffect(() => {
    if (route === '/notes/' || route === '/explore/' || route === '/understand/') return
    loadFeed(
      route === '/model/' || route === '/spreads/' || route === '/infrastructure/' || route === '/compare/' || route === '/plan/' || route === '/watch/',
      route === '/infrastructure/',
    )
      .then((data) => setState({ status: 'ready', data }))
      .catch((error: unknown) => setState({ status: 'error', message: error instanceof Error ? error.message : String(error) }))
  }, [route])

  if (route === '/explore/' || route === '/understand/' || route === '/costs/') {
    return <div className="min-h-screen"><a className="skip-link" href="#main">Skip to content</a>
      <Header route={route} asOf="" dateline="An independent guide to the model market" />
      {route === '/explore/' && <ExplorePage />}
      {route === '/understand/' && <UnderstandPage />}
      {route === '/costs/' && <CostsPage prices={state.status === 'ready' ? state.data.prices : undefined} error={state.status === 'error' ? state.message : undefined} />}
      <Footer /></div>
  }
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

  // Editorial and tool discovery remain usable while the independent feed loads.
  if (route === '/') {
    const data = state.status === 'ready' ? state.data : undefined
    return <div className="min-h-screen">
      <a className="skip-link" href="#main">Skip to content</a>
      <Header asOf={data?.meta.asOf ?? ''} route={route} dateline="AI prices, releases & the cost of running them" />
      <FrontPage data={data} feedError={state.status === 'error' ? state.message : undefined} />
      <Footer generatedAt={data?.meta.generatedAt} modelCount={data?.meta.modelCount} />
    </div>
  }

  if (state.status === 'loading') {
    return <div className="loading-page">Reading the tape.</div>
  }
  if (state.status === 'error') {
    return (
      <div className="loading-page error-page">
        <strong>The price file could not be read.</strong>
        <span>{state.message}</span><a href={window.location.href}>Reload prices</a><a href="/explore/">Browse reviewed models</a>
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
      {route === '/tape/' && (data.provenance?.degradedProviderCount ?? 0) > 0 && <SourceWatch provenance={data.provenance} />}
      {route === '/ledger/' && <main id="main" className="mx-auto max-w-publication px-4 sm:px-6"><FrontLedger data={data} /></main>}
      {route === '/tape/' && <TapePage prices={data.prices} decisions={data.decisions ?? null} />}
      {route === '/open/' && <OpenPage prices={data.prices} decisions={data.decisions ?? null} />}
      {route === '/spreads/' && <SpreadsPage prices={data.prices} offers={data.offers} />}
      {route === '/compare/' && <ComparePage prices={data.prices} meta={data.meta} decisions={data.decisions ?? null} offers={data.offers} />}
      {route === '/plan/' && <PlanPage data={data} />}
      {route === '/watch/' && <WatchPage data={data} />}
      {route === '/infrastructure/' && (
        <InfrastructurePage decisions={data.decisions ?? null} prices={data.prices} offers={data.offers} deployment={data.deployment} meta={data.meta} />
      )}
      {route === '/methodology/' && <MethodologyPage meta={data.meta} provenance={data.provenance} />}
      {route === '/model/' && (model ? (
        <ModelPage
          model={model}
          history={data.history}
          changes={data.changes}
          decision={data.decisions?.models.find((row) => row.key === model.key)}
          models={data.prices.models}
          asOf={data.meta.asOf}
          offerModel={offerModel}
          offersAsOf={data.offers?.asOf ?? null}
        />
      ) : <MissingModelPage modelKey={modelKey} history={data.history} changes={data.changes} asOf={data.prices.asOf}/>)}
      <Footer generatedAt={data.meta.generatedAt} modelCount={data.meta.modelCount} />
    </div>
  )
}
