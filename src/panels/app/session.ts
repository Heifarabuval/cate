// The runtime session of an app panel: one custom panel shown on the canvas
// (spec 008). It holds no page state of its own. It decides from the scanner
// (the folder), the grants (what the user accepted) and the workspace trust
// whether the page may run, publishes the URL of the page when it may, and
// reloads it when the folder changes. Records are state, never commands: a
// deleted folder leaves the panel `missing`, nothing is killed.

import { RpcError, type ClientFeature } from '@kernel/rpc/contract'
import type { PanelRecord } from '@workspace/document/contract'
import { PanelSession, type DisposeReason, type OpContext, type SessionKit } from '@panels/framework/runtime'
import { grantSentence, grantStatus, manifestFingerprint, type AppManifest, type AppOp, type AppSnapshot, type Hash } from './contract'
import type { AppGrants } from './runtime/grants'
import type { AppScanner } from './runtime/scan'
import type { AppServer } from './runtime/server'

export interface AppSessionDeps {
  scanner: Pick<AppScanner, 'manifest' | 'list' | 'subscribe' | 'onPage' | 'ready'>
  grants: Pick<AppGrants, 'get' | 'grant' | 'revoke'>
  server: Pick<AppServer, 'urlFor'>
  trust: { isTrusted(): boolean; onChange(listener: (state: { trusted: boolean }) => void): () => void }
  /** Whether the client behind an op has the feature (`null`: the runtime itself). */
  clientHas(connectionId: number | null, feature: ClientFeature): boolean
  hash: Hash
}

const idle = (appId: string): AppSnapshot => ({ appId, name: null, state: 'missing', url: null, sentence: null, message: null, reload: 0 })

export class AppSession extends PanelSession<AppSnapshot, AppOp> {
  private readonly offs: Array<() => void> = []
  private work: Promise<void> = Promise.resolve()

  constructor(kit: SessionKit, record: PanelRecord, private readonly deps: AppSessionDeps) {
    super(kit, record, idle(typeof record.fields.appId === 'string' ? record.fields.appId : ''))
    this.ops.grant = (_op, ctx) => this.grant(ctx)
    this.ops.refuse = (_op, ctx) => this.refuse(ctx)
    this.ops.reload = () => this.reload()
  }

  private get appId(): string {
    return this.state.appId
  }

  override start(): Promise<void> {
    const { scanner, trust } = this.deps
    this.offs.push(
      scanner.subscribe(() => this.refresh()),
      trust.onChange(() => this.refresh()),
      scanner.onPage((id) => {
        if (id === this.appId) this.refresh({ pageChanged: true })
      })
    )
    return this.deps.scanner.ready().then(() => this.refresh())
  }

  /** Waits for the decisions in flight (tests). */
  idle(): Promise<void> {
    return this.work
  }

  protected override release(_reason: DisposeReason): void {
    for (const off of this.offs.splice(0)) off()
  }

  private refresh(options: { pageChanged?: boolean } = {}): Promise<void> {
    return (this.work = this.work.then(() => this.decide(options)).catch((error) => this.kit.log.warn('app panel %s: %O', this.appId, error)))
  }

  private statusOf(manifest: AppManifest) {
    return grantStatus(this.deps.grants.get(this.appId), { manifestFingerprint: manifestFingerprint(manifest, this.deps.hash) })
  }

  private async decide({ pageChanged = false }: { pageChanged?: boolean }): Promise<void> {
    if (this.disposed) return
    const { scanner, trust } = this.deps
    if (!trust.isTrusted()) {
      return this.publish({ name: null, state: 'blocked', url: null, sentence: null, message: 'Workspace non approuvé : les panneaux perso ne se chargent pas.' })
    }
    const entry = scanner.list().find((item) => item.id === this.appId)
    if (!entry) {
      return this.publish({ name: null, state: 'missing', url: null, sentence: null, message: 'Panneau perso introuvable' })
    }
    const manifest = scanner.manifest(this.appId)
    if (!manifest) {
      return this.publish({ name: null, state: 'error', url: null, sentence: null, message: entry.status === 'error' ? entry.error : null })
    }
    // A broken edit keeps the last valid manifest: the page runs on, the error shows.
    const message = entry.status === 'error' ? entry.error : null
    if (this.statusOf(manifest) !== 'ok') {
      return this.publish({ name: manifest.name, state: 'needs-grant', url: null, sentence: grantSentence(manifest), message })
    }
    const url = await this.deps.server.urlFor(this.appId, manifest.entry)
    const reload = pageChanged && this.state.state === 'running' ? this.state.reload + 1 : this.state.reload
    this.publish({ name: manifest.name, state: 'running', url, sentence: null, message, reload })
  }

  private requireWebview(ctx: OpContext): void {
    if (!this.deps.clientHas(ctx.connectionId, 'webview')) throw new RpcError('rejected', 'ce client ne peut pas afficher un panneau perso (fonctionnalité webview absente)')
  }

  private async grant(ctx: OpContext): Promise<void> {
    this.requireWebview(ctx)
    if (!this.deps.trust.isTrusted()) throw new RpcError('rejected', 'workspace non approuvé : le panneau perso ne peut pas être autorisé')
    const manifest = this.deps.scanner.manifest(this.appId)
    if (!manifest) throw new RpcError('rejected', `panneau perso « ${this.appId} » indisponible`)
    this.deps.grants.grant({
      appId: this.appId,
      source: 'local',
      manifestFingerprint: manifestFingerprint(manifest, this.deps.hash),
      accepted: manifest.permissions,
      at: new Date().toISOString()
    })
    await this.refresh()
  }

  private async refuse(ctx: OpContext): Promise<void> {
    this.requireWebview(ctx)
    this.deps.grants.revoke(this.appId)
    await this.refresh()
  }

  private reload(): void {
    if (this.state.state === 'running') this.publish({ reload: this.state.reload + 1 })
  }
}
