/**
 * State Manager Component
 *
 * A generic client-side state management system with undo/redo capability,
 * navigation blocking, changelist tracking, and atomic publishing support.
 *
 * Features:
 * - Command pattern for reversible actions (execute/undo/redo)
 * - Factory pattern for creating instances per page/context
 * - Navigation blocking via beforeunload when changes exist
 * - Button state management via custom events
 * - Changelist generation for publish confirmation
 *
 * Usage:
 * ------
 * // Create a state manager instance
 * const stateManager = window.StateManager.create('my-editor', {
 *   publishEndpoint: '/api/state/publish/',
 *   entityType: 'Project',
 *   entityId: 'project-slug'
 * });
 *
 * // Register action types
 * stateManager.registerActionType('site:add', {
 *   execute: (data) => addSiteToDropdown(data),
 *   undo: (data) => removeSiteFromDropdown(data.siteId),
 *   describe: (data) => `Added site "${data.name}"`
 * });
 *
 * // Dispatch actions
 * stateManager.dispatch('site:add', {
 *   executeData: { siteId: 'temp-1', name: 'New Site' },
 *   undoData: { siteId: 'temp-1' },
 *   entityRef: { model: 'Site', field: 'name' }
 * });
 *
 * // Undo/Redo
 * stateManager.undo();
 * stateManager.redo();
 *
 * Events:
 * -------
 * - 'stateManager:change' - Fired when state changes (for button updates)
 * - 'stateManager:publish' - Fired after successful publish
 */
(function () {
  'use strict';

  /**
   * Registry of StateManager instances
   * @type {Map<string, StateManagerInstance>}
   */
  const instances = new Map();

  /**
   * Generate unique action ID
   * @returns {string}
   */
  function generateActionId() {
    return `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get CSRF token from cookies
   * @returns {string|null}
   */
  function getCsrfToken() {
    const name = 'csrftoken';
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
      cookie = cookie.trim();
      if (cookie.startsWith(name + '=')) {
        return cookie.substring(name.length + 1);
      }
    }
    return null;
  }

  /**
   * StateManager Instance Class
   * Manages state for a specific context (page/editor)
   */
  class StateManagerInstance {
    /**
     * Create a StateManager instance
     * @param {string} id - Unique identifier for this instance
     * @param {Object} config - Configuration options
     * @param {string} config.publishEndpoint - API endpoint for publishing
     * @param {string} config.entityType - Type of entity being edited
     * @param {string} config.entityId - ID of entity being edited
     */
    constructor(id, config = {}) {
      this.id = id;
      this.config = {
        publishEndpoint: '/api/state/publish/',
        entityType: null,
        entityId: null,
        ...config
      };

      // Action type handlers registry
      this.actionTypes = new Map();

      // Action queue (all executed actions in order)
      this.actionQueue = [];

      // Undo/Redo stacks
      this.undoStack = [];
      this.redoStack = [];

      // State flags
      this.draftSaved = false;
      this.isPublishing = false;

      // Bound elements (buttons)
      this.boundButtons = {};

      // Setup navigation blocking
      this._setupBeforeUnload();
    }

    /**
     * Register an action type with its handlers
     * @param {string} type - Action type identifier (e.g., 'site:add')
     * @param {Object} handlers - Handler functions
     * @param {Function} handlers.execute - Execute the action
     * @param {Function} handlers.undo - Undo the action
     * @param {Function} [handlers.redo] - Redo the action (defaults to execute)
     * @param {Function} handlers.describe - Generate human-readable description
     */
    registerActionType(type, handlers) {
      if (!handlers.execute || !handlers.undo || !handlers.describe) {
        console.error(`StateManager: Action type "${type}" missing required handlers`);
        return;
      }
      this.actionTypes.set(type, {
        execute: handlers.execute,
        undo: handlers.undo,
        redo: handlers.redo || handlers.execute,
        describe: handlers.describe
      });
    }

    /**
     * Dispatch an action
     * @param {string} type - Registered action type
     * @param {Object} actionData - Action data
     * @param {Object} actionData.executeData - Data for execute function
     * @param {Object} actionData.undoData - Data for undo function
     * @param {Object} [actionData.entityRef] - Entity reference for server
     * @returns {Object|null} The created action or null if failed
     */
    dispatch(type, actionData) {
      const handler = this.actionTypes.get(type);
      if (!handler) {
        console.error(`StateManager: Unknown action type "${type}"`);
        return null;
      }

      // Create action object
      const action = {
        id: generateActionId(),
        type: type,
        timestamp: Date.now(),
        executeData: actionData.executeData,
        undoData: actionData.undoData,
        entityRef: actionData.entityRef || null,
        description: handler.describe(actionData.executeData),
        state: 'executed'
      };

      // Execute the action
      try {
        handler.execute(actionData.executeData);
      } catch (error) {
        console.error(`StateManager: Failed to execute action "${type}"`, error);
        return null;
      }

      // Add to queue and undo stack
      this.actionQueue.push(action);
      this.undoStack.push(action);

      // Clear redo stack (new action invalidates redo history)
      this.redoStack = [];

      // Mark draft as unsaved
      this.draftSaved = false;

      // Update button states
      this._emitStateChange();

      return action;
    }

    /**
     * Undo the last action
     * @returns {boolean} True if undo was successful
     */
    undo() {
      if (this.undoStack.length === 0) {
        return false;
      }

      const action = this.undoStack.pop();
      const handler = this.actionTypes.get(action.type);

      if (!handler) {
        console.error(`StateManager: Cannot undo - handler not found for "${action.type}"`);
        return false;
      }

      try {
        handler.undo(action.undoData);
        action.state = 'undone';
        this.redoStack.push(action);
        this.draftSaved = false;
        this._emitStateChange();
        return true;
      } catch (error) {
        console.error(`StateManager: Failed to undo action "${action.type}"`, error);
        // Restore to undo stack on failure
        this.undoStack.push(action);
        return false;
      }
    }

    /**
     * Redo the last undone action
     * @returns {boolean} True if redo was successful
     */
    redo() {
      if (this.redoStack.length === 0) {
        return false;
      }

      const action = this.redoStack.pop();
      const handler = this.actionTypes.get(action.type);

      if (!handler) {
        console.error(`StateManager: Cannot redo - handler not found for "${action.type}"`);
        return false;
      }

      try {
        handler.redo(action.executeData);
        action.state = 'executed';
        this.undoStack.push(action);
        this.draftSaved = false;
        this._emitStateChange();
        return true;
      } catch (error) {
        console.error(`StateManager: Failed to redo action "${action.type}"`, error);
        // Restore to redo stack on failure
        this.redoStack.push(action);
        return false;
      }
    }

    /**
     * Save draft (marks current state as saved for publish)
     */
    saveDraft() {
      if (!this.hasChanges()) {
        return;
      }
      this.draftSaved = true;
      this._emitStateChange();

      if (window.showToast) {
        window.showToast('Draft saved', 'success');
      }
    }

    /**
     * Discard all changes
     */
    discardChanges() {
      // Undo all executed actions in reverse order
      while (this.undoStack.length > 0) {
        this.undo();
      }

      // Clear everything
      this.actionQueue = [];
      this.undoStack = [];
      this.redoStack = [];
      this.draftSaved = false;

      this._emitStateChange();

      if (window.showToast) {
        window.showToast('Changes discarded', 'info');
      }
    }

    /**
     * Publish all changes to the server
     * @returns {Promise<Object>} Result of publish operation
     */
    async publish() {
      if (!this.draftSaved) {
        console.warn('StateManager: Cannot publish - draft not saved');
        return { success: false, error: 'Draft not saved' };
      }

      if (this.isPublishing) {
        return { success: false, error: 'Publish already in progress' };
      }

      this.isPublishing = true;
      this._emitStateChange();

      // Prepare payload with only executed actions
      const executedActions = this.actionQueue.filter(a => a.state === 'executed');
      const payload = {
        entity_type: this.config.entityType,
        entity_id: this.config.entityId,
        actions: executedActions.map(a => ({
          type: a.type,
          executeData: a.executeData,
          entityRef: a.entityRef,
          description: a.description,
          timestamp: a.timestamp
        })),
        changelist: this.getChangelist()
      };

      try {
        const response = await fetch(this.config.publishEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken(),
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (result.success) {
          // Clear state on success
          this.actionQueue = [];
          this.undoStack = [];
          this.redoStack = [];
          this.draftSaved = false;

          if (window.showToast) {
            window.showToast(result.message || 'Changes published successfully', 'success');
          }

          // Emit publish event
          document.dispatchEvent(new CustomEvent('stateManager:publish', {
            detail: {
              managerId: this.id,
              entityType: this.config.entityType,
              entityId: this.config.entityId,
              result: result
            }
          }));
        } else {
          if (window.showToast) {
            window.showToast(result.error || 'Failed to publish changes', 'error');
          }
        }

        this.isPublishing = false;
        this._emitStateChange();
        return result;

      } catch (error) {
        console.error('StateManager: Publish failed', error);
        this.isPublishing = false;
        this._emitStateChange();

        if (window.showToast) {
          window.showToast('Failed to publish changes', 'error');
        }

        return { success: false, error: error.message };
      }
    }

    /**
     * Check if there are unsaved changes
     * @returns {boolean}
     */
    hasChanges() {
      return this.actionQueue.some(a => a.state === 'executed');
    }

    /**
     * Check if undo is available
     * @returns {boolean}
     */
    canUndo() {
      return this.undoStack.length > 0;
    }

    /**
     * Check if redo is available
     * @returns {boolean}
     */
    canRedo() {
      return this.redoStack.length > 0;
    }

    /**
     * Check if publish is available
     * @returns {boolean}
     */
    canPublish() {
      return this.draftSaved && this.hasChanges() && !this.isPublishing;
    }

    /**
     * Check if save draft is available
     * @returns {boolean}
     */
    canSaveDraft() {
      return this.hasChanges() && !this.draftSaved;
    }

    /**
     * Check if discard is available
     * @returns {boolean}
     */
    canDiscard() {
      return this.hasChanges();
    }

    /**
     * Get current state for button updates
     * @returns {Object}
     */
    getState() {
      return {
        managerId: this.id,
        canUndo: this.canUndo(),
        canRedo: this.canRedo(),
        canSaveDraft: this.canSaveDraft(),
        canDiscard: this.canDiscard(),
        canPublish: this.canPublish(),
        hasChanges: this.hasChanges(),
        draftSaved: this.draftSaved,
        isPublishing: this.isPublishing,
        changeCount: this.actionQueue.filter(a => a.state === 'executed').length
      };
    }

    /**
     * Generate changelist for confirmation modal
     * @returns {Object}
     */
    getChangelist() {
      const executedActions = this.actionQueue.filter(a => a.state === 'executed');

      // Group by model
      const byModel = {};
      executedActions.forEach(action => {
        const model = action.entityRef?.model || 'Unknown';
        if (!byModel[model]) {
          byModel[model] = { adds: 0, updates: 0, deletes: 0 };
        }
        // Determine action type from action.type string
        if (action.type.includes(':add') || action.type.includes(':create')) {
          byModel[model].adds++;
        } else if (action.type.includes(':delete') || action.type.includes(':remove')) {
          byModel[model].deletes++;
        } else {
          byModel[model].updates++;
        }
      });

      return {
        summary: {
          total: executedActions.length,
          byModel: byModel
        },
        changes: executedActions.map(action => ({
          id: action.id,
          model: action.entityRef?.model || 'Unknown',
          field: action.entityRef?.field || null,
          type: action.type,
          description: action.description,
          timestamp: action.timestamp,
          icon: this._getActionIcon(action.type)
        }))
      };
    }

    /**
     * Bind buttons to this state manager
     * @param {Object} buttonIds - Object mapping button roles to element IDs
     * @param {string} [buttonIds.undo] - Undo button ID
     * @param {string} [buttonIds.redo] - Redo button ID
     * @param {string} [buttonIds.saveDraft] - Save Draft button ID
     * @param {string} [buttonIds.discard] - Discard button ID
     * @param {string} [buttonIds.publish] - Publish button ID
     */
    bindButtons(buttonIds) {
      // Store bound button references
      for (const [role, id] of Object.entries(buttonIds)) {
        const btn = document.getElementById(id);
        if (btn) {
          this.boundButtons[role] = btn;

          // Add click handlers
          switch (role) {
            case 'undo':
              btn.addEventListener('click', () => this.undo());
              break;
            case 'redo':
              btn.addEventListener('click', () => this.redo());
              break;
            case 'saveDraft':
              btn.addEventListener('click', () => this.saveDraft());
              break;
            case 'discard':
              btn.addEventListener('click', () => this.discardChanges());
              break;
            case 'publish':
              btn.addEventListener('click', () => this._showPublishModal());
              break;
          }
        }
      }

      // Initial state update
      this._updateBoundButtons();
    }

    /**
     * Cleanup and destroy this instance
     */
    destroy() {
      // Remove beforeunload handler
      window.removeEventListener('beforeunload', this._beforeUnloadHandler);
      this._beforeUnloadHandler = null;

      // Clear state
      this.actionQueue = [];
      this.undoStack = [];
      this.redoStack = [];
      this.actionTypes.clear();
      this.boundButtons = {};
    }

    // ========== Private Methods ==========

    /**
     * Setup beforeunload handler for navigation blocking
     * @private
     */
    _setupBeforeUnload() {
      this._beforeUnloadHandler = (e) => {
        if (this.hasChanges()) {
          e.preventDefault();
          e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
          return e.returnValue;
        }
      };
      window.addEventListener('beforeunload', this._beforeUnloadHandler);
    }

    /**
     * Emit state change event
     * @private
     */
    _emitStateChange() {
      const state = this.getState();

      document.dispatchEvent(new CustomEvent('stateManager:change', {
        detail: state
      }));

      // Update bound buttons
      this._updateBoundButtons();
    }

    /**
     * Update bound button states
     * @private
     */
    _updateBoundButtons() {
      const state = this.getState();

      for (const [role, btn] of Object.entries(this.boundButtons)) {
        if (!btn) continue;

        let enabled = false;
        switch (role) {
          case 'undo':
            enabled = state.canUndo;
            break;
          case 'redo':
            enabled = state.canRedo;
            break;
          case 'saveDraft':
            enabled = state.canSaveDraft;
            break;
          case 'discard':
            enabled = state.canDiscard;
            break;
          case 'publish':
            enabled = state.canPublish;
            break;
        }

        btn.disabled = !enabled;
        btn.classList.toggle('disabled', !enabled);
      }
    }

    /**
     * Get Bootstrap icon class for action type
     * @param {string} actionType
     * @returns {string}
     * @private
     */
    _getActionIcon(actionType) {
      if (actionType.includes(':add') || actionType.includes(':create')) {
        return 'bi-plus-circle';
      } else if (actionType.includes(':delete') || actionType.includes(':remove')) {
        return 'bi-trash';
      } else if (actionType.includes(':move')) {
        return 'bi-arrows-move';
      } else {
        return 'bi-pencil';
      }
    }

    /**
     * Show publish confirmation modal
     * @private
     */
    _showPublishModal() {
      // Dispatch event for modal component to handle
      document.dispatchEvent(new CustomEvent('stateManager:showPublishModal', {
        detail: {
          managerId: this.id,
          changelist: this.getChangelist(),
          onConfirm: () => this.publish()
        }
      }));
    }
  }

  // ========== Factory API ==========

  /**
   * StateManager Factory
   * Creates and manages StateManager instances
   */
  window.StateManager = {
    /**
     * Create a new StateManager instance
     * @param {string} id - Unique identifier for this instance
     * @param {Object} [config] - Configuration options
     * @returns {StateManagerInstance}
     */
    create(id, config = {}) {
      if (instances.has(id)) {
        console.warn(`StateManager: Instance "${id}" already exists. Returning existing instance.`);
        return instances.get(id);
      }

      const instance = new StateManagerInstance(id, config);
      instances.set(id, instance);
      return instance;
    },

    /**
     * Get an existing StateManager instance
     * @param {string} id - Instance identifier
     * @returns {StateManagerInstance|undefined}
     */
    get(id) {
      return instances.get(id);
    },

    /**
     * Check if an instance exists
     * @param {string} id - Instance identifier
     * @returns {boolean}
     */
    has(id) {
      return instances.has(id);
    },

    /**
     * Destroy an instance and clean up
     * @param {string} id - Instance identifier
     */
    destroy(id) {
      const instance = instances.get(id);
      if (instance) {
        instance.destroy();
        instances.delete(id);
      }
    },

    /**
     * Get all active instances (for debugging)
     * @returns {Map<string, StateManagerInstance>}
     */
    getAll() {
      return new Map(instances);
    }
  };
})();
