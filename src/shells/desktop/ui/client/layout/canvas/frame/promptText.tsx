// The desktop answer to `ClientUi.promptText`: a one-line dialog, mounted on
// demand over the window and gone when answered. The native message box has no
// text field, so this is drawn here, with theme tokens only.

import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Check, X } from 'lucide-react'

interface PromptProps {
  message: string
  initial: string
  onDone: (value: string | null) => void
}

function TextPrompt({ message, initial, onDone }: PromptProps): React.ReactElement {
  const [value, setValue] = useState(initial)
  return (
    <div
      role="dialog"
      aria-label={message}
      className="fixed inset-0 flex items-start justify-center pt-[20vh]"
      style={{ zIndex: 100000, background: 'var(--canvas-backdrop-scrim)' }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onDone(null)
      }}
    >
      <form
        className="flex w-[360px] flex-col gap-3 rounded-lg border border-strong p-4"
        style={{ background: 'var(--surface-2)' }}
        onSubmit={(e) => {
          e.preventDefault()
          onDone(value)
        }}
      >
        <label className="flex flex-col gap-1 text-xs text-primary">
          {message}
          <input
            autoFocus
            value={value}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setValue(e.target.value)}
            className="rounded border border-strong px-2 py-1 text-sm text-primary"
            style={{ background: 'var(--surface-1)' }}
          />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => onDone(null)} className="inline-flex items-center gap-1 rounded border border-strong px-2 py-1 text-xs text-primary" style={{ background: 'transparent' }}>
            <X size={12} aria-hidden />
            Annuler
          </button>
          <button type="submit" className="inline-flex items-center gap-1 rounded border border-strong px-2 py-1 text-xs text-primary" style={{ background: 'var(--surface-3)' }}>
            <Check size={12} aria-hidden />
            Valider
          </button>
        </div>
      </form>
    </div>
  )
}

/** Asks for one line of text; null when cancelled. */
export function promptText(request: { message: string; initial: string }): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const onDone = (value: string | null) => {
      root.unmount()
      host.remove()
      resolve(value)
    }
    root.render(<TextPrompt {...request} onDone={onDone} />)
  })
}
