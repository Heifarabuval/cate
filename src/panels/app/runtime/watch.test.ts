import { expect, it, vi } from 'vitest'
import { watchFolder } from './watch'

const unsubscribe = vi.fn<() => Promise<void>>()
vi.mock('@parcel/watcher', () => ({ default: { subscribe: async () => ({ unsubscribe }) } }))

const unwatchFailingWith = async (error: Error): Promise<void> => {
  unsubscribe.mockRejectedValueOnce(error)
  const unwatch = await watchFolder('/dossier', () => {})
  await unwatch()
}

it('tolerates an unwatch whose folder is already gone', async () => {
  // inotify on Linux (CI): the watch died with the folder.
  await expect(unwatchFailingWith(new Error('Unable to remove watcher: Invalid argument'))).resolves.toBeUndefined()
  await expect(unwatchFailingWith(Object.assign(new Error('gone'), { code: 'ENOENT' }))).resolves.toBeUndefined()
})

it('rethrows any other unwatch failure', async () => {
  await expect(unwatchFailingWith(Object.assign(new Error('denied'), { code: 'EACCES' }))).rejects.toThrow('denied')
})
