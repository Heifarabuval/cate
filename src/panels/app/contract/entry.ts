// One row of the list of custom panels the runtime publishes (`apps.list`).

import type { IconName } from '@kernel/interaction/contract'

export type AppEntry =
  | {
      id: string
      status: 'ready'
      name: string
      description: string
      icon: IconName
      size: { width: number; height: number }
      warnings: string[]
      source: 'local' | 'installed'
    }
  | {
      id: string
      status: 'error'
      /** One sentence: what to fix in the folder. */
      error: string
      warnings: string[]
    }
  | {
      /** The workspace is not trusted: no panel loads. */
      id: string
      status: 'blocked'
      warnings: string[]
    }
