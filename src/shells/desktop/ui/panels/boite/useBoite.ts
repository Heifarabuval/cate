import { useMemo, useSyncExternalStore } from 'react'
import { createBoiteStore, type BoiteSnapshot } from '@client/boite'
import { documentStoreFor, subscribeDocumentStores } from '@client/document'
import { clientApp } from '../../app/app'

/** What the inbox shows now: the agence panels of every workspace this client
 *  has open. The store reads their sessions while a view is mounted. */
export function useBoite(): BoiteSnapshot {
  const { connections, workspaces } = clientApp()
  const store = useMemo(
    () => createBoiteStore({ connections, documents: { get: documentStoreFor, subscribe: subscribeDocumentStores }, workspaces }),
    [connections, workspaces],
  )
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
