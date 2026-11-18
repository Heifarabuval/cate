// The title bar of a frame: title, state pill (icon and label, never colour
// alone) and panel count. Drawing only; the gestures live in the same file's
// callers (FrameLayer) and the rules in `workspace/canvas/contract/frame.ts`.

import React from 'react'
import { Hourglass, Layers, Loader, OctagonAlert, CircleCheck, type LucideIcon } from 'lucide-react'
import type { FrameState } from '@workspace/document/contract'

export const FRAME_STATE_VIEW: Record<FrameState, { label: string; Icon: LucideIcon; accent: string }> = {
  active: { label: 'en cours', Icon: Loader, accent: 'var(--focus-blue)' },
  waiting: { label: "t'attend", Icon: Hourglass, accent: 'var(--activity-orange)' },
  blocked: { label: 'bloqué', Icon: OctagonAlert, accent: 'var(--git-deleted)' },
  done: { label: 'fait', Icon: CircleCheck, accent: 'var(--activity-green)' }
}

export interface FrameTitleBarProps {
  title: string
  state: FrameState
  panelCount: number
}

export function FrameTitleBar({ title, state, panelCount }: FrameTitleBarProps): React.ReactElement {
  const { label, Icon, accent } = FRAME_STATE_VIEW[state]
  return (
    <div
      data-frame-bar
      className="flex h-full w-full select-none items-center gap-2 px-2 text-xs"
      style={{ pointerEvents: 'auto', background: 'var(--surface-1)', borderRadius: 'inherit' }}
    >
      <span
        data-frame-state={state}
        className="inline-flex shrink-0 items-center gap-1 text-primary transition-colors motion-reduce:transition-none"
      >
        <Icon size={12} aria-hidden style={{ color: accent }} />
        {label}
      </span>
      <span data-frame-title title={title} className="min-w-0 flex-1 truncate font-medium text-primary">
        {title}
      </span>
      <span data-frame-count className="inline-flex shrink-0 items-center gap-1 text-secondary" aria-label={`${panelCount} panneaux`}>
        <Layers size={12} aria-hidden />
        {panelCount}
      </span>
    </div>
  )
}
