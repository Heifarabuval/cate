// Isolated harness for the frame gesture profile (SC-005): the real canvas view
// store over the real client document mirror, 8 member-sized nodes drawn with the
// real node style hook, and (scene=frame) the real FrameLayer. Not part of any test
// suite and never Electron. Query: ?scene=base|frame&theme=<theme id>&state=<frame state>.
//   base : 8 selected nodes, moved through `previewRects` (the live-preview primitive).
//   frame: the same 8 nodes in a frame, moved by dragging its title bar.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { clientStateFor, documentStoreFor } from '@client/document'
import { rect } from '@workspace/canvas/contract'
import { applyTheme } from '@shells/desktop/ui/kernel/interaction/theme/themeManager'
import '@shells/desktop/renderer/styles/globals.css'
import { canvasDocument } from '@shells/desktop/ui/client/layout/canvas/testing.canvas'
import { openTestDocument } from '@shells/desktop/ui/client/layout/canvas/testing'
import { createCanvasView } from '@shells/desktop/ui/client/layout/canvas/store'
import { CanvasViewProvider, useCanvasView } from '@shells/desktop/ui/client/layout/canvas/context'
import { useCanvasNodeStyle } from '@shells/desktop/ui/client/layout/canvas/useCanvasNodeStyle'

const params = new URLSearchParams(location.search)
const scene = params.get('scene') ?? 'base'
applyTheme((params.get('theme') ?? 'dark-warm') as never)

const WS = 'harness-ws'
const COUNT = 8
const ids = Array.from({ length: COUNT }, (_, i) => `n${i}`)
const rects = ids.map((nodeId, i) => ({
	nodeId,
	panelId: `p${i}`,
	rect: rect(80 + (i % 4) * 440, 120 + Math.floor(i / 4) * 340, 400, 300)
}))

const frames = import.meta.glob('/src/shells/desktop/ui/client/layout/canvas/frame/FrameLayer.tsx', { eager: true }) as Record<
	string,
	{ FrameLayer: React.ComponentType<{ workspaceId: string; canvasId: string }> }
>
const FrameLayer = Object.values(frames)[0]?.FrameLayer

const base = canvasDocument(rects)
const detach = openTestDocument(WS, base)
await new Promise((r) => setTimeout(r, 20))
const documentStore = documentStoreFor(WS)!
if (scene === 'frame') {
	if (!FrameLayer) throw new Error('FrameLayer not written yet: run the base scene only')
	const state = (params.get('state') ?? 'active') as 'active'
	documentStore.propose({ kind: 'addFrame', canvasId: 'c1', frame: { id: 'f1', title: 'Besoin : couleurs du panneau agence', state, collapsed: false, at: { x: 0, y: 0 } } })
	for (const id of ids) documentStore.propose({ kind: 'setNodeFrame', canvasId: 'c1', nodeId: id, frameId: 'f1' })
	await new Promise((r) => setTimeout(r, 20))
}
const store = createCanvasView({ workspaceId: WS, canvasId: 'c1', document: documentStore, clientState: clientStateFor(WS), animate: false })
store.getState().setContainerSize({ width: window.innerWidth, height: window.innerHeight })
store.getState().setZoomAndOffset(0.5, { x: 40, y: 40 })
;(window as unknown as { __store: unknown }).__store = store
void detach

// A node body with some text, enough paint to stand for a terminal's rows
// (it does not stand for xterm or a webview: see the report).
const Body = React.memo(function Body({ id }: { id: string }) {
	return (
		<div style={{ padding: 8, font: '11px/14px monospace', color: 'var(--text-secondary)' }}>
			<div style={{ marginBottom: 6, color: 'var(--text-primary)' }}>{id} terminal</div>
			{Array.from({ length: 18 }, (_, i) => (
				<div key={i}>$ pnpm run build --filter={id} step {i} ........ ok</div>
			))}
		</div>
	)
})

function Box({ id }: { id: string }) {
	const node = useCanvasView((s) => s.nodes[id])
	const { containerStyle } = useCanvasNodeStyle({ node, isFocused: false, isSelected: true, isHovered: false, isWholeNodeDragSource: false })
	// Base scene: the pointer drives the selection like the app's live preview.
	const onDown = (event: React.PointerEvent) => {
		if (scene !== 'base') return
		const start = { x: event.clientX, y: event.clientY }
		const origins = ids.map((nodeId) => ({ nodeId, origin: store.getState().nodes[nodeId].origin, size: store.getState().nodes[nodeId].size }))
		const move = (e: PointerEvent) => {
			const z = store.getState().zoomLevel
			const dx = (e.clientX - start.x) / z
			const dy = (e.clientY - start.y) / z
			store.getState().previewRects(origins.map((o) => ({ nodeId: o.nodeId, rect: { origin: { x: o.origin.x + dx, y: o.origin.y + dy }, size: o.size } })))
		}
		const up = () => {
			window.removeEventListener('pointermove', move)
			window.removeEventListener('pointerup', up)
			store.getState().commitPreview()
		}
		window.addEventListener('pointermove', move)
		window.addEventListener('pointerup', up)
	}
	if (!node) return null
	return (
		<div data-testid={`node-${id}`} style={containerStyle} onPointerDown={onDown}>
			<Body id={id} />
		</div>
	)
}

function Scene() {
	const { zoomLevel, viewportOffset } = useCanvasView((s) => ({ zoomLevel: s.zoomLevel, viewportOffset: s.viewportOffset }), (a, b) => a.zoomLevel === b.zoomLevel && a.viewportOffset === b.viewportOffset)
	return (
		<div
			data-canvas-surface
			style={{ position: 'absolute', inset: 0, transformOrigin: '0 0', transform: `translate(${viewportOffset.x}px, ${viewportOffset.y}px) scale(${zoomLevel})` }}
		>
			{scene === 'frame' && FrameLayer ? <FrameLayer workspaceId={WS} canvasId="c1" /> : null}
			{ids.map((id) => (
				<Box key={id} id={id} />
			))}
		</div>
	)
}

createRoot(document.getElementById('root')!).render(
	<CanvasViewProvider store={store}>
		<Scene />
	</CanvasViewProvider>
)
