// Checks for the move implementation: the pure log folds, then the shipped
// moveSession against stub services. Run with the Electron Node binary:
//   ELECTRON_RUN_AS_NODE=1 "<DeepSeek Harness.exe>" test/move.test.mjs
import path from 'node:path';
import { moveFailure, foldPreset, foldRoute, latestCompletedPrefixBoundary, moveSession }
  from '../lib/move.js';

let failures = 0;

/**
 * Record one expectation.
 * @param {string} label - what is being checked.
 * @param {boolean} condition - outcome.
 * @param {string} detail - extra context on failure.
 */
function check(label, condition, detail = '') {
  if (condition) console.log('ok   ' + label);
  else {
    failures += 1;
    console.log('FAIL ' + label + (detail === '' ? '' : ' — ' + detail));
  }
}

/**
 * Compare one value with its expected JSON shape.
 * @param {string} label - what is being checked.
 * @param {unknown} actual - produced value.
 * @param {unknown} expected - expected value.
 */
function equal(label, actual, expected) {
  check(label, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}`);
}

// ---------------------------------------------------------------- pure folds

const event = (seq, type, extra = {}) => ({ seq, type, time: seq, data: {}, ...extra });

equal('no completed turn yields -1', latestCompletedPrefixBoundary([
  event(0, 'turn/start'),
  event(1, 'user/message', { surfaceOp: 'append' }),
]), -1);

equal('closed turn is the boundary', latestCompletedPrefixBoundary([
  event(0, 'turn/start'), event(1, 'turn/end'),
]), 1);

equal('trailing title event joins the prefix', latestCompletedPrefixBoundary([
  event(0, 'turn/start'), event(1, 'turn/end'), event(2, 'session/title'),
]), 2);

equal('a started command ends the prefix', latestCompletedPrefixBoundary([
  event(0, 'turn/start'), event(1, 'turn/end'), event(2, 'session/title'), event(3, 'command/run'),
]), 2);

equal('a new user message ends the prefix', latestCompletedPrefixBoundary([
  event(0, 'turn/start'), event(1, 'turn/end'), event(2, 'user/message', { surfaceOp: 'append' }),
]), 1);

equal('route folds the newest request header', foldRoute([
  event(0, 'request/header', { data: { header: { config: { provider: 'a', model: 'x' }, adapterDefaults: {} } } }),
  event(1, 'request/header', { data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' }, adapterDefaults: {} } } }),
]), { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' });

equal('adapter-defaulted effort is dropped', foldRoute([
  event(0, 'request/header', { data: { header: { config: { provider: 'p', model: 'm', reasoningEffort: 'low' }, adapterDefaults: { reasoningEffort: true } } } }),
]), { provider: 'p', model: 'm' });

equal('route without a request is undefined', foldRoute([event(0, 'turn/start')]), undefined);

equal('preset folds the last selection', foldPreset([
  event(0, 'agent-preset/selected', { data: { agentPreset: 'standard' } }),
  event(1, 'agent-preset/selected', { data: { agentPreset: 'cordis' } }),
]), 'cordis');

equal('preset stays undefined without a selection', foldPreset([event(0, 'turn/start')]), undefined);

equal('active work becomes an instruction',
  moveFailure({ name: 'WorkspaceActiveSessionError', activity: [{ kind: 'turn' }, { kind: 'schedule' }] }),
  'this chat still has running work (turn, schedule); stop it first');

equal('unknown chat is named plainly',
  moveFailure({ name: 'WorkspaceUnknownSessionError' }), 'no stored chat has that id');

equal('missing folder is named plainly',
  moveFailure({ code: 'ENOENT' }), 'the target workspace folder is missing');

equal('other rejections keep their message',
  moveFailure(new Error('cannot attach session')), 'cannot attach session');

// ------------------------------------------------------------ move operation

const pluginDir = path.resolve(import.meta.dirname, '..');
const sourceId = 'session-source';

const sourceEvents = [
  event(0, 'turn/start'),
  event(1, 'request/header', { data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-flash' }, adapterDefaults: {} } } }),
  event(2, 'user/message', { surfaceOp: 'append' }),
  event(3, 'assistant/message'),
  event(4, 'turn/end'),
  event(5, 'agent-preset/selected', { data: { agentPreset: 'cordis' } }),
  event(6, 'session/title'),
];

/**
 * Build one plugin context whose services record what the move asked them to do.
 * @param {{ cwd?: string, status?: 'ok' | 'missing-dir', attachFails?: boolean, archiveFails?: boolean, gate?: Promise<unknown>, events?: object[] }} options - stub behavior.
 * @returns the context and its recorded effects.
 */
function makeContext(options = {}) {
  const {
    cwd = 'D:\\old\\place',
    status = 'ok',
    attachFails = false,
    archiveFails = false,
    gate,
    events = sourceEvents,
  } = options;
  const calls = [];
  const created = [];
  const mounted = [];
  let disposed = 0;
  const presets = {
    resolve: async id => ({ id: id ?? 'deployment-default' }),
    mount: async (_agentCtx, id) => { mounted.push(id) },
  };
  const target = {
    id: 'workspace-target',
    title: 'Target',
    path: pluginDir,
    sessionIds: [],
    status: async () => status,
    attachSession: async (id) => {
      calls.push(['attach', id]);
      if (attachFails) throw new Error('attach refused');
    },
  };
  const old = {
    id: 'workspace-old',
    title: 'Old',
    path: 'D:\\old',
    sessionIds: [sourceId],
    status: async () => 'ok',
    attachSession: async () => {},
  };
  const ctx = {
    workspaceRegistry: {
      list: () => [target, old],
      get: id => [target, old].find(workspace => workspace.id === id),
      resolveByPath: async () => undefined,
      archiveSession: async (id) => {
        calls.push(['archive', id]);
        if (archiveFails) {
          throw Object.assign(new Error('cannot archive: active'), {
            name: 'WorkspaceActiveSessionError',
            activity: [{ kind: 'turn' }],
          });
        }
      },
      unarchiveSession: async (id) => { calls.push(['unarchive', id]) },
    },
    sessionQuery: {
      readSession: async () => {
        if (gate !== undefined) await gate;
        return {
          session: { id: sourceId, cwd, isSeeded: false, agentPreset: 'standard' },
          inheritedEventCount: 0,
          events,
        };
      },
    },
    agents: {
      create: async (createOptions) => {
        created.push(createOptions);
        calls.push(['create', createOptions.sessionId]);
        return { agent: {}, dispose: async () => { disposed += 1; calls.push(['dispose']) } };
      },
    },
    get: name => (name === 'agentPresets' ? presets : undefined),
  };
  return { ctx, calls, created, mounted, disposed: () => disposed };
}

/** Run one move and return its rejection. */
async function rejectionOf(promise) {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error;
  }
}

{
  const { ctx, calls, created, mounted } = makeContext();
  const result = await moveSession(ctx, { sessionId: sourceId, workspaceRef: 'Target' });
  const order = calls.map(call => call[0]);
  equal('move: archive happens before create', order, ['archive', 'create', 'attach']);
  check('move: new session id is minted', /^session-/u.test(result.sessionId) && result.sessionId !== sourceId);
  check('move: reports both workspaces', result.from === 'Old' && result.to === 'Target', JSON.stringify(result));
  const createOptions = created[0];
  equal('move: header cwd is the target path', createOptions.meta.cwd, pluginDir);
  equal('move: replay stops at the completed turn', createOptions.seed.length, 7);
  check('move: replay is not marked as a fork',
    createOptions.meta.isSeeded === false && createOptions.inheritedEventCount === undefined);
  equal('move: route follows the recorded request', createOptions.agentOptions,
    { provider: 'deepseek-official', model: 'deepseek-flash' });
  equal('move: the switched preset is carried over', createOptions.meta.agentPreset, 'cordis');
  await createOptions.setup({});
  equal('move: setup mounts the carried-over preset', mounted, ['cordis']);
  check('move: the announced agent stays live', !order.includes('dispose'));
}

{
  const { ctx, calls, disposed } = makeContext({ attachFails: true });
  const error = await rejectionOf(moveSession(ctx, { sessionId: sourceId, workspaceRef: 'Target' }));
  const order = calls.map(call => call[0]);
  check('attach failure rejects', error?.message === 'attach refused', error?.message);
  check('attach failure restores the source', order.includes('unarchive'), order.join(','));
  check('attach failure stops the half-created chat', disposed() === 1 && order.includes('dispose'));
}

{
  const { ctx, calls } = makeContext({ archiveFails: true });
  const error = await rejectionOf(moveSession(ctx, { sessionId: sourceId, workspaceRef: 'Target' }));
  check('active chat rejects', error?.name === 'WorkspaceActiveSessionError');
  equal('active chat creates nothing', calls.map(call => call[0]), ['archive']);
}

{
  const { ctx, calls } = makeContext({ cwd: pluginDir });
  const error = await rejectionOf(moveSession(ctx, { sessionId: sourceId, workspaceRef: 'Target' }));
  check('same workspace rejects', /already belongs/u.test(error?.message ?? ''), error?.message);
  equal('same workspace writes nothing', calls, []);
}

{
  const { ctx, calls } = makeContext({ status: 'missing-dir' });
  const error = await rejectionOf(moveSession(ctx, { sessionId: sourceId, workspaceRef: 'Target' }));
  check('missing folder rejects', /folder is missing/u.test(error?.message ?? ''), error?.message);
  equal('missing folder writes nothing', calls, []);
}

{
  let release;
  const gate = new Promise((resolve) => { release = resolve });
  const { ctx } = makeContext({ gate });
  const first = moveSession(ctx, { sessionId: sourceId, workspaceRef: 'Target' });
  const error = await rejectionOf(moveSession(ctx, { sessionId: sourceId, workspaceRef: 'Target' }));
  release();
  await first;
  check('concurrent move rejects', /already being moved/u.test(error?.message ?? ''), error?.message);
}

{
  const { ctx, calls } = makeContext({ events: [event(0, 'turn/start')] });
  const error = await rejectionOf(moveSession(ctx, { sessionId: sourceId, workspaceRef: 'Target' }));
  check('blank chat rejects', /no completed turn/u.test(error?.message ?? ''), error?.message);
  equal('blank chat writes nothing', calls, []);
}

{
  const { ctx, calls } = makeContext();
  const error = await rejectionOf(moveSession(ctx, { sessionId: sourceId, workspaceRef: 'Nowhere' }));
  check('unknown target rejects', /no workspace matches/u.test(error?.message ?? ''), error?.message);
  equal('unknown target writes nothing', calls, []);
}

console.log(failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED');
process.exitCode = failures === 0 ? 0 : 1;
