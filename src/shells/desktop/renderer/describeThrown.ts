// What the renderer logs for an uncaught value: a message, a name or a stack only.
// A DOM Event serializes as `{ isTrusted: true }`, and any other object may carry user content.
export function describeThrown(value: unknown): unknown {
  if (value instanceof Event) return `${value.type} event on ${value.target?.constructor.name ?? 'unknown target'}`
  if (value instanceof Error || typeof value === 'string' || value == null) return value
  return `non-error ${typeof value} (${(value as object).constructor?.name ?? 'unknown'})`
}
