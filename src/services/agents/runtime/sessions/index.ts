import type { AgentSessionStores } from './types'
import { piSessionStore } from './pi'
import { claudeSessionStore } from './claude'
import { codexSessionStore } from './codex'
import { cursorSessionStore } from './cursor'
import { geminiSessionStore } from './gemini'
import { grokSessionStore } from './grok'
import { kiroSessionStore } from './kiro'
import { openCodeSessionStore } from './opencode'

/** CLI-specific session persistence behind one exhaustive runtime lookup. */
export const AGENT_SESSION_STORES: AgentSessionStores = {
  'claude-code': claudeSessionStore,
  codex: codexSessionStore,
  cursor: cursorSessionStore,
  gemini: geminiSessionStore,
  grok: grokSessionStore,
  kiro: kiroSessionStore,
  opencode: openCodeSessionStore,
  pi: piSessionStore,
}

export { createAgentTitleTracker } from './tracker'
