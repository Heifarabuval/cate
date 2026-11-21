// An element the person shows an agent from the browser panel: they turn on
// the pick, then click one element. Only what is listed here leaves the page,
// once per click: never the page's HTML, a capture or a field's value.

import type { PanelRelation } from '@workspace/document/contract'

export interface BrowserPickedElement {
  /** A CSS selector that finds the element again (`cate browser` can act on it). */
  selector: string
  /** Its accessibility role (button, link, textbox). */
  role: string
  /** Its visible text, empty for a form field. */
  text: string
  /** Its box in the viewport, in CSS pixels. */
  rect: { x: number; y: number; width: number; height: number }
}

/** The longest text a pick sends. */
export const PICKED_TEXT_MAX = 200

/** The prompt an agent receives; the page's query and fragment (tokens) stay out. */
export function pickedElementPrompt(element: BrowserPickedElement, url: string): string {
  let page = url
  try {
    const parsed = new URL(url)
    page = `${parsed.origin}${parsed.pathname}`
  } catch { /* not a URL: keep it */ }
  const text = element.text.replace(/\s+/g, ' ').trim()
  const shown = text.length > PICKED_TEXT_MAX ? `${text.slice(0, PICKED_TEXT_MAX)}…` : text
  const { x, y, width, height } = element.rect
  return [
    `The person points at this element in the browser panel (${page}):`,
    `- selector: ${element.selector}`,
    `- role: ${element.role}`,
    ...(shown ? [`- text: "${shown}"`] : []),
    `- position: x ${Math.round(x)}, y ${Math.round(y)}, ${Math.round(width)} x ${Math.round(height)} (viewport, CSS px)`,
  ].join('\n')
}

/** The panels a relation joins to `panelId`, either way, once each. */
export function panelsLinkedTo(panelId: string, relations: Record<string, Pick<PanelRelation, 'fromPanelId' | 'toPanelId'>>): string[] {
  const linked = new Set<string>()
  for (const { fromPanelId, toPanelId } of Object.values(relations)) {
    if (toPanelId === panelId) linked.add(fromPanelId)
    else if (fromPanelId === panelId) linked.add(toPanelId)
  }
  return [...linked]
}
