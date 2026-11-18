// What the renderer logs for an uncaught value: a message, a name or a stack only.
// A DOM Event serializes as `{ isTrusted: true }`, and any other object may carry user content.
// An Error from another realm (iframe, webview) fails `instanceof`, so it is told by name and message.
// Only its name and message are kept, never the other fields of the object.
function foreignError(value: unknown): string | null {
  const { name, message } = (value ?? {}) as Partial<Error>
  return typeof value === 'object' && typeof name === 'string' && /Error$/.test(name) && typeof message === 'string' ? `${name}: ${message}` : null
}

export function describeThrown(value: unknown): unknown {
  if (value instanceof Event) return `${value.type} event on ${value.target?.constructor.name ?? 'unknown target'}`
  if (value instanceof Error || typeof value === 'string' || value == null) return value
  return foreignError(value) ?? `non-error ${typeof value} (${(value as object).constructor?.name ?? 'unknown'})`
}
