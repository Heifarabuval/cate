# Main process memory: measurement protocol (issue #15)

Status: protocol only. Nothing here has been run. Owner of the run: Heifara, on a dev build, outside any working session.

## Observation to explain

Electron main, Cate 2.1.0-beta.15: `footprint` 10 GB, `vmmap` Memory Tag 253 (PartitionAlloc, ArrayBuffers) 7.6 GB and Tag 255 (V8 heap) 2.1 GB, all swapped, RSS 0.2 to 0.3 GB. Growth in bursts (about 40 MB/min over 4 h, flat for 20 min).

## Hypotheses

| # | Hypothesis | Code | Status |
|---|---|---|---|
| H1 | Byte relay without backpressure: `socket.on('data')` to `port.postMessage` queues serialized messages in main when a renderer drains slowly | `src/runtime/transports/node/local.ts:15`, `src/shells/desktop/main/pipes.ts:28` | Not provable by unit test: `MessagePortMain` exposes no queue depth or drain event, and `ByteDuplex` has no pause. A fix needs a new ack protocol between main and renderer. Decide after load A. |
| H2 | Always-on CDP domains (`DOM`, `Accessibility`, `Network`, `Runtime`, `Page`) on every driven guest and iframe | `src/services/browser/desktop/pageDriver.ts` (`attach`, `enableSession`) | Not provable by unit test: the cost is inside Chromium. Decide after load B. |
| H2b | `refs` and `stableIds` grow with every snapshot on a page that never navigates | `pageDriver.ts` (`forgetUnshownRefs`) | Already fixed upstream by a42ec4fe (refs of the last two shown reads kept). Tests in `pageDriver.refs.test.ts`, including one 6000 element snapshot that keeps all its ids. Its real weight is still measured by load B. |
| H3 | Per-guest Chromium state (17 webviews, DevTools sessions) | Chromium | Measured only: compare load B with 0, 3 and 17 guests. |

Already treated upstream by be047ff7 (lazy runtime modules, lazy browser guests, canvas culling): renderer and runtime-daemon RAM. It did not touch the main process relay, the pageDriver maps or main memory logging. Not redone here.

## Setup

1. Dev build launched by hand with the main inspector: `npm run dev -- --inspect=9229` (electron-vite forwards it to the main process). Same workspace layout as the report: 6 workspaces.
2. Open `chrome://inspect`, attach to the main process. Heap snapshots with "Take heap snapshot".
3. Native side from a terminal. `PID` is the Electron main pid: the one process started with `--inspect=9229` and without `--type=` (helpers carry `--type=`):
   `PID=$(ps -axo pid=,command= | grep -- '--inspect=9229' | grep -v -e '--type=' -e grep | awk '{print $1}')`
   Then:
   - `footprint PID | head -40`
   - `vmmap --summary PID | grep -E "Tag 253|Tag 255|Physical footprint"`
4. Fresh app start for each load. Note the build, Electron version and date in the result file.

## Loads

- **A, terminals only**: 10 terminals each running `yes | head -c 2G` in a loop (continuous output), no browser panel open.
- **B, browsers only**: 17 browser panels (GitHub pages, the Suivi page), terminals silent, an agent running `cate browser snapshot` in a loop (one per second).
- **C, control**: the same app idle, nothing open, for the baseline slope.

## Steps per load (A, B, C)

1. T0: wait 2 min after the load is stable. Take heap snapshot `T0`; run `footprint` and `vmmap`, record Tag 253, Tag 255, physical footprint.
2. Run the load for 10 min. Every 2 min record `vmmap` Tag 253 and Tag 255 (a 6 point curve).
3. T+10 min: take heap snapshot `T10`; run `footprint` and `vmmap` again.
4. Close the load. After 2 min take a last `vmmap` (is memory returned?).

## Reading the result

- Slope in MB/min for Tag 253 and Tag 255, per load. Which load carries the growth decides the hypothesis: A for H1, B for H2 and H3, C for none of them.
- In `T10`, Comparison view against `T0`, sorted by "Size Delta". For A look at `ArrayBuffer`, `Uint8Array`, `Buffer` and their retainers (a `MessagePort` queue or a `net.Socket` readable buffer points to H1). For B look at `Map` entries owned by `PageDriver` (`refs`, `stableIds`), strings from CDP messages, and `requests` / `log`.
- Tag 253 growth with a flat JS heap points outside JS (Chromium side, H2 or H3). Tag 255 growth points at JS retainers.
- To see what a42ec4fe alone changes, repeat load B on the build before it, in a separate checkout:
  `git worktree add ../cate-before-a42ec4fe a42ec4fe~1 && cd ../cate-before-a42ec4fe && npm install && npm run dev -- --inspect=9229`
  Compare tag 253 and 255 at T+10 with the current `main`. Remove it after: `git worktree remove ../cate-before-a42ec4fe`.

## Decisions after the run

- A wins: add backpressure to the relay (pause the socket until the renderer acks), as its own PR with the ack protocol in `docs/architecture.md`.
- B wins on tag 253: enable `DOM` and `Accessibility` only for the duration of a command.
- Neither: main memory comes from elsewhere; open a new issue with the retainers found.
- In all cases, log `process.memoryUsage()` of main every 5 min in `main.log`. This touches `src/shells/desktop/main/index.ts` (owned by n397 at the time of writing), so it is a separate step once that PR is merged.

## Results

To fill in: a table per load with T0, T+10, slope, and the heap snapshot file names.
