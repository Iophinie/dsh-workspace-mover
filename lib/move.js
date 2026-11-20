/**
 * Moving one chat between workspaces.
 *
 * A DSH workspace owns a canonical directory, and its session account is
 * validated against the immutable `SessionHeader.cwd` of every recorded chat.
 * Neither the header nor the account can be rewritten through a public API, so
 * a move is performed as a faithful replay of the source log into a new session
 * whose header names the target directory, followed by hiding the source from
 * the grouping surfaces with the regular archive flag.
 *
 * @module @local/workspace-mover/lib/move
 */

import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'

/** Slash-command name served by the Host half. */
export const COMMAND_NAME = 'move-workspace'

/** Agent-tool name served by the Host half. */
export const TOOL_NAME = 'move_chat'

/** Standalone tail events that begin interactive work and therefore end the replayable prefix. */
const INTERACTIVE_EVENTS = new Set(['turn/start', 'command/run', 'agent/inbox/spliced'])

/** Moves running in this Host process, keyed by source session. */
const inFlight = new Set()

/**
 * Inclusive seq of the latest completed-turn prefix, including standalone
 * events after it until something starts new work.
 * @param events - complete source log in seq order.
 * @returns the boundary seq, or -1 when the log holds no completed turn.
 */
export function latestCompletedPrefixBoundary(events) {
  let boundary = -1
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].type === 'turn/end') {
      boundary = index
      break
    }
  }
  if (boundary < 0) return -1
  for (let index = boundary + 1; index < events.length; index += 1) {
    const event = events[index]
    if (INTERACTIVE_EVENTS.has(event.type)) break
    if (event.type === 'user/message' && event.surfaceOp === 'append') break
    boundary = index
  }
  return boundary
}

/**
 * Fold the newest `request/header` event into the route the replayed chat continues on.
 * @param events - source log in seq order.
 * @returns provider, model, effort, and token limit, or undefined when no request was recorded.
 */
export function foldRoute(events) {
  let header
  for (const event of events) {
    if (event.type === 'request/header') header = event.data?.header
  }
  const config = header?.config
  if (config === undefined || typeof config.provider !== 'string' || typeof config.model !== 'string') return undefined
  const effort = header.adapterDefaults?.reasoningEffort === true ? undefined : config.reasoningEffort
  return {
    provider: config.provider,
    model: config.model,
    ...(typeof effort === 'string' ? { reasoningEffort: effort } : {}),
    ...(typeof config.maxTokens === 'number' ? { maxTokens: config.maxTokens } : {}),
  }
}

/**
 * The agent preset in force after the last recorded preset selection.
 *
 * A chat may be switched to another preset mid-conversation; the durable
 * selection event, not the header field written at creation, decides the
 * composition the conversation continues with.
 *
 * @param events - source log in seq order.
 * @returns the selected preset id, or undefined when the chat never switched.
 */
export function foldPreset(events) {
  let preset
  for (const event of events) {
    if (event.type === 'agent-preset/selected' && typeof event.data?.agentPreset === 'string') {
      preset = event.data.agentPreset
    }
  }
  return preset
}

/**
 * Render a thrown value as one line of user-facing text.
 * @param value - whatever a service rejected with.
 * @returns the message without a stack trace.
 */
export function reasonOf(value) {
  if (value instanceof Error) return value.message
  try {
    return String(value)
  } catch {
    return 'unknown failure'
  }
}

/**
 * Turn a rejected move into an actionable sentence without service vocabulary.
 * @param error - rejection from the registry, the query, or the agent factory.
 * @returns user-facing reason.
 */
export function moveFailure(error) {
  if (error !== null && typeof error === 'object') {
    if (Array.isArray(error.activity)) {
      const kinds = error.activity
        .map(entry => entry?.kind)
        .filter(kind => typeof kind === 'string')
      return kinds.length === 0
        ? 'this chat still has running work; stop it first'
        : `this chat still has running work (${kinds.join(', ')}); stop it first`
    }
    if (error.name === 'WorkspaceUnknownSessionError') return 'no stored chat has that id'
    if (error.code === 'ENOENT') return 'the target workspace folder is missing'
  }
  return reasonOf(error)
}

/**
 * Resolve one workspace reference: an exact id, a directory path, or an exact title.
 * @param registry - the mounted `workspaceRegistry` service.
 * @param reference - user- or model-supplied target.
 * @returns the matched workspace.
 * @throws when nothing matches or a title is ambiguous.
 */
export async function resolveWorkspace(registry, reference) {
  const value = typeof reference === 'string' ? reference.trim() : ''
  if (value === '') throw new Error('no target workspace was given')
  const byId = registry.get(value)
  if (byId !== undefined) return byId
  if (/[\\/]/.test(value)) {
    const byPath = await registry.resolveByPath(value).catch(() => undefined)
    if (byPath !== undefined) return byPath
  }
  const wanted = value.toLowerCase()
  const matches = registry.list().filter(workspace =>
    workspace.title.toLowerCase() === wanted || workspace.path.toLowerCase() === wanted)
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) throw new Error(`workspace "${value}" is ambiguous; name it by id instead`)
  throw new Error(`no workspace matches "${value}"`)
}

/**
 * The workspace whose account currently holds one session.
 * @param registry - the mounted `workspaceRegistry` service.
 * @param sessionId - session to locate.
 * @returns that workspace, or undefined for an ungrouped session.
 */
export function workspaceOf(registry, sessionId) {
  return registry.list().find(workspace => workspace.sessionIds.includes(sessionId))
}

/**
 * Compose the preset and route a replayed chat continues with.
 * @param ctx - plugin context.
 * @param sourcePreset - preset in force in the source chat.
 * @param route - route folded from the source log.
 * @returns setup callback, preset id, and fallback route.
 */
async function compose(ctx, sourcePreset, route) {
  const presets = ctx.get('agentPresets')
  let agentOptions = route
  if (agentOptions === undefined) {
    try {
      agentOptions = ctx.get('agentDefaultModel')?.currentSelection()
    } catch {
      agentOptions = undefined
    }
  }
  if (presets === undefined) return { agentOptions }
  let preset
  try {
    preset = await presets.resolve(sourcePreset)
  } catch {
    preset = await presets.resolve(undefined)
  }
  return {
    agentOptions,
    agentPreset: preset.id,
    setup: async (agentCtx) => { await presets.mount(agentCtx, preset.id) },
  }
}

/**
 * Replay one chat into another workspace and hide the original from grouping.
 *
 * The source is archived before the replay so running work refuses the move
 * without creating anything; a failed replay restores the source's visibility
 * and stops the half-created chat.
 *
 * @param ctx - plugin context carrying the agent, query, and registry services.
 * @param request - source session, target workspace reference, and cancellation.
 * @returns the new session identity and both workspace titles.
 * @throws when the source is unknown, running, empty, or already in the target.
 */
export async function moveSession(ctx, request) {
  if (inFlight.has(request.sessionId)) throw new Error('this chat is already being moved')
  inFlight.add(request.sessionId)
  try {
    return await replay(ctx, request)
  } finally {
    inFlight.delete(request.sessionId)
  }
}

/**
 * One guarded move: validate, archive the source, replay, attach, or roll back.
 * @param ctx - plugin context.
 * @param request - source session, target workspace reference, and cancellation.
 * @returns the new session identity and both workspace titles.
 */
async function replay(ctx, request) {
  const registry = ctx.workspaceRegistry
  const target = await resolveWorkspace(registry, request.workspaceRef)
  const snapshot = await ctx.sessionQuery.readSession(request.sessionId)
  const header = snapshot.session
  if (header.origin === 'subagent') throw new Error('a subagent chat cannot be moved between workspaces')
  if (typeof header.cwd !== 'string' || header.cwd === '') throw new Error('the chat recorded no working directory')
  const boundary = latestCompletedPrefixBoundary(snapshot.events)
  if (boundary < 0) throw new Error('the chat has no completed turn yet, so it has no history to move')
  if (await target.status() !== 'ok') throw new Error(`the target workspace folder is missing: ${target.path}`)
  let sourcePath
  try {
    sourcePath = await realpath(header.cwd)
  } catch {
    sourcePath = undefined
  }
  if (sourcePath === target.path) throw new Error(`the chat already belongs to workspace "${target.title}"`)

  const previous = workspaceOf(registry, request.sessionId)
  const composition = await compose(
    ctx,
    foldPreset(snapshot.events) ?? header.agentPreset,
    foldRoute(snapshot.events),
  )
  const seed = snapshot.events.slice(0, boundary + 1).map(event => ({ ...event }))

  await registry.archiveSession(request.sessionId)
  const sessionId = `session-${randomUUID()}`
  let handle
  try {
    handle = await ctx.agents.create({
      sessionId,
      seed,
      ...header.isSeeded === true ? { inheritedEventCount: snapshot.inheritedEventCount } : {},
      meta: {
        cwd: target.path,
        isSeeded: header.isSeeded === true,
        ...composition.agentPreset === undefined ? {} : { agentPreset: composition.agentPreset },
      },
      ...composition.agentOptions === undefined ? {} : { agentOptions: composition.agentOptions },
      ...composition.setup === undefined ? {} : { setup: composition.setup },
      ...request.signal === undefined ? {} : { signal: request.signal },
    })
    await target.attachSession(sessionId)
  } catch (error) {
    if (handle !== undefined) await handle.dispose().catch(() => {})
    await registry.unarchiveSession(request.sessionId).catch(() => {})
    throw error
  }
  // The announced agent stays live on purpose: its session row is what appears
  // in the target workspace without a reload.
  return {
    sessionId,
    from: previous?.title ?? '',
    to: target.title,
    path: target.path,
  }
}
