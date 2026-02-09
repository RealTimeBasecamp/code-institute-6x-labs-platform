/**
 * State Manager — Command-pattern undo/redo with dirty tracking and bulk save.
 *
 * Manages the in-memory state of MapComponents and ComponentFolders for the
 * active site. All mutations go through Commands so every change is undoable.
 *
 * Events dispatched (on document):
 *   stateManager.loaded          — after load() finishes
 *   stateManager.componentAdded  — detail: { component }
 *   stateManager.componentUpdated — detail: { component, field?, oldValue?, newValue? }
 *   stateManager.componentDeleted — detail: { clientId }
 *   stateManager.folderAdded     — detail: { folder }
 *   stateManager.folderUpdated   — detail: { folder }
 *   stateManager.folderDeleted   — detail: { folderId }
 *   stateManager.dirtyChanged    — detail: { isDirty }
 *   stateManager.undoRedoChanged — detail: { canUndo, canRedo }
 *   stateManager.saved           — after save() succeeds
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function dispatch(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail: detail, bubbles: true }));
  }

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function getCookie(name) {
    const v = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return v ? v.pop() : '';
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  class AddComponentCommand {
    constructor(manager, componentData) {
      this.manager = manager;
      this.data = deepClone(componentData);
      this.clientId = this.data.clientId || uuid();
      this.data.clientId = this.clientId;
    }
    execute() {
      this.manager._addComponent(this.data);
    }
    undo() {
      this.manager._removeComponent(this.clientId);
    }
  }

  class DeleteComponentCommand {
    constructor(manager, clientId) {
      this.manager = manager;
      this.clientId = clientId;
      this.snapshot = null;
    }
    execute() {
      this.snapshot = deepClone(this.manager.components.get(this.clientId));
      this.manager._removeComponent(this.clientId);
    }
    undo() {
      if (this.snapshot) {
        this.manager._addComponent(this.snapshot);
      }
    }
  }

  class UpdatePropertyCommand {
    constructor(manager, clientId, field, oldValue, newValue) {
      this.manager = manager;
      this.clientId = clientId;
      this.field = field;
      this.oldValue = deepClone(oldValue);
      this.newValue = deepClone(newValue);
    }
    execute() {
      this.manager._setProperty(this.clientId, this.field, this.newValue);
    }
    undo() {
      this.manager._setProperty(this.clientId, this.field, this.oldValue);
    }
  }

  class UpdateGeometryCommand {
    constructor(manager, clientId, oldGeometry, newGeometry) {
      this.manager = manager;
      this.clientId = clientId;
      this.oldGeometry = deepClone(oldGeometry);
      this.newGeometry = deepClone(newGeometry);
    }
    execute() {
      this.manager._setGeometry(this.clientId, this.newGeometry);
    }
    undo() {
      this.manager._setGeometry(this.clientId, this.oldGeometry);
    }
  }

  class MoveVertexCommand {
    constructor(manager, clientId, vertexIndex, oldPos, newPos) {
      this.manager = manager;
      this.clientId = clientId;
      this.vertexIndex = vertexIndex;
      this.oldPos = deepClone(oldPos);
      this.newPos = deepClone(newPos);
    }
    execute() {
      this.manager._moveVertex(this.clientId, this.vertexIndex, this.newPos);
    }
    undo() {
      this.manager._moveVertex(this.clientId, this.vertexIndex, this.oldPos);
    }
  }

  class AddFolderCommand {
    constructor(manager, folderData) {
      this.manager = manager;
      this.data = deepClone(folderData);
      this.folderId = this.data.id || 'folder-' + uuid();
      this.data.id = this.folderId;
    }
    execute() {
      this.manager._addFolder(this.data);
    }
    undo() {
      this.manager._removeFolder(this.folderId);
    }
  }

  class DeleteFolderCommand {
    constructor(manager, folderId) {
      this.manager = manager;
      this.folderId = folderId;
      this.snapshot = null;
    }
    execute() {
      this.snapshot = deepClone(this.manager.folders.get(this.folderId));
      this.manager._removeFolder(this.folderId);
    }
    undo() {
      if (this.snapshot) {
        this.manager._addFolder(this.snapshot);
      }
    }
  }

  class MoveToFolderCommand {
    constructor(manager, clientId, oldFolderId, newFolderId) {
      this.manager = manager;
      this.clientId = clientId;
      this.oldFolderId = oldFolderId;
      this.newFolderId = newFolderId;
    }
    execute() {
      this.manager._setProperty(this.clientId, 'folder_id', this.newFolderId);
    }
    undo() {
      this.manager._setProperty(this.clientId, 'folder_id', this.oldFolderId);
    }
  }

  class BatchCommand {
    constructor(commands) {
      this.commands = commands;
    }
    execute() {
      this.commands.forEach(function (cmd) { cmd.execute(); });
    }
    undo() {
      // Undo in reverse order
      for (let i = this.commands.length - 1; i >= 0; i--) {
        this.commands[i].undo();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // State Manager
  // ---------------------------------------------------------------------------

  class StateManager {
    constructor() {
      /** @type {Map<string, Object>} clientId → component state */
      this.components = new Map();
      /** @type {Map<string|number, Object>} folderId → folder state */
      this.folders = new Map();

      this.undoStack = [];
      this.redoStack = [];
      this.isDirty = false;
      this.maxUndoSteps = 100;

      // Current site context
      this.projectSlug = null;
      this.siteId = null;
    }

    // -----------------------------------------------------------------------
    // Public API — Command execution
    // -----------------------------------------------------------------------

    /**
     * Execute a command, push to undo stack, clear redo stack.
     * @param {Object} command - Must implement execute() and undo().
     */
    execute(command) {
      command.execute();
      this.undoStack.push(command);
      if (this.undoStack.length > this.maxUndoSteps) {
        this.undoStack.shift();
      }
      this.redoStack = [];
      this._setDirty(true);
      this._dispatchUndoRedo();
    }

    undo() {
      if (this.undoStack.length === 0) return;
      const cmd = this.undoStack.pop();
      cmd.undo();
      this.redoStack.push(cmd);
      this._setDirty(true);
      this._dispatchUndoRedo();
    }

    redo() {
      if (this.redoStack.length === 0) return;
      const cmd = this.redoStack.pop();
      cmd.execute();
      this.undoStack.push(cmd);
      this._setDirty(true);
      this._dispatchUndoRedo();
    }

    get canUndo() { return this.undoStack.length > 0; }
    get canRedo() { return this.redoStack.length > 0; }

    // -----------------------------------------------------------------------
    // Public API — High-level component operations (create commands internally)
    // -----------------------------------------------------------------------

    addComponent(componentData) {
      const cmd = new AddComponentCommand(this, componentData);
      this.execute(cmd);
      return cmd.clientId;
    }

    deleteComponent(clientId) {
      if (!this.components.has(clientId)) return;
      this.execute(new DeleteComponentCommand(this, clientId));
    }

    updateProperty(clientId, field, newValue) {
      const comp = this.components.get(clientId);
      if (!comp) return;
      const oldValue = comp[field];
      this.execute(new UpdatePropertyCommand(this, clientId, field, oldValue, newValue));
    }

    updateGeometry(clientId, newGeometry) {
      const comp = this.components.get(clientId);
      if (!comp) return;
      const oldGeometry = comp.geometry;
      this.execute(new UpdateGeometryCommand(this, clientId, oldGeometry, newGeometry));
    }

    moveVertex(clientId, vertexIndex, newPos) {
      const comp = this.components.get(clientId);
      if (!comp || !comp.geometry || !comp.geometry.coordinates) return;

      // Get old position based on geometry type
      let oldPos;
      const coords = comp.geometry.coordinates;
      if (comp.geometry.type === 'Polygon' && coords[0]) {
        oldPos = [...coords[0][vertexIndex]];
      } else if (comp.geometry.type === 'LineString') {
        oldPos = [...coords[vertexIndex]];
      } else if (comp.geometry.type === 'Point') {
        oldPos = [...coords];
      }

      if (oldPos) {
        this.execute(new MoveVertexCommand(this, clientId, vertexIndex, oldPos, newPos));
      }
    }

    addFolder(folderData) {
      const cmd = new AddFolderCommand(this, folderData);
      this.execute(cmd);
      return cmd.folderId;
    }

    deleteFolder(folderId) {
      if (!this.folders.has(folderId)) return;
      this.execute(new DeleteFolderCommand(this, folderId));
    }

    moveToFolder(clientId, newFolderId) {
      const comp = this.components.get(clientId);
      if (!comp) return;
      const oldFolderId = comp.folder_id || null;
      this.execute(new MoveToFolderCommand(this, clientId, oldFolderId, newFolderId));
    }

    executeBatch(commands) {
      if (commands.length === 0) return;
      if (commands.length === 1) {
        this.execute(commands[0]);
        return;
      }
      this.execute(new BatchCommand(commands));
    }

    // -----------------------------------------------------------------------
    // Public API — Load & Save
    // -----------------------------------------------------------------------

    /**
     * Load components and folders for a site from the API.
     */
    async load(projectSlug, siteId) {
      this.projectSlug = projectSlug;
      this.siteId = siteId;

      // Clear current state (without undo tracking)
      this.components.clear();
      this.folders.clear();
      this.undoStack = [];
      this.redoStack = [];

      try {
        // Fetch components and folders in parallel
        const [compResp, folderResp] = await Promise.all([
          fetch(`/projects/${projectSlug}/api/sites/${siteId}/components/`),
          fetch(`/projects/${projectSlug}/api/sites/${siteId}/folders/`),
        ]);

        if (compResp.ok) {
          const featureCollection = await compResp.json();
          (featureCollection.features || []).forEach(feature => {
            const comp = this._featureToState(feature);
            this.components.set(comp.clientId, comp);
          });
        }

        if (folderResp.ok) {
          const folderData = await folderResp.json();
          (folderData.folders || []).forEach(f => {
            this.folders.set(f.id, f);
          });
        }
      } catch (err) {
        console.error('StateManager: Failed to load:', err);
      }

      this._setDirty(false);
      this._dispatchUndoRedo();
      dispatch('stateManager.loaded', {
        componentCount: this.components.size,
        folderCount: this.folders.size,
      });

    }

    /**
     * Bulk save all components to the server.
     */
    async save() {
      if (!this.projectSlug || !this.siteId) {
        console.warn('StateManager: No project/site context for save');
        return false;
      }

      const featureCollection = this.toGeoJSON();

      try {
        const resp = await fetch(
          `/projects/${this.projectSlug}/api/sites/${this.siteId}/components/bulk/`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRFToken': getCookie('csrftoken'),
            },
            body: JSON.stringify(featureCollection),
          }
        );

        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(text || resp.statusText);
        }

        const result = await resp.json();

        // Re-sync server IDs from response
        (result.features || []).forEach(feature => {
          // Match by geometry/name since clientIds aren't preserved server-side
          const serverId = feature.id;
          const name = feature.properties && feature.properties.name;
          // Try to find matching component by name + geometry type
          for (const [cid, comp] of this.components) {
            if (comp.name === name && !comp.serverId && comp.geometry_type === (feature.geometry && feature.geometry.type)) {
              comp.serverId = serverId;
              break;
            }
          }
        });

        this._setDirty(false);
        dispatch('stateManager.saved', result.meta || {});
        return true;
      } catch (err) {
        console.error('StateManager: Save failed:', err);
        return false;
      }
    }

    // -----------------------------------------------------------------------
    // Public API — Getters
    // -----------------------------------------------------------------------

    getComponent(clientId) {
      return this.components.get(clientId) || null;
    }

    getFolder(folderId) {
      return this.folders.get(folderId) || null;
    }

    getAllComponents() {
      return Array.from(this.components.values());
    }

    getAllFolders() {
      return Array.from(this.folders.values());
    }

    getComponentsByFolder(folderId) {
      return this.getAllComponents().filter(c => c.folder_id === folderId);
    }

    getRootComponents() {
      return this.getAllComponents().filter(c => !c.folder_id);
    }

    /**
     * Serialize the current component state as a GeoJSON FeatureCollection.
     */
    toGeoJSON() {
      const features = this.getAllComponents().map(comp => ({
        type: 'Feature',
        id: comp.serverId || undefined,
        geometry: comp.geometry,
        properties: {
          name: comp.name,
          data_type: comp.data_type,
          stroke_color: comp.stroke_color,
          fill_color: comp.fill_color,
          fill_opacity: comp.fill_opacity,
          stroke_width: comp.stroke_width,
          fill_pattern: comp.fill_pattern,
          parametric: comp.parametric,
          visible: comp.visible,
          locked: comp.locked,
          z_order: comp.z_order,
          folder_id: comp.folder_id,
          annotation_title: comp.annotation_title,
          annotation_description: comp.annotation_description,
          annotation_icon: comp.annotation_icon,
        },
      }));

      return { type: 'FeatureCollection', features: features };
    }

    // -----------------------------------------------------------------------
    // Internal mutation methods (called by commands, dispatch events)
    // -----------------------------------------------------------------------

    _addComponent(data) {
      const comp = deepClone(data);
      if (!comp.clientId) comp.clientId = uuid();
      this.components.set(comp.clientId, comp);
      dispatch('stateManager.componentAdded', { component: deepClone(comp) });
    }

    _removeComponent(clientId) {
      this.components.delete(clientId);
      dispatch('stateManager.componentDeleted', { clientId: clientId });
    }

    _setProperty(clientId, field, value) {
      const comp = this.components.get(clientId);
      if (!comp) return;
      const oldValue = comp[field];
      comp[field] = deepClone(value);
      dispatch('stateManager.componentUpdated', {
        component: deepClone(comp),
        field: field,
        oldValue: oldValue,
        newValue: value,
      });
    }

    _setGeometry(clientId, geometry) {
      const comp = this.components.get(clientId);
      if (!comp) return;
      comp.geometry = deepClone(geometry);
      comp.geometry_type = geometry.type;
      // Clear parametric flag when geometry is manually changed
      comp.parametric = {};
      dispatch('stateManager.componentUpdated', {
        component: deepClone(comp),
        field: 'geometry',
      });
    }

    _moveVertex(clientId, vertexIndex, newPos) {
      const comp = this.components.get(clientId);
      if (!comp || !comp.geometry) return;

      const coords = comp.geometry.coordinates;
      if (comp.geometry.type === 'Polygon' && coords[0]) {
        coords[0][vertexIndex] = [...newPos];
        // Close polygon ring if first/last vertex
        if (vertexIndex === 0) {
          coords[0][coords[0].length - 1] = [...newPos];
        } else if (vertexIndex === coords[0].length - 1) {
          coords[0][0] = [...newPos];
        }
      } else if (comp.geometry.type === 'LineString') {
        coords[vertexIndex] = [...newPos];
      } else if (comp.geometry.type === 'Point') {
        comp.geometry.coordinates = [...newPos];
      }

      // Clear parametric on vertex move
      comp.parametric = {};

      dispatch('stateManager.componentUpdated', {
        component: deepClone(comp),
        field: 'geometry',
      });
    }

    _addFolder(data) {
      const folder = deepClone(data);
      this.folders.set(folder.id, folder);
      dispatch('stateManager.folderAdded', { folder: deepClone(folder) });
    }

    _removeFolder(folderId) {
      // Unparent components in this folder
      for (const [cid, comp] of this.components) {
        if (comp.folder_id === folderId) {
          comp.folder_id = null;
        }
      }
      this.folders.delete(folderId);
      dispatch('stateManager.folderDeleted', { folderId: folderId });
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    _featureToState(feature) {
      const props = feature.properties || {};
      return {
        clientId: uuid(),
        serverId: feature.id || null,
        geometry: feature.geometry,
        geometry_type: (feature.geometry && feature.geometry.type) || 'Polygon',
        name: props.name || 'Untitled',
        data_type: props.data_type || 'annotation',
        stroke_color: props.stroke_color || '#3388ff',
        fill_color: props.fill_color || '#3388ff',
        fill_opacity: props.fill_opacity !== undefined ? props.fill_opacity : 0.3,
        stroke_width: props.stroke_width !== undefined ? props.stroke_width : 2.0,
        fill_pattern: props.fill_pattern || 'solid',
        parametric: props.parametric || {},
        visible: props.visible !== undefined ? props.visible : true,
        locked: props.locked !== undefined ? props.locked : false,
        z_order: props.z_order || 0,
        folder_id: props.folder_id || null,
        annotation_title: props.annotation_title || '',
        annotation_description: props.annotation_description || '',
        annotation_icon: props.annotation_icon || '',
      };
    }

    _setDirty(dirty) {
      if (this.isDirty !== dirty) {
        this.isDirty = dirty;
        dispatch('stateManager.dirtyChanged', { isDirty: dirty });

        // Update editor state flag for menu system
        if (window.editorState) {
          window.editorState.hasUnsavedChanges = dirty;
        }
      }
    }

    _dispatchUndoRedo() {
      dispatch('stateManager.undoRedoChanged', {
        canUndo: this.canUndo,
        canRedo: this.canRedo,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Expose globally
  // ---------------------------------------------------------------------------

  const stateManager = new StateManager();
  window.stateManager = stateManager;

  // Expose command constructors for advanced usage
  window.StateManagerCommands = {
    AddComponentCommand: AddComponentCommand,
    DeleteComponentCommand: DeleteComponentCommand,
    UpdatePropertyCommand: UpdatePropertyCommand,
    UpdateGeometryCommand: UpdateGeometryCommand,
    MoveVertexCommand: MoveVertexCommand,
    AddFolderCommand: AddFolderCommand,
    DeleteFolderCommand: DeleteFolderCommand,
    MoveToFolderCommand: MoveToFolderCommand,
    BatchCommand: BatchCommand,
  };

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------

  document.addEventListener('keydown', function (e) {
    // Ctrl+Z / Cmd+Z → Undo
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
      e.preventDefault();
      stateManager.undo();
    }
    // Ctrl+Shift+Z / Cmd+Shift+Z → Redo
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z') {
      e.preventDefault();
      stateManager.redo();
    }
    // Ctrl+S / Cmd+S → Save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      stateManager.save();
    }
  });

  // ---------------------------------------------------------------------------
  // Auto-load on site context
  // ---------------------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    const ctx = window.editorContext;
    if (ctx && ctx.project && ctx.project.slug && ctx.activeSiteId) {
      stateManager.load(ctx.project.slug, ctx.activeSiteId);
    }
  });

})();
