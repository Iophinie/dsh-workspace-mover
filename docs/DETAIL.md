# Workspace mover

Move a chat from one workspace to another without leaving the shell.

## Where it lives

The action sits in the Session row menu of the sidebar — the same menu as **Pin**,
**Rename**, **Fork**, and **Archive**, reachable from both the row's **...** button
and a right-click on the row. It appears as **Move to workspace** with the other
workspaces as a submenu. The workspace that already holds the chat is not offered,
and an archived chat shows no action. With a single registered workspace there is
nothing to choose, so the row is not shown either.

The same operation is available as the `/move-workspace` slash command
(for example `/move-workspace Джарвис`) and as the `move_chat` agent tool.

## What a move does

DSH groups chats by the working directory recorded in each session's immutable
header, and a workspace only owns sessions whose recorded directory is its own
path. That record cannot be rewritten, so a move is a faithful replay:

1. The source chat's log is replayed up to its latest completed turn into a new
   session whose header names the target workspace directory. The history, the
   title, the model route, and the agent preset carry over; the chat continues
   normally afterwards.
2. The new session is attached to the target workspace, so it appears there
   immediately, first in the workspace's manual order.
3. The original session is archived — the same flag as **Archive** in the row
   menu. It leaves the sidebar grouping but stays complete in the archived list
   and can be restored at any time.

A success notice names the target workspace and says that the original is
archived; a failure notice gives the reason and leaves everything as it was.

## After the move

- The chat is **not** opened for you. It is waiting in the target workspace, and
  the original leaves the sidebar (if it was open, the view leaves it).
- The original's **pin is dropped** by archiving, and the moved chat is not
  pinned; pin it again if you rely on the pinned section.
- The chat's working directory is now the target folder: earlier messages still
  refer to paths from the old folder, and new work happens in the new one.

## Limitations

- **The moved chat has a new session id.** Links to the old id — a copied session
  id, a subagent that referenced it, a schedule bound to it — keep pointing at the
  archived original. A schedule that is still active also refuses the move,
  because archiving refuses while a session runs work.
- **The chat must be idle and have at least one completed turn.** A chat with a
  running turn, a running subagent, a background job, or an active reminder is
  refused with the reason; a blank chat has no history to replay.
- **The target folder must exist.** A workspace whose directory is gone refuses
  the move before anything is written.
- **Children are not replayed.** If the chat started subagents, their own sessions
  stay where they are; the moved log still shows the calls and their results.
- **The original is archived, not deleted.** Moving twice leaves a trail of
  archived copies; restore one from the archived view to bring it back to its
  original workspace (it is then a second copy again).
