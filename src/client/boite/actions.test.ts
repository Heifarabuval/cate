import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgenceOp } from '@panels/agence/contract'
import { createBoiteActions } from './actions'
import type { Ligne, LigneAction } from './types'

const ligne = (key: string, action: LigneAction, extra: Partial<Ligne> = {}): Ligne => ({
  key, workspaceId: 'w1', panelId: 'p1', root: key.split('#')[0], repo: 'cate', needId: key.split('#')[1], title: key,
  blocking: false, waitingSince: '2026-11-19T10:00:00Z', action, links: [], ...extra,
})
const question = (isMerge = false): LigneAction => ({ type: 'question', questionId: 'q1', options: [{ label: 'Merger', detail: '' }, { label: 'Non', detail: '' }], isMerge })
const draft = (hash = 'h1', extra: Partial<Extract<LigneAction, { type: 'draft' }>> = {}): LigneAction => ({ type: 'draft', draftId: 'd1', kind: 'slack', hash, texte: 'Salut', inFlight: false, ...extra })
const perm: LigneAction = { type: 'perm', command: 'rm -rf build', reason: 'nettoyage', genre: 'hook' }

/** A store the test drives: rows, and the ops it would relay. */
function fakeStore(initial: Ligne[]) {
  let rows = initial
  const listeners = new Set<() => void>()
  const sent: Array<{ workspaceId: string; panelId: string; op: AgenceOp }> = []
  let reply: (op: AgenceOp) => Promise<unknown> | null = async () => ({ ok: true })
  return {
    store: {
      getSnapshot: () => ({ projects: [], rows, closedWorkspaces: 0 }),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      send(workspaceId: string, panelId: string, op: AgenceOp) {
        sent.push({ workspaceId, panelId, op })
        return reply(op)
      },
    },
    sent,
    set(next: Ligne[]) { rows = next; for (const listener of [...listeners]) listener() },
    reply(next: typeof reply) { reply = next },
  }
}

let fake: ReturnType<typeof fakeStore>
const start = (rows: Ligne[]) => {
  fake = fakeStore(rows)
  const actions = createBoiteActions(fake.store)
  actions.subscribe(() => {})
  return actions
}

describe('answer', () => {
  beforeEach(() => { start([]) })

  it("sends the answer to the session of the line's own project, never another", async () => {
    const actions = start([
      ligne('/a/cate#n1', question()),
      ligne('/a/lamif#n2', question(), { workspaceId: 'w2', panelId: 'p2' }),
    ])
    await expect(actions.answer('/a/lamif#n2', { choice: 1 })).resolves.toEqual({ ok: true })
    expect(fake.sent).toEqual([{ workspaceId: 'w2', panelId: 'p2', op: { kind: 'answer', questionId: 'q1', choice: 1 } }])
  })

  it('lets the free answer win over a choice: only the text goes', async () => {
    const actions = start([ligne('/a/cate#n1', question())])
    await actions.answer('/a/cate#n1', { choice: 0, libre: 'plus tard' })
    expect(fake.sent.map((call) => call.op)).toEqual([{ kind: 'answer', questionId: 'q1', libre: 'plus tard' }])
  })

  it('renders « déjà répondue » as a conflict with its message, and the line leaves with the next snapshot', async () => {
    const actions = start([ligne('/a/cate#n1', question())])
    fake.reply(async () => ({ ok: false, error: 'conflict', message: 'Question déjà répondue.' }))
    await expect(actions.answer('/a/cate#n1', { choice: 0 })).resolves.toEqual({ ok: false, error: 'conflict', message: 'Question déjà répondue.' })
    expect(actions.getState().notices['/a/cate#n1']).toBe('Question déjà répondue.')
    fake.set([])
    expect(actions.getState().notices).toEqual({})
  })

  it('refuses a second call while the first runs: busy, one send only', async () => {
    const actions = start([ligne('/a/cate#n1', question())])
    let release!: () => void
    fake.reply(() => new Promise((resolve) => { release = () => resolve({ ok: true }) }))
    const first = actions.answer('/a/cate#n1', { choice: 0 })
    expect(actions.getState().busy.has('/a/cate#n1')).toBe(true)
    await expect(actions.answer('/a/cate#n1', { choice: 1 })).resolves.toEqual({ ok: false, error: 'busy' })
    release()
    await expect(first).resolves.toEqual({ ok: true })
    expect(fake.sent).toHaveLength(1)
  })

  it('keeps a line busy after an accepted answer until it leaves, so a double click cannot send twice', async () => {
    const actions = start([ligne('/a/cate#n1', question())])
    await actions.answer('/a/cate#n1', { choice: 0 })
    await expect(actions.answer('/a/cate#n1', { choice: 0 })).resolves.toEqual({ ok: false, error: 'busy' })
    fake.set([])
    expect(actions.getState().busy.size).toBe(0)
  })

  it('frees the line after a refusal, so the human can try again', async () => {
    const actions = start([ligne('/a/cate#n1', question())])
    fake.reply(async () => ({ ok: false, error: 'conflict', message: 'non' }))
    await actions.answer('/a/cate#n1', { choice: 0 })
    fake.reply(async () => ({ ok: true }))
    await expect(actions.answer('/a/cate#n1', { choice: 0 })).resolves.toEqual({ ok: true })
    expect(actions.getState().notices).toEqual({})
  })

  it('is unavailable when the workspace closed in between (no session to reach) or the line is gone', async () => {
    const actions = start([ligne('/a/cate#n1', question())])
    fake.reply(() => null)
    await expect(actions.answer('/a/cate#n1', { choice: 0 })).resolves.toMatchObject({ ok: false, error: 'unavailable' })
    await expect(actions.answer('/a/gone#n9', { choice: 0 })).resolves.toMatchObject({ ok: false, error: 'unavailable' })
    expect(actions.getState().busy.size).toBe(0)
  })

  it('is unavailable when the session rejects (the connection dropped)', async () => {
    const actions = start([ligne('/a/cate#n1', question())])
    fake.reply(async () => { throw new Error('closed') })
    await expect(actions.answer('/a/cate#n1', { choice: 0 })).resolves.toMatchObject({ ok: false, error: 'unavailable' })
  })

  it('answers invalid for a line that is not a question, sending nothing', async () => {
    const actions = start([ligne('/a/cate#n1', draft())])
    await expect(actions.answer('/a/cate#n1', { choice: 0 })).resolves.toMatchObject({ ok: false, error: 'invalid' })
    expect(fake.sent).toEqual([])
  })

  it('Merger is the first option of a merge question, and shows the refusal « not mergeable »', async () => {
    const actions = start([ligne('/a/cate#n1', question(true)), ligne('/a/cate#n2', question(false))])
    fake.reply(async () => ({ ok: false, error: 'conflict', message: 'not mergeable' }))
    await expect(actions.merge('/a/cate#n1')).resolves.toMatchObject({ ok: false, error: 'conflict' })
    expect(fake.sent.map((call) => call.op)).toEqual([{ kind: 'answer', questionId: 'q1', choice: 0 }])
    expect(actions.getState().notices['/a/cate#n1']).toBe('not mergeable')
    await expect(actions.merge('/a/cate#n2')).resolves.toMatchObject({ ok: false, error: 'invalid' })
    expect(fake.sent).toHaveLength(1)
  })
})

describe('show and send', () => {
  it('show returns the snapshot text and notes the hash it showed', () => {
    const actions = start([ligne('/a/cate#n1', draft('h1'))])
    expect(actions.show('/a/cate#n1')).toEqual({ ok: true, texte: 'Salut' })
    expect(actions.getState().shown).toEqual({ '/a/cate#n1': 'h1' })
    expect(fake.sent).toEqual([])
  })

  it('refuses a send that was never shown: 0 send without the text displayed', async () => {
    const actions = start([ligne('/a/cate#n1', draft('h1'))])
    await expect(actions.send('/a/cate#n1')).resolves.toMatchObject({ ok: false, error: 'invalid' })
    expect(fake.sent).toEqual([])
  })

  it('sends exactly the hash that was shown, to the draft of the line', async () => {
    const actions = start([ligne('/a/cate#n1', draft('h1'))])
    actions.show('/a/cate#n1')
    await expect(actions.send('/a/cate#n1')).resolves.toEqual({ ok: true })
    expect(fake.sent).toEqual([{ workspaceId: 'w1', panelId: 'p1', op: { kind: 'draft.send', draftId: 'd1', hash: 'h1' } }])
  })

  it('a text that changed after it was shown drops the display and sends nothing', async () => {
    const actions = start([ligne('/a/cate#n1', draft('h1'))])
    actions.show('/a/cate#n1')
    fake.set([ligne('/a/cate#n1', draft('h2', { texte: 'Autre' }))])
    expect(actions.getState().shown).toEqual({})
    expect(actions.getState().notices['/a/cate#n1']).toBe('texte a changé')
    await expect(actions.send('/a/cate#n1')).resolves.toMatchObject({ ok: false, error: 'invalid' })
    expect(fake.sent).toEqual([])
  })

  it('shows the regisseur\'s « texte a changé » as a conflict when the file moved under the snapshot', async () => {
    const actions = start([ligne('/a/cate#n1', draft('h1'))])
    actions.show('/a/cate#n1')
    fake.reply(async () => ({ ok: false, error: 'conflict', message: 'texte a changé' }))
    await expect(actions.send('/a/cate#n1')).resolves.toEqual({ ok: false, error: 'conflict', message: 'texte a changé' })
    expect(actions.getState().notices['/a/cate#n1']).toBe('texte a changé')
  })

  it('sends once per click: busy until the draft leaves', async () => {
    const actions = start([ligne('/a/cate#n1', draft('h1'))])
    actions.show('/a/cate#n1')
    await actions.send('/a/cate#n1')
    await expect(actions.send('/a/cate#n1')).resolves.toEqual({ ok: false, error: 'busy' })
    expect(fake.sent).toHaveLength(1)
  })

  it('refuses show and send on a line that is not a draft, and a draft already in flight', async () => {
    const actions = start([ligne('/a/cate#n1', question()), ligne('/a/cate#n2', draft('h1', { inFlight: true }))])
    expect(actions.show('/a/cate#n1')).toMatchObject({ ok: false, error: 'invalid' })
    actions.show('/a/cate#n2')
    await expect(actions.send('/a/cate#n2')).resolves.toMatchObject({ ok: false, error: 'invalid' })
    expect(fake.sent).toEqual([])
  })
})

describe('perm', () => {
  it('relays Oui or Non to the need of the line, in the panel of its project only', async () => {
    const actions = start([
      ligne('/a/cate#n3', perm),
      ligne('/a/lamif#n3', perm, { workspaceId: 'w2', panelId: 'p2' }),
    ])
    await expect(actions.perm('/a/lamif#n3', 'non')).resolves.toEqual({ ok: true })
    expect(fake.sent).toEqual([{ workspaceId: 'w2', panelId: 'p2', op: { kind: 'perm', needId: 'n3', reponse: 'non' } }])
  })

  it('gives no way to answer a line without a readable request: it is a link, nothing is sent', async () => {
    const actions = start([ligne('/a/cate#n3', { type: 'link' })])
    await expect(actions.perm('/a/cate#n3', 'oui')).resolves.toMatchObject({ ok: false, error: 'invalid' })
    expect(fake.sent).toEqual([])
  })

  it("shows the regisseur's refusal in the line, and frees it for another try", async () => {
    const actions = start([ligne('/a/cate#n3', perm)])
    const message = 'La demande a changé ou disparu : recharge le suivi, relis, puis réponds.'
    fake.reply(async () => ({ ok: false, error: 'conflict', message }))
    await expect(actions.perm('/a/cate#n3', 'oui')).resolves.toEqual({ ok: false, error: 'conflict', message })
    expect(actions.getState().notices['/a/cate#n3']).toBe(message)
    expect(actions.getState().busy.size).toBe(0)
  })
})

describe('state', () => {
  it('holds no token, and notifies on a change only', async () => {
    const actions = start([ligne('/a/cate#n1', draft('h1'))])
    const seen = vi.fn()
    actions.subscribe(seen)
    actions.show('/a/cate#n1')
    expect(seen).toHaveBeenCalled()
    expect(JSON.stringify([...actions.getState().busy, actions.getState().shown, actions.getState().notices])).not.toMatch(/token|jeton/i)
  })

  it('does not listen to the store while nobody subscribes', () => {
    fake = fakeStore([])
    const spy = vi.spyOn(fake.store, 'subscribe')
    const actions = createBoiteActions(fake.store)
    expect(spy).not.toHaveBeenCalled()
    const stop = actions.subscribe(() => {})
    expect(spy).toHaveBeenCalledTimes(1)
    stop()
  })
})
