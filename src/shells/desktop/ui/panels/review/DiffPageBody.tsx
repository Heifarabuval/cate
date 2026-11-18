import React, { useEffect, useRef, useState } from 'react'
import { Pagination } from '../../kernel/interaction'
import type { DiffPage } from '@workspace/repository/contract'
import type { ReviewDisplay } from '@panels/review/contract'
import { GitDiff } from '../../workspace/repository'

/** Mounted only after the reader opens a file: fetches one bounded diff page from the session. `loadKey` names what
 *  `load` reads; a new key, page or retry reads again. */
export function DiffPageBody({ loadKey, load, display, page, setPage, numbered, loading, failure, notice }: {
  loadKey: string
  load(page: number): Promise<unknown>
  display: ReviewDisplay
  page: number
  setPage(page: number): void
  numbered: boolean
  loading: string
  failure: string
  /** Shown above the loaded diff. */
  notice?: React.ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  const [body, setBody] = useState<DiffPage | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const loader = useRef(load)
  loader.current = load
  useEffect(() => {
    let live = true
    setBody(null)
    setFailed(false)
    loader.current(page).then(
      (result) => { if (live) setBody(result as DiffPage) },
      () => { if (live) setFailed(true) },
    )
    return () => { live = false }
  }, [loadKey, page, attempt])
  return <div ref={root} className="w-full min-w-0 font-mono text-[11px] leading-[1.45]">
    {failed ? <div role="alert" className="px-3 py-2 font-sans text-red-400">{failure} <button type="button" className="underline" onClick={() => setAttempt((value) => value + 1)}>Retry</button></div>
      : !body ? <p role="status" className="px-3 py-3 font-sans text-xs text-muted">{loading}</p>
      : <>
        {notice}
        <div data-review-diff-scroll className="w-full min-w-0 overflow-x-auto">
          <div className={display.wrap ? 'w-full min-w-0 whitespace-pre-wrap break-all' : 'w-max min-w-full whitespace-pre'}>
            <GitDiff hunks={body.hunks} {...display} numbered={numbered} />
          </div>
        </div>
        <Pagination label="diff page" page={body.page} pageCount={body.pageCount} onChange={(next) => { setPage(next); root.current?.scrollIntoView?.({ block: 'start' }) }} />
      </>}
  </div>
}
