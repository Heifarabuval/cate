// The desktop answer to `ClientUi.promptText`: a one-line dialog on the shared
// `Modal` (focus trap, focus returned on close, Escape through the dialog
// layers), shown on demand like `pickSavePath`. The native message box has no
// text field.

import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Pencil } from 'lucide-react'
import { Modal, btn, inputCls } from '../../../../kernel/interaction'

interface PromptProps {
  message: string
  initial: string
  onDone: (value: string | null) => void
}

function TextPrompt({ message, initial, onDone }: PromptProps): JSX.Element {
  const [value, setValue] = useState(initial)
  return (
    <Modal onClose={() => onDone(null)} width={360} icon={<Pencil size={16} />} title={message} bodyClassName="px-5 py-4">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          onDone(value)
        }}
      >
        <input
          autoFocus
          aria-label={message}
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setValue(e.target.value)}
          className={inputCls}
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => onDone(null)} className={btn.ghost}>Cancel</button>
          <button type="submit" className={btn.primary}>Save</button>
        </div>
      </form>
    </Modal>
  )
}

/** Asks for one line of text; null when cancelled. */
export function promptText(request: { message: string; initial: string }): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    let settled = false
    const onDone = (value: string | null) => {
      if (settled) return
      settled = true
      resolve(value)
      queueMicrotask(() => { root.unmount(); host.remove() })
    }
    root.render(<TextPrompt {...request} onDone={onDone} />)
  })
}
