// The desktop renderer entry: boots the client for this window, then renders.

import './splash'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from '../ui/kernel/interaction'
import { createLogger } from '@kernel/log/contract'
import type { BrowserPageBridge } from '@services/browser/contract'
import { App, BootFailed } from './App'
import { bootDesktopClient, initRendererSentry } from './boot'
import './styles/globals.css'
import '@xterm/xterm/css/xterm.css'

declare global {
  interface Window {
    cateBrowserPage?: BrowserPageBridge
  }
}

const log = createLogger('renderer')
performance.mark('renderer-script-start')

const reportError = initRendererSentry()
// Log only a message, a name or a stack: a DOM Event serializes as `{ isTrusted: true }`,
// and any other object may carry user content.
const describeThrown = (value: unknown) => value instanceof Event ? `${value.type} event on ${value.target?.constructor.name ?? 'unknown target'}`
  : value instanceof Error || typeof value === 'string' || value == null ? value : `non-error ${typeof value} (${(value as object).constructor?.name ?? 'unknown'})`
window.addEventListener('error', (e) => {
  if (e instanceof ErrorEvent) log.error('Uncaught error: %s (%s:%d)', describeThrown(e.error) ?? e.message, e.filename, e.lineno)
})
window.addEventListener('unhandledrejection', (e) => {
  log.error('Unhandled promise rejection: %s', describeThrown(e.reason))
})

const root = createRoot(document.getElementById('root')!)
bootDesktopClient(window.cateDesktop, { pageBridge: window.cateBrowserPage, reportError }).then(
  (client) => {
    root.render(
      <StrictMode>
        <ErrorBoundary
          source="RootErrorBoundary"
          reportContext={{}}
          logError={(error, info) => log.error('React render error: %s %s', error.message, info.componentStack)}
          fallback={(error) => <BootFailed error={error} />}
        >
          <App client={client} />
        </ErrorBoundary>
      </StrictMode>,
    )
  },
  (error: unknown) => {
    log.error('boot failed: %s', error)
    reportError(error, { source: 'boot' })
    root.render(<BootFailed error={error} />)
  },
)
