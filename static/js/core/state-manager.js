/**
 * State Manager — Universal client-side state management
 * =======================================================
 * Factory pattern. One instance per page/editor context.
 *
 * Flow:
 *   dispatch(type, data)   → marks dirty, pushes undo stack
 *   undo() / redo()        → walks the stack, keeps dirty
 *   saveDraft()            → calls your saveDraftFn, sets draftSaved = true
 *                            → enables Publish, disables Save Draft
 *   publish()              → calls publishEndpoint with changelist
 *                            → clears all stacks, draftSaved = false
 *   discardChanges()       → undoes everything, clears stacks
 *
 * Button state rules:
 *   Undo        enabled when undoStack.length > 0
 *   Redo        enabled when redoStack.length > 0
 *   Save Draft  enabled when hasChanges() && !draftSaved
 *   Discard     enabled when hasChanges()
 *   Publish     enabled when draftSaved && !isPublishing
 *
 * Usage:
 * ------
 *   const sm = window.StateManager.create('species-mixer', {
 *     entityType: 'SpeciesMix',
 *     entityId: 42,
 *     publishEndpoint: '/species/mixer/api/mixes/42/publish/',
 *     // Called when user hits Save Draft — must return a Promise
 *     saveDraftFn: () => mixer.saveMixToServer(),
 *   });
 *
 *   sm.registerActionType('mix:updateGoal', {
 *     execute: ({ field, value }) => { mixer.goals[field] = value; mixer.updateGoalUI(); },
 *     undo:    ({ field, prev  }) => { mixer.goals[field] = prev;  mixer.updateGoalUI(); },
 *     describe: ({ field, value }) => `Set ${field} to ${value}`,
 *   });
 *
 *   // Dispatch a reversible action (marks dirty automatically)
 *   sm.dispatch('mix:updateGoal', {
 *     executeData: { field: 'erosion', value: 75 },
 *     undoData:    { field: 'erosion', prev: 50 },
 *     entityRef:   { model: 'SpeciesMix', field: 'goal_erosion' },
 *   });
 *
 *   // Bind the state_manager.html component buttons (pass sm_id prefix)
 *   sm.bindToolbar('species-mixer');   // wires #species-mixer-sm-undo, etc.
 *
 * Generic helpers for common field edits:
 *   sm.dispatchFieldChange(obj, field, newVal, {model, label})
 *     → automatically reads the current value as oldVal, dispatches update
 *
 *   sm.dispatchToggle(obj, field, {model, label})
 *     → flips a boolean field, dispatches update
 *
 * Events dispatched on document:
 *   stateManager:change   → detail: getState()
 *   stateManager:publish  → detail: { managerId, entityType, entityId, result }
 */
(function () {
  'use strict';

  const instances = new Map();

  function generateActionId() {
    return 'action_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  function getCsrfToken() {
    const name = 'csrftoken';
    for (let cookie of document.cookie.split(';')) {
      cookie = cookie.trim();
      if (cookie.startsWith(name + '=')) return cookie.substring(name.length + 1);
    }
    return null;
  }

  // ──────────────────────────────────────────────────────────────────────────
  class StateManagerInstance {
    /**
     * @param {string} id
     * @param {Object} config
     * @param {string}   config.publishEndpoint   - POST URL for publish
     * @param {string}   config.entityType        - e.g. 'SpeciesMix'
     * @param {*}        config.entityId           - DB id of the entity
     * @param {Function} config.saveDraftFn        - async fn() → must resolve when save is done
     */
    constructor(id, config = {}) {
      this.id = id;
      this.config = {
        publishEndpoint: '/api/state/publish/',
        entityType: null,
        entityId: null,
        saveDraftFn: null,
        /**
         * changelogConfig — array of summary items shown in the publish modal.
         * Each entry: { label: string, icon: string (bi class), countFn: () => number|string }
         *
         * Example for species mixer:
         *   changelogConfig: [
         *     { label: 'species in mix', icon: 'bi-flower1', countFn: () => mixer.mixItems.length },
         *   ]
         */
        changelogConfig: [],
        ...config,
      };

      this.actionTypes  = new Map();
      this.actionQueue  = [];
      this.undoStack    = [];
      this.redoStack    = [];
      this.draftSaved   = false;
      this.isPublishing = false;
      this.isSavingDraft = false;
      this.boundButtons = {};    // role → HTMLElement
      this._dirtyDot    = null;  // optional dot element

      this._setupKeyboard();
      this._setupBeforeUnload();
    }

    // ── Action type registration ─────────────────────────────────────────

    /**
     * Register a reversible action type.
     * @param {string} type
     * @param {{ execute, undo, [redo], describe }} handlers
     */
    registerActionType(type, handlers) {
      if (!handlers.execute || !handlers.undo || !handlers.describe) {
        console.error(`StateManager "${this.id}": action type "${type}" missing execute/undo/describe`);
        return;
      }
      this.actionTypes.set(type, {
        execute:  handlers.execute,
        undo:     handlers.undo,
        redo:     handlers.redo || handlers.execute,
        describe: handlers.describe,
      });
    }

    // ── Generic helpers ──────────────────────────────────────────────────

    /**
     * Dispatch a reversible field-change action.
     * Reads the current value from obj[field] as the undo value automatically.
     *
     * @param {Object}  obj       - The object being mutated (e.g. mixer.goals)
     * @param {string}  field     - Property name on obj
     * @param {*}       newVal    - The new value to set
     * @param {Object}  [meta]    - { model, label } for the changelist
     *
     * Example:
     *   sm.dispatchFieldChange(this.goals, 'erosion', 75, { model: 'SpeciesMix', label: 'Erosion goal' });
     */
    dispatchFieldChange(obj, field, newVal, meta = {}) {
      const prevVal = obj[field];
      if (prevVal === newVal) return; // no-op

      const actionType = '_field:update';
      if (!this.actionTypes.has(actionType)) {
        this.registerActionType(actionType, {
          execute:  ({ obj, field, val }) => { obj[field] = val; },
          undo:     ({ obj, field, val }) => { obj[field] = val; },
          describe: ({ label, val })      => `${label || field} → ${val}`,
        });
      }

      this.dispatch(actionType, {
        executeData: { obj, field, val: newVal,  label: meta.label || field },
        undoData:    { obj, field, val: prevVal, label: meta.label || field },
        entityRef:   { model: meta.model || null, field },
      });
    }

    /**
     * Dispatch a reversible boolean toggle action.
     * @param {Object}  obj    - Object containing the boolean field
     * @param {string}  field  - Property name
     * @param {Object}  [meta] - { model, label }
     */
    dispatchToggle(obj, field, meta = {}) {
      this.dispatchFieldChange(obj, field, !obj[field], meta);
    }

    // ── Core command pattern ─────────────────────────────────────────────

    /**
     * Execute and record a reversible action.
     * @param {string} type
     * @param {{ executeData, undoData, [entityRef] }} actionData
     * @returns {Object|null} created action object, or null on failure
     */
    dispatch(type, actionData) {
      const handler = this.actionTypes.get(type);
      if (!handler) {
        console.error(`StateManager "${this.id}": unknown action type "${type}"`);
        return null;
      }

      const action = {
        id:          generateActionId(),
        type,
        timestamp:   Date.now(),
        executeData: actionData.executeData,
        undoData:    actionData.undoData,
        entityRef:   actionData.entityRef || null,
        description: handler.describe(actionData.executeData),
        state:       'executed',
      };

      try {
        handler.execute(actionData.executeData);
      } catch (err) {
        console.error(`StateManager "${this.id}": execute failed for "${type}"`, err);
        return null;
      }

      this.actionQueue.push(action);
      this.undoStack.push(action);
      this.redoStack = [];
      this.draftSaved = false;
      this._emitStateChange();
      return action;
    }

    undo() {
      if (!this.undoStack.length) return false;
      const action  = this.undoStack.pop();
      const handler = this.actionTypes.get(action.type);
      if (!handler) { this.undoStack.push(action); return false; }
      try {
        handler.undo(action.undoData);
        action.state = 'undone';
        this.redoStack.push(action);
        this.draftSaved = false;
        this._emitStateChange();
        return true;
      } catch (err) {
        console.error(`StateManager "${this.id}": undo failed for "${action.type}"`, err);
        this.undoStack.push(action);
        return false;
      }
    }

    redo() {
      if (!this.redoStack.length) return false;
      const action  = this.redoStack.pop();
      const handler = this.actionTypes.get(action.type);
      if (!handler) { this.redoStack.push(action); return false; }
      try {
        handler.redo(action.executeData);
        action.state = 'executed';
        this.undoStack.push(action);
        this.draftSaved = false;
        this._emitStateChange();
        return true;
      } catch (err) {
        console.error(`StateManager "${this.id}": redo failed for "${action.type}"`, err);
        this.redoStack.push(action);
        return false;
      }
    }

    // ── Save Draft ───────────────────────────────────────────────────────

    /**
     * Save the current state locally (to server as draft).
     * Calls config.saveDraftFn if provided; otherwise just marks draftSaved.
     * Publish becomes available only after a successful save draft.
     */
    async saveDraft() {
      if (!this.hasChanges() || this.isSavingDraft) return;
      this.isSavingDraft = true;
      this._emitStateChange();

      try {
        if (typeof this.config.saveDraftFn === 'function') {
          await this.config.saveDraftFn();
        }
        this.draftSaved = true;
        if (window.showToast) window.showToast('Draft saved', 'success');
      } catch (err) {
        console.error(`StateManager "${this.id}": saveDraft failed`, err);
        if (window.showToast) window.showToast('Failed to save draft', 'error');
      } finally {
        this.isSavingDraft = false;
        this._emitStateChange();
      }
    }

    // ── Discard ──────────────────────────────────────────────────────────

    /**
     * Show a confirmation modal before discarding. Called by the toolbar button.
     * Use _executeDiscard() to discard without confirmation (e.g. from nav-away flow).
     */
    discardChanges() {
      const modal = document.getElementById(this.id + '-sm-discard-modal');
      if (!modal) { this._executeDiscard(); return; }

      // Update count label
      const countEl = document.getElementById(this.id + '-sm-dm-count');
      if (countEl) {
        const n = this.actionQueue.filter(a => a.state === 'executed').length;
        countEl.textContent = n === 1 ? '1' : `${n}`;
      }

      const bsModal = bootstrap.Modal.getOrCreateInstance(modal);
      bsModal.show();

      // Wire confirm once (re-bind each open to avoid stacking listeners)
      const confirmBtn = document.getElementById(this.id + '-sm-dm-confirm');
      if (confirmBtn) {
        const handler = () => {
          bsModal.hide();
          this._executeDiscard();
          confirmBtn.removeEventListener('click', handler);
        };
        confirmBtn.addEventListener('click', handler);
        // Clean up if modal dismissed without confirming
        modal.addEventListener('hidden.bs.modal', () => {
          confirmBtn.removeEventListener('click', handler);
        }, { once: true });
      }
    }

    /** Immediately discard all changes — no confirmation. */
    _executeDiscard() {
      while (this.undoStack.length) {
        const action  = this.undoStack.pop();
        const handler = this.actionTypes.get(action.type);
        if (handler) {
          try { handler.undo(action.undoData); } catch (_) {}
        }
      }
      this.actionQueue  = [];
      this.undoStack    = [];
      this.redoStack    = [];
      this.draftSaved   = false;
      this._emitStateChange();
      if (window.showToast) window.showToast('Changes discarded', 'info');
    }

    // ── Publish ──────────────────────────────────────────────────────────

    /**
     * Publish all saved-draft changes to the server.
     * Requires draftSaved = true (call saveDraft first).
     */
    async publish() {
      if (!this.draftSaved || this.isPublishing) return { success: false };
      this.isPublishing = true;
      this._emitStateChange();

      const executedActions = this.actionQueue.filter(a => a.state === 'executed');
      const payload = {
        entity_type: this.config.entityType,
        entity_id:   this.config.entityId,
        actions:     executedActions.map(a => ({
          type:        a.type,
          executeData: a.executeData,
          entityRef:   a.entityRef,
          description: a.description,
          timestamp:   a.timestamp,
        })),
        changelist: this.getChangelist(),
      };

      try {
        const res  = await fetch(this.config.publishEndpoint, {
          method:  'POST',
          headers: {
            'Content-Type':     'application/json',
            'X-CSRFToken':      getCsrfToken(),
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify(payload),
        });
        const result = await res.json();

        if (result.success) {
          this.actionQueue = [];
          this.undoStack   = [];
          this.redoStack   = [];
          this.draftSaved  = false;
          if (window.showToast) window.showToast(result.message || 'Published successfully', 'success');
          document.dispatchEvent(new CustomEvent('stateManager:publish', {
            detail: { managerId: this.id, entityType: this.config.entityType, entityId: this.config.entityId, result },
          }));
        } else {
          if (window.showToast) window.showToast(result.error || 'Failed to publish', 'error');
        }

        this.isPublishing = false;
        this._emitStateChange();
        return result;

      } catch (err) {
        console.error(`StateManager "${this.id}": publish failed`, err);
        this.isPublishing = false;
        this._emitStateChange();
        if (window.showToast) window.showToast('Failed to publish changes', 'error');
        return { success: false, error: err.message };
      }
    }

    // ── State queries ────────────────────────────────────────────────────

    hasChanges()    { return this.actionQueue.some(a => a.state === 'executed'); }
    canUndo()       { return this.undoStack.length > 0; }
    canRedo()       { return this.redoStack.length > 0; }
    canSaveDraft()  { return this.hasChanges() && !this.draftSaved && !this.isSavingDraft; }
    canDiscard()    { return this.hasChanges(); }
    canPublish()    { return this.draftSaved && !this.isPublishing; }

    getState() {
      return {
        managerId:    this.id,
        canUndo:      this.canUndo(),
        canRedo:      this.canRedo(),
        canSaveDraft: this.canSaveDraft(),
        canDiscard:   this.canDiscard(),
        canPublish:   this.canPublish(),
        hasChanges:   this.hasChanges(),
        draftSaved:   this.draftSaved,
        isPublishing: this.isPublishing,
        isSavingDraft: this.isSavingDraft,
        changeCount:  this.actionQueue.filter(a => a.state === 'executed').length,
      };
    }

    getChangelist() {
      const executed = this.actionQueue.filter(a => a.state === 'executed');
      const byModel  = {};
      executed.forEach(a => {
        const m = a.entityRef?.model || 'Unknown';
        if (!byModel[m]) byModel[m] = { adds: 0, updates: 0, deletes: 0 };
        if (a.type.includes(':add') || a.type.includes(':create')) byModel[m].adds++;
        else if (a.type.includes(':delete') || a.type.includes(':remove')) byModel[m].deletes++;
        else byModel[m].updates++;
      });
      return {
        summary: { total: executed.length, byModel },
        changes: executed.map(a => ({
          id: a.id, model: a.entityRef?.model || 'Unknown',
          field: a.entityRef?.field || null, type: a.type,
          description: a.description, timestamp: a.timestamp,
          icon: this._getActionIcon(a.type),
        })),
      };
    }

    // ── Button binding ───────────────────────────────────────────────────

    /**
     * Bind buttons by explicit ID map.
     * @param {{ undo?, redo?, saveDraft?, discard?, publish?, dirtyDot? }} buttonIds
     */
    bindButtons(buttonIds) {
      for (const [role, id] of Object.entries(buttonIds)) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (role === 'dirtyDot') { this._dirtyDot = el; continue; }
        this.boundButtons[role] = el;
        switch (role) {
          case 'undo':      el.addEventListener('click', () => this.undo()); break;
          case 'redo':      el.addEventListener('click', () => this.redo()); break;
          case 'saveDraft': el.addEventListener('click', () => this.saveDraft()); break;
          case 'discard':   el.addEventListener('click', () => this.discardChanges()); break;
          case 'publish':   el.addEventListener('click', () => this._showPublishModal()); break;
        }
      }
      this._updateBoundButtons();
    }

    /**
     * Convenience: bind all buttons from the state_manager.html component
     * using the sm_id prefix convention.
     *
     * Given sm_id='species-mixer', wires:
     *   #species-mixer-sm-undo
     *   #species-mixer-sm-redo
     *   #species-mixer-sm-save-draft
     *   #species-mixer-sm-discard
     *   #species-mixer-sm-publish
     *   #species-mixer-sm-dirty-dot
     *
     * @param {string} smId  - matches the sm_id used in {% include state_manager.html %}
     */
    bindToolbar(smId) {
      this.bindButtons({
        undo:      smId + '-sm-undo',
        redo:      smId + '-sm-redo',
        saveDraft: smId + '-sm-save-draft',
        discard:   smId + '-sm-discard',
        publish:   smId + '-sm-publish',
        dirtyDot:  smId + '-sm-dirty-dot',
      });
    }

    destroy() {
      window.removeEventListener('beforeunload', this._beforeUnloadHandler);
      document.removeEventListener('keydown', this._keydownHandler);
      if (this._linkClickHandler) {
        document.removeEventListener('click', this._linkClickHandler, true);
      }
      this.actionQueue = []; this.undoStack = []; this.redoStack = [];
      this.actionTypes.clear(); this.boundButtons = {};
    }

    // ── Private ──────────────────────────────────────────────────────────

    _setupBeforeUnload() {
      // Native beforeunload fallback (e.g. tab close, hard reload — can't intercept with modal)
      this._beforeUnloadHandler = (e) => {
        if (this.hasChanges()) {
          e.preventDefault();
          e.returnValue = '';
          return '';
        }
      };
      window.addEventListener('beforeunload', this._beforeUnloadHandler);

      // In-page link navigation — intercept <a> clicks when dirty
      this._linkClickHandler = (e) => {
        if (!this.hasChanges()) return;
        const anchor = e.target.closest('a[href]');
        if (!anchor) return;
        const href = anchor.getAttribute('href');
        // Ignore anchors, javascript:, modals, and same-page hash links
        if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
        // Ignore Bootstrap data-bs-* triggers (modal openers etc.)
        if (anchor.dataset.bsToggle || anchor.dataset.bsDismiss) return;

        e.preventDefault();
        this._showNavAwayModal(href);
      };
      document.addEventListener('click', this._linkClickHandler, true);
    }

    _showNavAwayModal(pendingHref) {
      const modal = document.getElementById(this.id + '-sm-navaway-modal');
      if (!modal) {
        // No modal — fall back to browser confirm
        if (confirm('You have unsaved changes. Leave anyway?')) window.location.href = pendingHref;
        return;
      }

      const bsModal = bootstrap.Modal.getOrCreateInstance(modal);
      bsModal.show();

      const discardBtn = document.getElementById(this.id + '-sm-na-discard');
      const saveBtn    = document.getElementById(this.id + '-sm-na-save');

      const cleanup = () => {
        discardBtn?.removeEventListener('click', onDiscard);
        saveBtn?.removeEventListener('click', onSave);
      };
      modal.addEventListener('hidden.bs.modal', cleanup, { once: true });

      const onDiscard = () => {
        bsModal.hide();
        cleanup();
        this._executeDiscard();
        window.location.href = pendingHref;
      };
      const onSave = async () => {
        bsModal.hide();
        cleanup();
        await this.saveDraft();
        window.location.href = pendingHref;
      };

      discardBtn?.addEventListener('click', onDiscard);
      saveBtn?.addEventListener('click', onSave);
    }

    _setupKeyboard() {
      this._keydownHandler = (e) => {
        const ctrl = e.ctrlKey || e.metaKey;
        if (!ctrl) return;
        // Only handle shortcuts when this SM's toolbar is visible
        const toolbar = document.getElementById(this.id + '-sm-toolbar');
        if (toolbar && toolbar.classList.contains('d-none')) return;

        if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); }
        else if ((e.key === 'Z' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); this.redo(); }
        else if (e.key === 's') { e.preventDefault(); this.saveDraft(); }
      };
      document.addEventListener('keydown', this._keydownHandler);
    }

    _emitStateChange() {
      document.dispatchEvent(new CustomEvent('stateManager:change', { detail: this.getState() }));
      this._updateBoundButtons();
    }

    _updateBoundButtons() {
      const s = this.getState();

      const roleMap = {
        undo:      s.canUndo,
        redo:      s.canRedo,
        saveDraft: s.canSaveDraft,
        discard:   s.canDiscard,
        publish:   s.canPublish,
      };

      for (const [role, btn] of Object.entries(this.boundButtons)) {
        if (!btn) continue;
        const enabled = roleMap[role] ?? true;
        btn.disabled = !enabled;
        btn.classList.toggle('disabled', !enabled);
        // Show saving spinner on save-draft button
        if (role === 'saveDraft' && s.isSavingDraft) {
          btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving…';
          btn.disabled = true;
        } else if (role === 'saveDraft' && !s.isSavingDraft) {
          // Restore original label (read from data-label or default)
          const label = btn.dataset.label || 'Save Draft';
          btn.innerHTML = `<i class="bi bi-floppy me-1"></i>${label}`;
        }
      }

      // Dirty dot
      if (this._dirtyDot) {
        this._dirtyDot.classList.toggle('d-none', !s.hasChanges);
      }
    }

    _getActionIcon(type) {
      if (type.includes(':add') || type.includes(':create')) return 'bi-plus-circle';
      if (type.includes(':delete') || type.includes(':remove')) return 'bi-trash';
      if (type.includes(':move')) return 'bi-arrows-move';
      return 'bi-pencil';
    }

    _showPublishModal() {
      const modal = document.getElementById(this.id + '-sm-publish-modal');
      if (!modal) { this.publish(); return; }

      // ── Summary badges from changelogConfig ────────────────────────────
      const summaryEl = document.getElementById(this.id + '-sm-pm-summary');
      if (summaryEl) {
        summaryEl.innerHTML = '';
        const configs = this.config.changelogConfig || [];
        configs.forEach(({ label, icon, countFn }) => {
          try {
            const count = typeof countFn === 'function' ? countFn() : '—';
            const badge = document.createElement('span');
            badge.className = 'badge text-bg-secondary d-inline-flex align-items-center gap-1 py-2 px-3';
            badge.style.fontSize = '.8rem';
            badge.innerHTML = `<i class="bi ${icon || 'bi-info-circle'}" aria-hidden="true"></i>${count} ${this._esc(label)}`;
            summaryEl.appendChild(badge);
          } catch (_) {}
        });

        // Also add total change count as a fallback badge if no config given
        if (!configs.length) {
          const cl    = this.getChangelist();
          const total = cl.summary.total;
          const badge = document.createElement('span');
          badge.className = 'badge text-bg-secondary d-inline-flex align-items-center gap-1 py-2 px-3';
          badge.style.fontSize = '.8rem';
          badge.innerHTML = `<i class="bi bi-pencil" aria-hidden="true"></i>${total} change${total !== 1 ? 's' : ''}`;
          summaryEl.appendChild(badge);
        }
      }

      // ── Detailed changelist ─────────────────────────────────────────────
      const logEl   = document.getElementById(this.id + '-sm-pm-changelog');
      const wrapEl  = document.getElementById(this.id + '-sm-pm-changelog-wrap');
      if (logEl && wrapEl) {
        const cl = this.getChangelist();
        if (cl.changes.length) {
          logEl.innerHTML = cl.changes.map(c => `
            <li class="d-flex align-items-start gap-2 py-1 border-bottom border-subtle">
              <i class="bi ${c.icon} text-secondary mt-1 flex-shrink-0" aria-hidden="true"></i>
              <span>${this._esc(c.description)}</span>
            </li>`).join('');
          wrapEl.classList.remove('d-none');
        } else {
          wrapEl.classList.add('d-none');
        }
      }

      const bsModal = bootstrap.Modal.getOrCreateInstance(modal);
      bsModal.show();

      // Wire confirm once
      const confirmBtn = document.getElementById(this.id + '-sm-pm-confirm');
      if (confirmBtn) {
        const handler = () => {
          bsModal.hide();
          this.publish();
          confirmBtn.removeEventListener('click', handler);
        };
        confirmBtn.addEventListener('click', handler);
        modal.addEventListener('hidden.bs.modal', () => {
          confirmBtn.removeEventListener('click', handler);
        }, { once: true });
      }
    }

    _esc(s) {
      return String(s).replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
      ));
    }
  }

  // ── Factory ──────────────────────────────────────────────────────────────

  window.StateManager = {
    create(id, config = {}) {
      if (instances.has(id)) {
        console.warn(`StateManager: instance "${id}" already exists — returning existing.`);
        return instances.get(id);
      }
      const inst = new StateManagerInstance(id, config);
      instances.set(id, inst);
      return inst;
    },
    get(id)      { return instances.get(id); },
    has(id)      { return instances.has(id); },
    destroy(id)  { const i = instances.get(id); if (i) { i.destroy(); instances.delete(id); } },
    getAll()     { return new Map(instances); },
  };
})();
