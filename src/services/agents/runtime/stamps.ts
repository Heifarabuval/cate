// Resume stamps: decides when a terminal's agent session becomes the stamp
// the terminal panel persists and types back as a resume command on restore.
//
// Identity comes from hook events only. There is deliberately no store
// scanning fallback: an agent whose hooks never speak has no stamp, because a
// guessed stamp risks resuming the wrong session, which is worse than a
// plain-shell restore. Presence is the authority on "agent gone": its falling
// edge clears the stamp, and the next run proves itself through fresh events.
//
// A stamp is only worth persisting if resuming it works. Claude announces an
// id before its transcript exists and Kiro before its first turn is saved;
// both are stamped from their first turn event (resume.fromSessionStart).

import { AGENT_DEFS, type AgentHookEvent, type AgentSessionLocator, type AgentSessionRef, type TerminalResumeStamp } from '../contract'

/** How many sessions a terminal remembers for usage. Each costs a file lookup
 *  per `cate agent usage` call, so a panel cleared hundreds of times keeps its
 *  most recent ones and says the list was cut. */
export const MAX_USAGE_SESSIONS = 50

interface StampState {
  /** Dedup key of the last emitted stamp. */
  key?: string | null
  latest?: AgentSessionLocator
  /** The sessions the hooks named since the agent started, oldest first, each
   *  with the checkout it ran in (a /clear starts another session; usage
   *  sums them all). At most `MAX_USAGE_SESSIONS`. */
  sessions: AgentSessionRef[]
  /** Older sessions were dropped from `sessions`. */
  truncated: boolean
  /** Ingest counter: an async cwd lookup drops its result when a newer event
   *  (or a clear) landed while it was in flight. */
  seq: number
}

export interface ResumeStampsDeps {
  /** The terminal's current cwd, for events that carry none. */
  getCwd(terminalId: string): Promise<string | null>
  /** A stamp changed (null clears it). Deduplicated. */
  emit(terminalId: string, stamp: TerminalResumeStamp | null): void
}

export interface ResumeStamps {
  ingest(event: AgentHookEvent): void
  /** Presence falling edge: the agent exited while the terminal lives on. */
  clear(terminalId: string): void
  /** The session the terminal's hooks last named, stamped or not. */
  latest(terminalId: string): AgentSessionLocator | undefined
  /** The sessions the terminal's agent ran since it started; empty once it
   *  exited (`clear`), so a relaunch counts from nothing. `truncated`: the
   *  oldest were dropped. */
  sessions(terminalId: string): { sessions: AgentSessionRef[]; truncated: boolean }
  /** Gives a terminal the list it was saved with (a restored panel whose
   *  agent resumes), for the events that follow to add to. */
  seed(terminalId: string, sessions: readonly AgentSessionRef[], truncated: boolean): void
  drop(terminalId: string): void
}

export function createResumeStamps(deps: ResumeStampsDeps): ResumeStamps {
  const states = new Map<string, StampState>()

  const stateFor = (terminalId: string): StampState => {
    let st = states.get(terminalId)
    if (!st) {
      st = { seq: 0, sessions: [], truncated: false }
      states.set(terminalId, st)
    }
    return st
  }

  const emit = (terminalId: string, stamp: TerminalResumeStamp | null): void => {
    const st = stateFor(terminalId)
    const key = stamp ? `${stamp.agentId}\0${stamp.sessionId}\0${stamp.cwd}` : null
    if (st.key === key) return
    st.key = key
    deps.emit(terminalId, stamp)
  }

  return {
    /**
     * session-end clears the stamp (a /clear rotation's follow-up
     * session-start carries the new id and re-stamps under the same gating);
     * any other event with a session id stamps, except a session-start of an
     * agent whose sessions are not resumable yet at that point. The cwd is
     * the event's own, else the terminal's current one.
     */
    ingest(event) {
      const { terminalId } = event
      if (event.kind === 'session-title' || event.kind === 'input-submit') return
      const st = stateFor(terminalId)
      const agent = AGENT_DEFS[event.agentId]
      if (event.kind === 'session-end') {
        if (!event.sessionId) return
        if (st.latest && (
          st.latest.agentId !== event.agentId ||
          st.latest.sessionId !== event.sessionId
        )) return
        st.seq++
        st.latest = undefined
        emit(terminalId, null)
        return
      }
      if (event.sessionId == null) return
      // A late completion/tool event cannot select the conversation that a
      // newer start replaced.
      if (st.latest && (event.kind === 'turn-end' || event.kind === 'turn-resume')
        && (st.latest.agentId !== event.agentId || st.latest.sessionId !== event.sessionId)) return
      st.seq++
      const { agentId, sessionId } = event
      const known = st.sessions.find((session) => session.sessionId === sessionId)
      if (known) {
        if (event.cwd) known.cwd = event.cwd
      } else {
        st.sessions.push({ sessionId, ...(event.cwd ? { cwd: event.cwd } : {}) })
        if (st.sessions.length > MAX_USAGE_SESSIONS) {
          st.sessions.shift()
          st.truncated = true
        }
      }
      const identity = { agentId, sessionId, ...(event.cwd ? { cwd: event.cwd } : {}),
        ...(event.transcriptPath ? { transcriptPath: event.transcriptPath } : {}),
        ...(event.leafId !== undefined ? { leafId: event.leafId } : {}) }
      if (event.kind === 'session-start' && !agent?.resume.fromSessionStart) {
        const previous = st.latest
        st.latest = identity
        // A new session replaced the stamped one without ending it first:
        // the old stamp no longer runs here.
        if (previous?.agentId === agentId && previous.sessionId !== sessionId) emit(terminalId, null)
        return
      }
      st.latest = identity
      if (event.cwd) {
        emit(terminalId, { agentId, sessionId, cwd: event.cwd })
        return
      }
      const seq = st.seq
      void deps.getCwd(terminalId)
        .then((cwd) => {
          if (states.get(terminalId)?.seq !== seq) return // superseded while in flight
          emit(terminalId, { agentId, sessionId, cwd: cwd ?? '' })
        })
        .catch(() => { /* terminal gone: no stamp beats a cwd-less guess */ })
    },

    clear(terminalId) {
      const st = stateFor(terminalId)
      st.seq++
      st.latest = undefined
      st.sessions = []
      st.truncated = false
      emit(terminalId, null)
    },

    sessions(terminalId) {
      const st = states.get(terminalId)
      return { sessions: (st?.sessions ?? []).map((session) => ({ ...session })), truncated: st?.truncated ?? false }
    },

    seed(terminalId, sessions, truncated) {
      const st = stateFor(terminalId)
      st.sessions = sessions.slice(-MAX_USAGE_SESSIONS).map((session) => ({ ...session }))
      st.truncated = truncated || sessions.length > MAX_USAGE_SESSIONS
    },

    latest(terminalId) {
      const latest = states.get(terminalId)?.latest
      if (!latest) return undefined
      return { ...latest }
    },

    drop(terminalId) {
      states.delete(terminalId)
    },
  }
}
