import { act } from 'react'
import { afterEach, expect, it } from 'vitest'
import { promptText } from './promptText'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
const input = () => dialog()!.querySelector('input')!
const flush = () => act(async () => { await Promise.resolve() })

afterEach(() => { document.body.innerHTML = '' })

async function open(opener: HTMLElement) {
  opener.focus()
  let answer: Promise<string | null> = Promise.resolve(null)
  await act(async () => { answer = promptText({ message: 'Frame title', initial: 'Besoin' }) })
  return { answer }
}

it('asks in a modal dialog, focused on the field, and returns the typed line', async () => {
  const opener = document.body.appendChild(document.createElement('button'))
  const { answer } = await open(opener)
  expect(dialog()!.getAttribute('aria-modal')).toBe('true')
  expect(input().value).toBe('Besoin')
  expect(document.activeElement).toBe(input())
  await act(async () => { input().form!.requestSubmit() })
  await expect(answer).resolves.toBe('Besoin')
  await flush()
  expect(dialog()).toBeNull()
  expect(document.activeElement).toBe(opener)
})

it('returns null on Escape and gives focus back', async () => {
  const opener = document.body.appendChild(document.createElement('button'))
  const { answer } = await open(opener)
  await act(async () => { input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
  await expect(answer).resolves.toBeNull()
  await flush()
  expect(dialog()).toBeNull()
  expect(document.activeElement).toBe(opener)
})
