// What is never captured, as pure functions (spec 003, "Ce qui n'est JAMAIS
// capté"). The journal applies them on receipt; the recorder of a later lot
// applies them on the page too, before it sends anything.

/** A run of 16 characters or more of letters, digits and `-_.~`, anywhere in a path segment, is a token or a name (Q5). */
const LONG_RUN = /[A-Za-z0-9._~-]{16,}/
/** `@` is an email address; `+` and `=` are base64, written or percent-encoded (`%40`, `%2B`, `%3D`). */
const ADDRESS_OR_BASE64 = /[+=@]/

/** Read as written and as decoded: `%61%62...` is a long word, `%40` is an `@`. */
function isSecretLike(segment: string): boolean {
  let decoded = segment
  try {
    decoded = decodeURIComponent(segment)
  } catch { /* a malformed escape: the segment as written is all there is to read */ }
  return [segment, decoded].some((form) => LONG_RUN.test(form) || ADDRESS_OR_BASE64.test(form))
}

function maskSegment(segment: string): string {
  // `;jsessionid=...` after a segment is a legacy path parameter: it goes.
  const bare = segment.split(';')[0]
  return isSecretLike(bare) ? '*' : bare
}

/**
 * The URL of a page as the journal knows it: scheme, host, port and path.
 * No query, no fragment, no credentials; a path segment that may be a token or
 * an address (16 characters or more, or holding `+`, `=` or `@`) is replaced
 * by `*`. Null for what is not an http or https page (a file, an internal
 * page, a script): such a page leaves no trace.
 */
export function stripUrl(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return `${url.origin}${url.pathname.split('/').map(maskSegment).join('/')}`
}

/** What a field says about itself: the `type` and `autocomplete` of the element, read raw. */
export interface FieldProps {
  type?: string | null
  autocomplete?: string | null
}

/**
 * A field the journal never mentions: `type=password`, or an `autocomplete`
 * holding `cc-*`, `one-time-code`, `current-password` or `new-password`.
 * `autocomplete` is a list of words (`section-pay billing cc-csc`) in any
 * case, so each word is tested.
 */
export function isSensitiveField(field: FieldProps): boolean {
  if (field.type?.trim().toLowerCase() === 'password') return true
  return (field.autocomplete ?? '').toLowerCase().split(/\s/).some((word) =>
    word === 'one-time-code' || word === 'current-password' || word === 'new-password' || word.startsWith('cc-'))
}

function hostOf(value: string): string | null {
  try {
    const host = new URL(value.includes('://') ? value : `https://${value}`).hostname.replace(/\.$/, '')
    return host || null
  } catch {
    return null
  }
}

/**
 * Whether a host, a `host:port` or a URL belongs to an excluded domain or to
 * one of its subdomains. A close name is not a match (`banque-exemple.fr` is
 * not `exemple.fr`). What cannot be read counts as excluded: nothing is
 * captured on a doubt. `list` holds lowercase bare domains (`exclusionList`).
 */
export function isExcludedDomain(hostOrUrl: string, list: readonly string[]): boolean {
  const host = hostOf(hostOrUrl.trim())
  if (host === null) return true
  return list.some((domain) => host === domain || host.endsWith(`.${domain}`))
}
