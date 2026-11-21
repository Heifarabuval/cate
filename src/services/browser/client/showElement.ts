// The person shows an agent one element of the page (spec 013, US8): only on
// their click, only to the agents related to the browser panel.

import { pickedElementPrompt, type BrowserDriverResult, type BrowserPickedElement } from '../contract'

export interface ShowElementDeps {
  /** Runs the page driver's `pickElement` on the shown tab: waits for the click. */
  pick(): Promise<BrowserDriverResult>
  /** `agents.send`; refuses a panel that hosts no agent. */
  send(panelId: string, prompt: string): Promise<unknown>
}

/** `linked`: the panels related to the browser (`panelsLinkedTo`). */
export async function showElementToAgents(deps: ShowElementDeps, linked: string[], url: string): Promise<'sent' | 'cancelled' | 'no-agent'> {
  if (linked.length === 0) return 'no-agent'
  const { result, error } = await deps.pick()
  if (error || !result) return 'cancelled'
  const prompt = pickedElementPrompt(result as BrowserPickedElement, url)
  const sent = await Promise.allSettled(linked.map((panelId) => deps.send(panelId, prompt)))
  return sent.some((outcome) => outcome.status === 'fulfilled') ? 'sent' : 'no-agent'
}
