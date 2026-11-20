# Workspace mover for DeepSeek Harness

Move a saved chat from one workspace into another, with its history, without
leaving the shell.

Right-click a chat in the sidebar → **Move to workspace** → pick the target.

## What it does

DSH groups chats by the working directory recorded in each session's immutable
header, and a workspace owns only the sessions whose recorded directory is its
own. That record cannot be rewritten, so a move is a faithful replay:

1. The source log is replayed up to its latest completed turn into a new session
   whose header names the target folder. History, title, model route, and agent
   preset carry over, and the chat continues normally afterwards.
2. The new session is attached to the target workspace, where it appears
   immediately.
3. The original session is archived — the same flag as **Archive** in the row
   menu. It leaves the sidebar grouping but stays complete in the archived list.

A failed replay restores the source and stops the half-created chat, so a move is
all-or-nothing.

## Three ways to run it

| Entry point | How |
| --- | --- |
| Session menu | Right-click the session row (or use its **...** button) → **Move to workspace** → workspace |
| Slash command | `/move-workspace <workspace id, exact title, or absolute path>` |
| Agent tool | `move_chat` with `session` and `workspace` |

The menu offers every other workspace, never the one that already holds the chat,
and skips archived chats. When only one workspace exists there is nothing to
choose, so the row is not shown.

## Install

Requires the DeepSeek Harness desktop app with the workspace-aware sidebar
(tested with the 2026-11 build).

1. Clone or copy this directory somewhere permanent.
2. In DSH open **Plugins → Add plugin** and choose that directory (the plugin
   manager installs a bundle from an absolute package directory).

Manual equivalent, for a profile's `package.json`: add

```json
"@local/workspace-mover": "link:<absolute path to this directory>"
```

to `dependencies` and the same name to `dsh.profile.bundles`.

## Limitations

- **The moved chat gets a new session id.** A copied id, a subagent reference, or
  a schedule bound to the old id keeps pointing at the archived original.
- **The chat must be idle and have at least one completed turn.** A running turn,
  subagent, background job, or active reminder refuses the move and says why; a
  blank chat has no history to replay.
- **The target folder must exist.** A workspace whose directory is gone refuses
  the move before anything is written.
- **Subagent children are not replayed.** Their own sessions stay where they are;
  the moved log still shows the calls and their results.
- **Moving twice leaves archived copies.** Restore one from the archived view to
  bring it back to its original workspace.
- **The moved chat is not opened for you and is not pinned** — pin it again if you
  rely on the pinned section.

`docs/DETAIL.md` describes the behaviour in full.

## Layout

| Path | Contents |
| --- | --- |
| `index.js` | Host half: registers the `/move-workspace` command and the `move_chat` tool |
| `lib/move.js` | The move itself: completed-turn prefix, route and preset folding, replay, rollback |
| `client.js` | Client half: the session menu action, its submenu, its glyph, and the toast |
| `cordis.patch.yml` | Bundle patch that mounts the plugin |
| `locale/*.json` | Plugin metadata: en, zh, ru, ja, es, fr, de, pt |
| `test/move.test.mjs` | Checks over the log folds and over `moveSession` against stub services |

## Tests

```sh
node test/move.test.mjs
```

Prints one line per check and ends with `ALL CHECKS PASSED` (exit code 0) or
`FAILURES: n`.

## License

No license is granted. The source is published for reading and personal use;
copyright stays with the author, and nothing here grants rights beyond GitHub's
Terms of Service. Ask before redistributing.
