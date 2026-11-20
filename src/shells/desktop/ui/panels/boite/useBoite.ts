import { useMemo, useSyncExternalStore } from 'react'
import { createBoiteActions, createBoiteStore, type ActionsState, type BoiteActions, type BoiteSnapshot } from '@client/boite'
import { documentStoreFor, subscribeDocumentStores } from '@client/document'
import { clientApp } from '../../app/app'

/** What the inbox shows now: the agence panels of every workspace this client
 *  has open, and the actions on their lines. The store reads their sessions
 *  while a view is mounted. */
export function useBoite(): BoiteSnapshot & { actions: BoiteActions; actionsState: ActionsState } {
  const { connections, workspaces } = clientApp()
  const { store, actions } = useMemo(() => {
    const store = createBoiteStore({ connections, documents: { get: documentStoreFor, subscribe: subscribeDocumentStores }, workspaces })
    return { store, actions: createBoiteActions(store) }
  }, [connections, workspaces])
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const actionsState = useSyncExternalStore(actions.subscribe, actions.getState)
  return { ...snapshot, actions, actionsState }
}
