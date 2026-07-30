import { useEffect, useState } from 'react'
import Footer from './components/Footer'
import Header from './components/Header'
import { loadFeed } from './lib/data'
import type { FeedData } from './lib/types'
import FrontPage from './pages/FrontPage'
import MethodologyPage from './pages/MethodologyPage'
import ModelPage, { MissingModelPage } from './pages/ModelPage'
import TapePage from './pages/TapePage'

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: FeedData }

type Route = '/' | '/tape/' | '/methodology/' | '/model/'

function routeFor(pathname: string): Route {
  const normalized = pathname.endsWith('/') ? pathname : `${pathname}/`
  if (normalized === '/tape/') return '/tape/'
  if (normalized === '/methodology/') return '/methodology/'
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
    loadFeed()
      .then((data) => setState({ status: 'ready', data }))
      .catch((error: unknown) => setState({ status: 'error', message: error instanceof Error ? error.message : String(error) }))
  }, [])

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
  return (
    <div className="min-h-screen">
      <a className="skip-link" href="#main">Skip to content</a>
      <Header asOf={data.meta.asOf} route={route} />
      {route === '/tape/' && <TapePage prices={data.prices} />}
      {route === '/methodology/' && <MethodologyPage meta={data.meta} />}
      {route === '/model/' && (model ? <ModelPage model={model} asOf={data.meta.asOf} /> : <MissingModelPage />)}
      {route === '/' && <FrontPage data={data} />}
      <Footer generatedAt={data.meta.generatedAt} modelCount={data.meta.modelCount} />
    </div>
  )
}
