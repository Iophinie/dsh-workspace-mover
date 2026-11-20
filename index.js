/**
 * Host half of the workspace mover: one move operation, reachable from the
 * sidebar menu through a slash command and from the model through a tool.
 * @module @local/workspace-mover
 */

import {
  COMMAND_NAME,
  TOOL_NAME,
  moveFailure,
  moveSession,
} from './lib/move.js'

/** Services this plugin cannot work without. */
export const inject = ['agents', 'commands', 'sessionQuery', 'tools', 'workspaceRegistry']

/**
 * Register the command and the tool that share one move implementation.
 * @param ctx - plugin context.
 */
export function apply(ctx) {
  /**
   * Name the workspace the chat moved into, and where it came from.
   * @param result - completed move.
   * @returns user-facing summary.
   */
  const summary = (result) => {
    const from = result.from === '' ? '' : ` from “${result.from}”`
    return `Moved to workspace “${result.to}”${from}`
  }

  ctx.effect(() => ctx.commands.register({
    name: COMMAND_NAME,
    description: 'Move this chat to another workspace, continuing it there',
    input: { hint: '<workspace>' },
    handler: async ({ agent, rawInput, signal }) => {
      try {
        const result = await moveSession(ctx, {
          sessionId: agent.session.id,
          workspaceRef: rawInput,
          signal,
        })
        return { kind: 'success', text: summary(result) }
      } catch (error) {
        return { kind: 'error', text: moveFailure(error) }
      }
    },
  }), 'workspace-mover: command')

  ctx.effect(() => ctx.tools.register({
    name: TOOL_NAME,
    description: [
      'Move one saved chat into another workspace.',
      'The chat continues there with its complete history in a new session id;',
      'the original session is archived, so it leaves the sidebar grouping and',
      'can be restored from the archived list. The chat must be idle and contain',
      'at least one completed turn.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        session: {
          type: 'string',
          description: 'Id of the chat to move.',
        },
        workspace: {
          type: 'string',
          description: 'Target workspace id, exact title, or absolute directory path.',
        },
      },
      required: ['session', 'workspace'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          from: { type: 'string' },
          to: { type: 'string' },
        },
        required: ['sessionId', 'from', 'to'],
        additionalProperties: false,
      },
      render(_args, value) {
        const from = value.from === '' ? '' : ` (was “${value.from}”)`
        return [{
          type: 'text',
          text: `Moved the chat to workspace “${value.to}”${from} as ${value.sessionId}; `
            + 'the original session is archived.',
        }]
      },
    },
    async execute(args, exec) {
      const session = typeof args?.session === 'string' ? args.session.trim() : ''
      const workspace = typeof args?.workspace === 'string' ? args.workspace.trim() : ''
      if (session === '') throw new Error('"session" must be a non-empty session id')
      if (workspace === '') throw new Error('"workspace" must name a workspace')
      if (exec.agent === undefined) throw new Error('the caller identity is unavailable')
      if (exec.agent.session.id === session) {
        throw new Error('a chat cannot move itself while it is running its own turn')
      }
      const result = await moveSession(ctx, {
        sessionId: session,
        workspaceRef: workspace,
        signal: exec.signal,
      })
      return { sessionId: result.sessionId, from: result.from, to: result.to }
    },
  }), 'workspace-mover: tool')
}
