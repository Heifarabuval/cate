// Toolbar entries other modules add to every canvas toolbar (the worktree
// menu), so the canvas never imports them.

import type React from 'react'

export interface CanvasToolbarItemProps {
  workspaceId: string
  canvasId: string
  canvasPanelId: string
  tooltipPlacement: 'top' | 'right'
  menuSide: 'up' | 'right'
  /** An open fly-out keeps a compact toolbar expanded. */
  onOpenChange(open: boolean): void
}

export interface CanvasToolbarItem {
  id: string
  /** 'tools' sits after the select and hand tools; 'create' after the new
   *  panel buttons. */
  group: 'tools' | 'create'
  order: number
  Component: React.ComponentType<CanvasToolbarItemProps>
}

const items = new Map<string, CanvasToolbarItem>()
const listeners = new Set<() => void>()
let snapshot: CanvasToolbarItem[] = []

export function registerCanvasToolbarItem(item: CanvasToolbarItem): () => void {
  items.set(item.id, item)
  snapshot = [...items.values()].sort((a, b) => a.order - b.order)
  for (const listener of [...listeners]) listener()
  return () => {
    if (items.get(item.id) !== item) return
    items.delete(item.id)
    snapshot = [...items.values()].sort((a, b) => a.order - b.order)
    for (const listener of [...listeners]) listener()
  }
}

export function canvasToolbarItems(): CanvasToolbarItem[] {
  return snapshot
}

export function subscribeCanvasToolbarItems(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

// --- Spawn flyouts ------------------------------------------------------------
// A pop-over a module shows while the pointer rests on a panel type's
// new-panel button (the agents over the terminal button).

export interface SpawnFlyoutProps {
  workspaceId: string
  canvasId: string
  /** The side of the button the flyout opens on. */
  side: 'up' | 'left'
  /** Closes the flyout (after a pick). */
  onClose(): void
  /** Whether it shows anything; the button's tooltip steps aside while it does. */
  onShown(shown: boolean): void
}

export interface SpawnFlyout {
  panelType: string
  Component: React.ComponentType<SpawnFlyoutProps>
}

const flyouts = new Map<string, SpawnFlyout>()
const flyoutListeners = new Set<() => void>()

export function registerSpawnFlyout(flyout: SpawnFlyout): () => void {
  flyouts.set(flyout.panelType, flyout)
  for (const listener of [...flyoutListeners]) listener()
  return () => {
    if (flyouts.get(flyout.panelType) !== flyout) return
    flyouts.delete(flyout.panelType)
    for (const listener of [...flyoutListeners]) listener()
  }
}

export function spawnFlyoutFor(panelType: string): SpawnFlyout | undefined {
  return flyouts.get(panelType)
}

export function subscribeSpawnFlyouts(listener: () => void): () => void {
  flyoutListeners.add(listener)
  return () => { flyoutListeners.delete(listener) }
}

// --- Creation menu entries ------------------------------------------------------
// "New …" entries a module adds to the canvas's empty-space menu, after the
// panel types (the agents a terminal can start as).

export interface CanvasMenuEntry {
  id: string
  label: string
  /** Creates at the canvas point the menu opened on. */
  run(position: { x: number; y: number }): void
}

/** A hook: called on every canvas render, so register before canvases mount. */
export type CanvasMenuEntriesHook = (workspaceId: string, canvasId: string) => readonly CanvasMenuEntry[]

const menuEntryHooks: CanvasMenuEntriesHook[] = []

export function registerCanvasMenuEntries(hook: CanvasMenuEntriesHook): () => void {
  menuEntryHooks.push(hook)
  return () => {
    const index = menuEntryHooks.indexOf(hook)
    if (index >= 0) menuEntryHooks.splice(index, 1)
  }
}

export function useCanvasMenuEntries(workspaceId: string, canvasId: string): CanvasMenuEntry[] {
  return menuEntryHooks.flatMap((hook) => hook(workspaceId, canvasId))
}
