// What the user accepted for each custom panel of a workspace: one file in the
// workspace's data folder, one writer (this module, FR-017). Never inside
// `~/.cate/panneaux/`, which a third party controls. The path scope's
// `grants.json` is another file and is not touched.

import path from 'node:path'
import { createJsonStateFile } from '@kernel/state/node'
import { pathHasPrefix, pathKey } from '@workspace/files/contract'
import type { AppGrant } from '../contract'

interface GrantsFile {
  grants: Record<string, AppGrant>
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function isGrant(value: unknown): value is AppGrant {
  return (
    isObject(value) &&
    typeof value.appId === 'string' &&
    (value.source === 'local' || value.source === 'installed') &&
    typeof value.manifestFingerprint === 'string' &&
    isObject(value.accepted) &&
    typeof value.at === 'string' &&
    (value.files === undefined || (Array.isArray(value.files) && value.files.every((file) => isObject(file) && typeof file.path === 'string' && typeof file.sha256 === 'string')))
  )
}

function normalize(parsed: unknown): GrantsFile {
  const grants: Record<string, AppGrant> = {}
  const raw = isObject(parsed) && isObject(parsed.grants) ? parsed.grants : {}
  for (const [id, value] of Object.entries(raw)) if (isGrant(value) && value.appId === id) grants[id] = value
  return { grants }
}

export interface AppGrants {
  get(appId: string): AppGrant | undefined
  grant(grant: AppGrant): void
  revoke(appId: string): void
  flush(): Promise<void>
  dispose(): void
}

export interface AppGrantsDeps {
  /** `<data>/app-grants.json`. */
  file: string
  /** `~/.cate/panneaux`: the file must not live in it. */
  panneauxDir: string
}

export function createAppGrants(deps: AppGrantsDeps): AppGrants {
  if (pathHasPrefix(pathKey(path.resolve(deps.file)), pathKey(path.resolve(deps.panneauxDir)))) {
    throw new Error(`app grants cannot live in the panneaux folder: ${deps.file}`)
  }
  const state = createJsonStateFile<GrantsFile>({ file: deps.file, defaults: { grants: {} }, normalize })
  return {
    get: (appId) => state.get().grants[appId],
    grant: (grant) => state.update((current) => ({ grants: { ...current.grants, [grant.appId]: grant } })),
    revoke: (appId) =>
      state.update((current) => {
        const { [appId]: _removed, ...rest } = current.grants
        return { grants: rest }
      }),
    flush: () => state.flushDurable(),
    dispose: () => state.dispose()
  }
}
