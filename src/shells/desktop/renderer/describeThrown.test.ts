// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { describeThrown } from './describeThrown'

it('names a DOM event and its target instead of { isTrusted: true }', () => {
  const event = new Event('error')
  document.createElement('img').dispatchEvent(event)
  expect(describeThrown(event)).toBe('error event on HTMLImageElement')
  expect(describeThrown(new Event('error'))).toBe('error event on unknown target')
})

it('keeps errors, messages and empty values', () => {
  const error = new Error('boom')
  expect(describeThrown(error)).toBe(error)
  expect(describeThrown('boom')).toBe('boom')
  expect(describeThrown(undefined)).toBeUndefined()
})

it('never returns the content of another object', () => {
  expect(describeThrown({ token: 'user content' })).toBe('non-error object (Object)')
  expect(describeThrown(Object.create(null))).toBe('non-error object (unknown)')
  expect(describeThrown(42)).toBe('non-error number (Number)')
})
