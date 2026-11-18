---
name: cate-cli
description: Read this skill before the first `cate` command, the CLI on PATH in every Cate terminal (CATE_SOCKET and CATE_TOKEN are set) that drives the workspace the terminal belongs to. Use it whenever a task in a Cate terminal needs Cate itself, even if the person never mentions the CLI, such as looking at, testing or signing in to a web page in Cate's browser panel, taking a screenshot, reading or typing into another terminal, opening a file or panel for the person, starting other coding agents in their own panels or worktrees and waiting for their answers, or recording findings in a Review panel. It covers targeting panels, CLI permissions, and the browser and agent workflows. It is not for working on Cate's own source code, and not for theming Cate, which has the cate-theme skill.
---

# Cate CLI

`cate` talks to the workspace's runtime over the local socket named by
`CATE_SOCKET`, authenticated by `CATE_TOKEN`, a per-terminal token that also
names the calling panel. It works the same when the workspace lives on
another machine. If either variable is missing, `cate` exits 3 and says so:
you are not in a Cate terminal, so this skill does not apply.

`agence`, the orchestration CLI of the agence panel, is on the same PATH
(`agence --help`, `agence --version`). It needs a system `python3` (3.9 or
newer) and exits 2 without one.

## Reference files

Read the one for your task before its first command:

- `references/browser.md`: the browser panel. Snapshots and element ids,
  clicking and typing, tabs, uploads, dialogs, saved logins and sign-ups,
  console and network logs, screenshots.
- `references/agents.md`: starting other coding agents (always with a
  validated `--done-when` condition that closes their panel, and `--model`
  or `--effort` when the task needs another model or effort), sending them
  prompts, waiting for and reading their answers, and typing into terminals
  that have no agent.

Panels, terminals, editors and Review panels are covered
below.

## Permissions

Each area needs its permission in the workspace's Settings → CLI: the master
switch "Command-line control (cate CLI)" plus a Read and a Control cell per
area (Browser, Browser passwords, Terminal, Panels, Files,
Agents & reviews). Sending keystrokes to terminals (Terminal, Control) and
using saved browser passwords are off by default. A denied call fails with an error naming the setting: tell the
person which one to turn on instead of working around it.

## Help, output and exit codes

The CLI's own help is the reference for exact syntax. Check it before
guessing a flag:

```bash
cate --help                  # command groups and global flags
cate panel --help            # the commands of one group (or just: cate panel)
cate agent send --help       # one command: arguments, flags and defaults
```

A mistyped command suggests the closest one. Lists print as aligned tables,
other results as `key  value` lines, structured reports as indented JSON.
Add `--json` to any command when you parse the result or need full ids.
Every error says what to do next.

Exit codes: 0 ok, 1 the call failed, 2 usage error (Cate was not contacted),
3 not connected to Cate.

## Panels and targets

```bash
cate panel list
```

```
    ID        TYPE      TITLE
*   1a2b3c4d  terminal  zsh
>   5e6f7a8b  terminal  zsh
    9c0d1e2f  browser   https://example.com
```

`*` marks the focused panel, `>` the panel your command runs in. Ids are
short; any unique prefix works, and `--json` gives full ids, each panel's
`worktreeId` and `"caller": true|false` (only your own panel is `true`;
every row is `false` outside a terminal Cate spawned).

A command acts on, in order: `--panel <id>` (one command only), the panel
you selected for this terminal with `cate panel set <id>`, or Cate's
automatic choice (the calling panel's group, then the panel active in the
most recently used window, then the only panel of that type). The selection
belongs to your terminal, so other agents keep their own:

```bash
cate panel set 5e6f7a8b
cate panel current
cate panel clear             # back to the automatic choice
```

`cate panel current` prints the selected panel, or your own panel when you
selected none, so it is never empty in a Cate terminal (`--json` gives the full
id). To always get your own panel, read the row with `"caller": true` in
`cate panel list --json`.

A command refuses a selected panel of the wrong type instead of acting on
another one. If the selected panel was closed, select another.
`terminal type`, `terminal press` and every `review` command never guess:
they need `--panel` or a selection.

There is no `panel focus`: focus belongs to each person's window, not to the
workspace.

## Panels and editors

```bash
cate panel create browser https://example.com   # the URL is optional
cate panel create editor --file app.tsx
cate panel create terminal
cate panel create canvas
cate panel create review --pr acme/app#8 # a pull request in a review panel (or --pr 8 for the workspace origin)
cate panel title "API tests"             # rename the calling panel (or --panel <id>)
cate panel close <id>                    # fails with dirty on unsaved work or a running program
cate panel close <id> --discard          # drops unsaved work, stops the program
cate editor open src/app.tsx:42          # reuses an editor that already shows the file
cate editor active                       # which file the target editor shows
```

`panel create` and `editor open` print the new panel's short id. New panels
open next to the calling terminal. Only pass `--discard` when the person
agreed to lose that work.

`--pr` takes `owner/repo#N`, a github.com pull request URL, or `N` (the
workspace's GitHub origin; without one, use `owner/repo#N`). Anything else is
refused with `Expected owner/repo#N or N` and no panel is made. There is one
panel per pull request: a second `--pr` for the same one returns the existing
panel's id and does not bring it to the front, since the CLI cannot give focus.
Tell the person where it is instead of assuming they see it.

## Relations

A relation is an arrow from one panel to another that tells the agent at
either end how the two work together. Its kind:

- `trigger`: hand the next task to the target (`cate agent send`).
- `verify`: the target checks the source's result.
- `context`: the source's content goes with the target's prompts.
- `use`: the source uses the target as a tool or resource.

```bash
cate panel link <from> <to>                  # kind: the pair's recommended one (trigger between two agents)
cate panel link <from> <to> --kind verify --label "Run the e2e"
cate panel unlink <from> <to>
cate panel list --json                       # each row's `relations`: its outgoing ones
```

Linking a related pair changes only what you pass (`--label ""` clears the
label). Each pair offers three kinds (between two agents: `trigger`,
`context`, `verify`); another is refused. Only terminals, editors,
browsers and review panels take part; relations never form a cycle, so if
you hand off to an agent with `trigger`, it cannot link back to you: it
answers with `cate agent send`. Refusals fail with `rejected` and say why.
`cate agent start --relation <kind>` links you to the agent it starts
(`references/agents.md`).

## Groups

A group is a titled frame on a canvas that holds panels, with one of four
states: `active`, `waiting`, `blocked`, `done`. Keep one per need so the person
reads the state without opening a panel. A panel is in one group at most; a
tab stack goes in whole. Commands answer with `--json` as `{ frameId, ... }`;
ids take any unique prefix.

```bash
cate panel group create "#n3 cadrage"           # on the canvas of --canvas <panel> if given, else of the calling panel
cate panel group add <group> <panel>            # first free place of the group's grid, nothing else moves
cate panel group remove <panel>                 # out of its group, the group stays
cate panel group state <group> waiting          # active, waiting, blocked or done
cate panel group collapse <group>               # fold into its title bar, panels stay alive
cate panel group expand <group>
cate panel group delete <group>                 # dissolves the group, closes no panel
cate panel group list --json                    # frameId, canvasId, title, state, collapsed, panelIds
```

Run `list` before `create` when resuming work, so you do not make a second
group for the same need. `add` twice is harmless (`moved: false`); a panel in a
window or on another canvas is refused with the reason. Groups need the
Panels permission (Read for `list`, Control for the rest). A title is one line
without control characters, at most 120 characters.

Known limits:

- `--canvas` takes a canvas panel or any panel placed on a canvas, and wins
  over the calling panel's canvas. A panel on no canvas is refused.
- `cate panel group remove` of a panel named `toString` or `__proto__` answers
  ok instead of `gone` (the daemon's panel adapter, older than groups).
- An agent can create up to 200 groups per canvas, act on a group of any canvas
  of the workspace, and move the node of any panel of the canvas by adding it to
  a group (the place is computed for it). That is the power of the Control CLI,
  bounded by the Panels Control setting (`cliPanelControlEnabled`).
- The CLI's operations are not in the person's undo stack.

## Reading terminals

```bash
cate terminal read --lines 40            # another terminal's screen
```

Typing into a terminal is in `references/agents.md`.

## Review panels

Review panels show recorded agent edits grouped by commit, plus uncommitted
edits. They capture what agents reported, not today's Git diff. Use the Review
UI to select sources and start a reviewer in a terminal; findings stay in that
agent's conversation. There are no dedicated Review CLI commands.

Use `cate agent read / send / wait` to collaborate with reviewers. For repository
diffs, staging, commits and pull requests, use `git` and `gh` directly.

## Versions and serving

`cate version` prints the API version the runtime speaks; `cate --version`
the CLI's own. `cate serve [<path>] [--connect]` is for the person: it starts
a workspace with network access on and prints a pairing QR code, so another
device can open it.
