# Agents and terminal input

Contents: the loop, starting an agent, model and effort (`--model`,
`--effort`), ending a task (`--done-when`),
sending and waiting, reading answers, typing into terminals.

`cate agent` starts coding agents (terminal CLIs such as Claude Code or
Codex) in their own panels, and observes and steers the live agent panels of
the workspace.

## The loop

```bash
id=$(cate agent start --agent codex --new-worktree fix-login --done-when 'npm test' "Fix the flaky login test")
cate agent wait "$id" --wait-timeout 60000   # repeat while it exits 1 (timed out)
cate agent read "$id"
cate agent send "$id" "Also add a regression test"
```

`wait` returns once every listed panel is ready for a prompt and the prompts
sent to it went out (or one was not taken); a long task needs several calls. After context compaction, `cate agent list` finds the
panel ids again.

## Starting an agent

`start` runs an agent CLI on a prompt in a new terminal panel next to yours
and prints its panel id. `--agent <id>` picks one whose Cate hooks are on;
`cate agent types` lists them. It works in your checkout, an existing
worktree (`--worktree <id>`, from `cate panel list --json`) or a new one
(`--new-worktree <name>`), not both. `--canvas <id>` places it on that canvas
panel's canvas instead. `--title` names the panel permanently; without it the
agent's own session title replaces the prompt-based one.

`--relation <kind>` relates your panel to the new agent (`trigger` to hand
it tasks, `verify` to have it check your work; see Relations in the skill),
`--link-from <id>` relates another panel instead (alone, it uses the pair's
recommended kind). The agent starts even when the relation is refused: the
output adds `(not linked: <reason>)`, `--json` gives `relationError`.

Until the agent CLI is up, the panel is listed as `starting`: `wait` waits
for it, while `send`, `read` and `interrupt` fail with `agent-starting`.
From then on it is an agent panel like any other.

## Model and effort: `--model`, `--effort`

```bash
cate agent start --model sonnet --effort low --title "#n3 verifier" "$(cat BRIEF.md)"
cate agent start --effort high "Fix the flaky login test"
```

Both go to the agent CLI at launch, and each works without the other. `--model` is free text
(the CLI's own model id or alias; Claude Code, Codex, Cursor and OpenCode
take it). `--effort` is declared for Claude Code only (low, medium, high,
xhigh, max). An agent that has no such option, or does not know the level,
refuses the start before anything is created: `effort-unsupported: Codex has
no effort option`. They combine with `--relation` and
`--done-when` in the same command. `cate agent list` shows them in the
MODEL and EFFORT columns (`--json`: `model`, `effort`), blank for an agent
started without. After a runtime restart they are blank again.

## Ending a task: `--done-when`

Before any `cate agent start`, settle the condition that ends the task: take
the one the person gave, or propose a recommended one and have the person
validate it. It must be testable, a shell command that answers yes (exit 0)
or no, never "when the agent says it is done". There are no predefined
kinds: one command covers every case.

```bash
cate agent start --done-when 'gh pr view 2 --json state -q .state | grep -qx MERGED' "$(cat BRIEF.md)"
cate agent start --done-when 'npm test' "Fix the flaky login test"
cate agent start --done-when 'bus read repo:cate | grep -q TERMINÉ' "Write the release notes"
```

After each of the agent's turns, the runtime runs the command in the agent's
checkout (60 s timeout, one run at a time per panel). Exit 0 closes the
agent's panel and its process, and tells your panel (as a prompt if an agent
runs there). A non-zero exit does nothing: it is checked again after the
next turn. The condition survives a runtime restart and is checked once
when the runtime starts again. A timeout or an error leaves the panel open with the reason in
the DONE WHEN column of `cate agent list` (`--json`: `doneWhen.last`).
Without `--done-when` the agent starts anyway and `start` says on stderr:
`no done-when condition: the panel will stay open`; close it yourself with
`cate panel close <id> --discard`.

## Sending and waiting

```bash
cate agent list                                       # live agent panels and their states
cate agent send <panel-id> "Please add the missing regression test"   # prints the prompt id
cate agent wait <panel-id> [<panel-id>...] --wait-timeout 10000
```

Panel ids may be the unique short ids `agent list` prints. `wait` accepts
5000 to 60000 milliseconds and, with no ids, monitors every live agent panel;
it exits 1 when it timed out, after printing the states.

`cate agent usage [--panel <id>] [--json]` shows what each live agent panel's
session has used: `model`, `inputTokens` (cached part included), `outputTokens`
and `costUsd`, the API-equivalent cost from Cate's price table, not money
spent. `costUsd` is null (a dash) when a model has no price. An agent that
records no tokens, or a panel with no session yet, answers null in every field.
It reads one session, so it answers in seconds; it is the whole session, a
resumed one included, and a `/clear` starts a new one.

Send bounded prompts. `send` hands the prompt to the runtime and prints its
id at once, busy agent or not: the runtime types it once the agent is at its
prompt, after the prompts sent before it, one at a time, exactly once. A
person's chat on another device sends through the same path, so their
prompts queue with yours. Each panel's prompts show in `agent list` (the
PROMPTS column) and `agent read` (and `--json` as `prompts`), each `queued`,
`sending` or `failed`; a taken prompt leaves the list and shows as a message.
A prompt typed that started no turn within 10 seconds (the agent showed a
dialog that took the Enter) is `failed` with `agent-prompt-not-taken`: its
text may still be in the agent's input, so nothing more is typed there until
a turn starts (someone pressed Enter) or it is taken back: in the app, or
with `cate agent withdraw <panel-id> <prompt-id>`, which also takes back a
queued prompt and prints its text. Read the failed prompt's screen with
`cate terminal read` and tell the person; withdraw it only once its text is
out of the agent's input. `send` fails
only when no agent can take the prompt: `agent-not-running`,
`agent-starting`, or `no-agent-in-terminal` for a terminal with no agent in
it; type into that instead (below).

## Reading answers

`read` prints the conversation's user and assistant messages, from the agent
CLI's own session store. With `--json`:

```
{ panelId, title, agentId, agentName, state, canReceivePrompt, session,
  messages: [{ role, text, createdAt }],
  prompts: [{ id, text, state, error }] }
```

A terminal whose agent has not reported a session yet fails with
`no-agent-session`; use `cate terminal read` to see its screen instead.

## Typing into terminals

Off by default (Settings → CLI, the Terminal row's Control cell). `type` and
`press` never guess their target: they need `--panel` or a `cate panel set`
selection. Read the screen first, then send:

```bash
cate panel set 1a2b3c4d
cate terminal read --lines 40
cate terminal type npm test          # no Enter appended
cate terminal press enter
```

`press` takes key names: enter, tab, escape, backspace, space, arrows,
pageup/pagedown, home, end, ctrl-<letter>. Input goes to whatever currently
owns that PTY, including full-screen programs, so never send keys until the
panel id and current screen are verified.
