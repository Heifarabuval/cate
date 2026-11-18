import { useRef, useState, type ButtonHTMLAttributes } from 'react'
import { Check } from 'lucide-react'
import { buttonClassName, Spinner } from '../../kernel/interaction'

/** The one feedback of every action of the panel, in three steps: pressed
 *  (a short scale, 150 ms), waiting (the button stays, spinner in front of its
 *  label, not clickable) and done (a check). `motion-reduce` drops the
 *  movement, the spinner and the check still tell the state. */
const FEEDBACK = [
  '!transition-[transform,color,background-color,border-color] duration-150 ease-out',
  'active:scale-[0.97] motion-reduce:active:scale-100',
  'aria-disabled:active:scale-100 aria-busy:cursor-progress',
].join(' ')

/** A row that arrives (new, or moved to another section) fades in, 200 ms. */
export const ROW_ENTER = 'animate-sidebar-view-in motion-reduce:animate-none'

/** The one lock of a group of actions: one runs at a time, a second click on
 *  anything in the group is ignored. `run` tells the buttons which one is
 *  `active`, and keeps the refusal in `error` for the group to show in place. */
export function useAction() {
  // Set before React re-renders: a second click in the same batch is ignored,
  // and the lock spans a confirmation dialog too (one dialog at a time).
  const lock = useRef(false)
  const [active, setActive] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  /** `task` resolves to the refusal text, `null` when the action was taken, or
   *  `undefined` when the person backed out (nothing sent). Resolves to true when taken. */
  const run = async (key: string, task: () => Promise<string | null | undefined>): Promise<boolean> => {
    if (lock.current) return false
    lock.current = true
    setActive(key)
    setDone(null)
    setError(null)
    try {
      const refused = await task()
      if (refused) setError(refused)
      else if (refused === null) setDone(key)
      return refused === null
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      lock.current = false
      setActive(null)
    }
  }

  return {
    run,
    active,
    /** The action `key` was taken (until the next run). */
    done,
    error,
    /** Another action of the group is running: this one waits, natively disabled
     *  (the running one stays enabled-looking so it keeps the focus). */
    waiting: (key: string) => active !== null && active !== key,
  }
}

interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  busy?: boolean
  done?: boolean
  /** Styled by `className` alone (the option cards), without the shared Button's size and variant. */
  bare?: boolean
}

/** A button of the panel with its press, waiting and done states. A busy or
 *  done button is `aria-disabled`, not `disabled`: it ignores clicks and keeps the focus. */
export function ActionButton({ busy = false, done = false, bare = false, className = '', onClick, children, ...props }: ActionButtonProps) {
  const shared = {
    ...props,
    'aria-busy': busy || undefined,
    'aria-disabled': busy || done || undefined,
    onClick: busy || done ? undefined : onClick,
    className: `${bare ? '' : `${buttonClassName('secondary', 'sm')} `}${FEEDBACK} ${className}`,
  }
  const content = (
    <>
      {busy && <Spinner size={11} />}
      {done && <Check size={11} aria-hidden="true" className="shrink-0" />}
      {children}
    </>
  )
  return <button type="button" {...shared} className={`!text-primary ${shared.className}`}>{content}</button>
}
