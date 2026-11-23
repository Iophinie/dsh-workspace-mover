/**
 * Client half of the workspace mover: one Session menu action that lists the
 * other workspaces as a submenu, plus the glyph that action uses.
 *
 * The move itself runs on the Host through the `/move-workspace` command, so
 * the browser never replays a session log.
 */

window.__ModuleLoader__.load({
  id: '@local/workspace-mover',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NAMESPACE = 'workspaceMover'
    const ICON_KEY = 'workspace-mover.move'
    const CONTRIBUTION_ID = 'workspace-mover.session'
    const COMMAND = 'move-workspace'
    const ACTION_ID = 'move-to-workspace'

    const en = {
      action: 'Move to workspace',
      moving: 'Moving to “{workspace}”…',
      moved: 'Moved to “{workspace}”. The original chat is archived.',
      failed: 'Move failed: {reason}',
      unavailable: 'Move failed: the move command is unavailable',
    }
    const zh = {
      action: '移动到工作区',
      moving: '正在移动到“{workspace}”…',
      moved: '已移动到“{workspace}”。原会话已归档。',
      failed: '移动失败：{reason}',
      unavailable: '移动失败：移动命令不可用',
    }
    const ru = {
      action: 'Переместить в рабочее пространство',
      moving: 'Перемещение в «{workspace}»…',
      moved: 'Перемещено в «{workspace}». Исходный чат перемещён в архив.',
      failed: 'Не удалось переместить: {reason}',
      unavailable: 'Не удалось переместить: команда недоступна',
    }
    const ja = {
      action: 'ワークスペースへ移動',
      moving: '「{workspace}」へ移動しています…',
      moved: '「{workspace}」へ移動しました。元のチャットはアーカイブされました。',
      failed: '移動に失敗しました: {reason}',
      unavailable: '移動に失敗しました: 移動コマンドを利用できません',
    }
    const es = {
      action: 'Mover a otro espacio de trabajo',
      moving: 'Moviendo a «{workspace}»…',
      moved: 'Movido a «{workspace}». La conversación original se archivó.',
      failed: 'No se pudo mover: {reason}',
      unavailable: 'No se pudo mover: el comando de movimiento no está disponible',
    }
    const fr = {
      action: 'Déplacer vers un espace de travail',
      moving: 'Déplacement vers « {workspace} »…',
      moved: 'Déplacé vers « {workspace} ». La conversation d’origine est archivée.',
      failed: 'Échec du déplacement : {reason}',
      unavailable: 'Échec du déplacement : la commande est indisponible',
    }
    const de = {
      action: 'In einen Arbeitsbereich verschieben',
      moving: 'Wird nach „{workspace}“ verschoben…',
      moved: 'Nach „{workspace}“ verschoben. Der ursprüngliche Chat ist archiviert.',
      failed: 'Verschieben fehlgeschlagen: {reason}',
      unavailable: 'Verschieben fehlgeschlagen: Der Befehl ist nicht verfügbar',
    }
    const pt = {
      action: 'Mover para outra área de trabalho',
      moving: 'Movendo para “{workspace}”…',
      moved: 'Movido para “{workspace}”. A conversa original foi arquivada.',
      failed: 'Falha ao mover: {reason}',
      unavailable: 'Falha ao mover: o comando de movimentação não está disponível',
    }

    /** Right-pointing arrow against a wall: "continue somewhere else". */
    function MoveGlyph() {
      return h('svg', {
        viewBox: '0 0 16 16',
        width: 14,
        height: 14,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        focusable: false,
        style: { display: 'block', pointerEvents: 'none' },
      },
      h('path', { d: 'M2.5 8h8' }),
      h('path', { d: 'M7.5 5l3 3-3 3' }),
      h('path', { d: 'M13.5 3.5v9' }))
    }

    /**
     * Highlight rectangle for the workspace a dragged chat would land in. The
     * sidebar owns its rows, so the drop feedback is this frame-wide overlay
     * instead of a class on the row.
     */
    const dropHint = (() => {
      let current = null
      const listeners = new Set()
      const emit = () => { for (const listener of [...listeners]) listener() }
      return {
        get: () => current,
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        set(value) {
          current = value
          emit()
        },
      }
    })()

    /** Draw the current drop highlight, or nothing. */
    function DropHint() {
      const rect = React.useSyncExternalStore(dropHint.subscribe, dropHint.get)
      if (rect === null) return null
      return h('div', {
        className: 'wm-drop',
        'aria-hidden': true,
        style: {
          top: `${rect.top}px`,
          left: `${rect.left}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
        },
      },
      h('style', null, '.wm-drop{position:fixed;border-radius:8px;pointer-events:none;z-index:2147481200;'
        + 'background:color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent);'
        + 'box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary);}'))
    }

    /**
     * Render one rejected value as a single line of text.
     * @param {unknown} value - failure from the Remote call.
     * @returns {string} message without a stack.
     */
    function reasonOf(value) {
      if (value instanceof Error) return value.message
      try {
        return String(value)
      } catch {
        return 'unknown failure'
      }
    }

    /**
     * Labels for the offered workspaces, using the shortest trailing path that
     * tells workspaces sharing one title apart.
     * @param {readonly {title: string, path: string}[]} items - offered workspaces.
     * @returns one label per workspace path.
     */
    function targetLabels(items) {
      const byTitle = new Map()
      for (const item of items) {
        const group = byTitle.get(item.title) ?? []
        group.push(item)
        byTitle.set(item.title, group)
      }
      const labels = new Map()
      for (const [title, group] of byTitle) {
        if (group.length === 1) {
          labels.set(group[0].path, title)
          continue
        }
        const segments = group.map(item => item.path.split(/[\\/]+/u).filter(segment => segment !== ''))
        let depth = 1
        while (depth < 6
          && new Set(segments.map(parts => parts.slice(-depth).join('/'))).size < group.length) {
          depth += 1
        }
        group.forEach((item, index) => {
          labels.set(item.path, `${title} — ${segments[index].slice(-depth).join('\\')}`)
        })
      }
      return labels
    }

    return {
      inject: ['slots', 'locale', 'contextMenus', 'workspaces', 'remote', 'remote.commands'],

      /**
       * Register the dictionaries, the menu glyph, and the Session menu action.
       * @param {import('@deepseek-ai/cordis').Context} ctx - client plugin context.
       */
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NAMESPACE, {
          en, zh, ru, ja, es, fr, de, pt,
        }), 'workspace-mover: dictionaries')
        const t = ctx.locale.bind(NAMESPACE)

        ctx.effect(() => ctx.slots.inject('contextMenu.icon', () => ctx.slots.register({
          name: 'contextMenu.icon',
          key: ICON_KEY,
        }, MoveGlyph)), 'workspace-mover: icon')

        /** Sessions with a move in flight, so a second pick cannot duplicate the chat. */
        const pending = new Set()

        /**
         * Run one move for the captured Session and report the outcome as a toast.
         * @param {string} sessionId - Session to move.
         * @param {{ workspaceId: string, title: string }} workspace - chosen target.
         * @returns {Promise<void>} settles after the notice is published.
         */
        const move = async (sessionId, workspace) => {
          if (pending.has(sessionId)) return
          pending.add(sessionId)
          ctx.contextMenus.notify(t('moving', { workspace: workspace.title }), true)
          try {
            let outcome
            try {
              outcome = await ctx.remote.commands.execute(sessionId, `/${COMMAND} ${workspace.workspaceId}`, [])
            } catch (error) {
              ctx.contextMenus.notify(t('failed', { reason: reasonOf(error) }), false)
              return
            }
            if (!outcome.ok) {
              ctx.contextMenus.notify(t('failed', { reason: outcome.error.message }), false)
              return
            }
            if (outcome.value === undefined) {
              ctx.contextMenus.notify(t('unavailable'), false)
              return
            }
            const result = outcome.value.result
            if (result.kind === 'success') {
              ctx.contextMenus.notify(t('moved', { workspace: workspace.title }), true)
            } else {
              // Older Host generations prefix their own text; keep one prefix.
              const reason = typeof result.text === 'string' ? result.text.replace(/^Move failed: /u, '') : ''
              ctx.contextMenus.notify(t('failed', { reason }), false)
            }
          } finally {
            pending.delete(sessionId)
          }
        }

        ctx.effect(() => ctx.contextMenus.register({
          id: CONTRIBUTION_ID,
          target: 'session',
          order: 520,
          observe: () => [ctx.workspaces.list],
          resolve(target) {
            const snapshot = ctx.workspaces.list.getSnapshot()
            if (snapshot.archivedSessionIds.includes(target.sessionId)) return []
            const targets = snapshot.items.filter(item => !item.sessionIds.includes(target.sessionId))
            if (targets.length === 0) return []
            const labels = targetLabels(targets)
            return [{
              id: ACTION_ID,
              label: t('action'),
              icon: { key: ICON_KEY },
              children: targets.map(item => ({
                id: `${ACTION_ID}:${item.workspaceId}`,
                label: labels.get(item.path) ?? item.title,
                run: () => move(target.sessionId, { workspaceId: item.workspaceId, title: item.title }),
              })),
            }]
          },
        }), 'workspace-mover: session menu')

        // The highlight overlay for drag & drop.
        ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'workspace-mover.drop-hint',
          order: 92,
        }, DropHint)), 'workspace-mover: drop hint')

        // Drag a chat row onto another workspace — its header row or any chat
        // inside it — and the same move runs as from the menu. A drop inside the
        // source workspace keeps the sidebar's own reordering.
        const SESSION_PREFIX = 'session:'
        const WORKSPACE_PREFIX = 'workspace:'
        ctx.effect(() => {
          /** Session id being dragged, or null. */
          let dragged = null
          /** Workspace that currently holds a session, from the live snapshot. */
          const workspaceOf = (sessionId) => {
            const snapshot = ctx.workspaces.list.getSnapshot()
            const item = snapshot.items.find(candidate => candidate.sessionIds.includes(sessionId))
            return item === undefined ? undefined : item.workspaceId
          }
          /** The workspace a pointer position would drop into. */
          const targetOf = (event) => {
            if (!(event.target instanceof Element)) return null
            const workspaceRow = event.target.closest('[data-row-key^="workspace:"]')
            if (workspaceRow !== null) {
              const id = (workspaceRow.getAttribute('data-row-key') ?? '').slice(WORKSPACE_PREFIX.length)
              return id === '' ? null : { workspaceId: id, row: workspaceRow }
            }
            const sessionRow = event.target.closest('[data-row-key^="session:"]')
            if (sessionRow === null) return null
            const sessionId = (sessionRow.getAttribute('data-row-key') ?? '').slice(SESSION_PREFIX.length)
            const workspaceId = workspaceOf(sessionId)
            return workspaceId === undefined ? null : { workspaceId, row: sessionRow }
          }
          const onDragStart = (event) => {
            if (!(event.target instanceof Element)) {
              dragged = null
              return
            }
            const row = event.target.closest('[data-row-key]')
            const key = row === null ? null : row.getAttribute('data-row-key')
            dragged = key !== null && key.startsWith(SESSION_PREFIX) ? key.slice(SESSION_PREFIX.length) : null
            dropHint.set(null)
          }
          const onDragOver = (event) => {
            if (dragged === null) return
            const target = targetOf(event)
            if (target === null || target.workspaceId === workspaceOf(dragged)) {
              dropHint.set(null)
              return
            }
            event.preventDefault()
            if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move'
            const rect = target.row.getBoundingClientRect()
            dropHint.set({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
          }
          const onDrop = (event) => {
            if (dragged === null) return
            const target = targetOf(event)
            const sessionId = dragged
            dragged = null
            dropHint.set(null)
            if (target === null || target.workspaceId === workspaceOf(sessionId)) return
            event.preventDefault()
            event.stopPropagation()
            const item = ctx.workspaces.list.getSnapshot().items.find(candidate => candidate.workspaceId === target.workspaceId)
            void move(sessionId, { workspaceId: target.workspaceId, title: item === undefined ? target.workspaceId : item.title })
          }
          const clear = () => {
            dragged = null
            dropHint.set(null)
          }
          document.addEventListener('dragstart', onDragStart, true)
          document.addEventListener('dragover', onDragOver, true)
          document.addEventListener('drop', onDrop, true)
          document.addEventListener('dragend', clear, true)
          return () => {
            document.removeEventListener('dragstart', onDragStart, true)
            document.removeEventListener('dragover', onDragOver, true)
            document.removeEventListener('drop', onDrop, true)
            document.removeEventListener('dragend', clear, true)
            dropHint.set(null)
          }
        }, 'workspace-mover: drag and drop')
      },
    }
  },
})
