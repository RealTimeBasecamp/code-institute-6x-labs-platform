/**
 * Golden Layout v2 Initialization
 *
 * Registers components and loads the layout.
 * All docking, resizing, popout handled natively by Golden Layout.
 *
 * Layout persistence:
 *   Saved to localStorage under `editor-state:<projectSlug>:goldenLayout`.
 *   Auto-saves on every resize/move/close/open (debounced 500ms).
 *   Falls back to the hardcoded default layout if nothing is saved.
 */

import { GoldenLayout, LayoutConfig } from 'https://esm.sh/golden-layout@2.6.0';

// ============================================
// Default Layout Configuration
// ============================================

const defaultLayoutConfig = {
  root: {
    type: 'row',
    content: [
      {
        type: 'component',
        title: 'Viewport',
        componentType: 'viewport',
        width: 60
      },
      {
        type: 'component',
        title: 'Outliner',
        componentType: 'outliner',
        width: 20
      },
      {
        type: 'component',
        title: 'Details',
        componentType: 'details',
        width: 20
      }
    ]
  }
};

// ============================================
// Layout Persistence
// ============================================

var DEBOUNCE_MS = 500;
var _saveTimer = null;

function getStorageKey() {
  var slug = (window.editorContext && window.editorContext.projectSlug) || '_global';
  return 'editor-state:' + slug + ':goldenLayout';
}

function readSavedLayout() {
  try {
    var raw = localStorage.getItem(getStorageKey());
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    // saveLayout() returns ResolvedLayoutConfig but loadLayout() expects LayoutConfig.
    // Convert back using the static helper.
    if (parsed.resolved) {
      return LayoutConfig.fromResolved(parsed);
    }
    return parsed;
  } catch (e) {
    return null;
  }
}

function writeSavedLayout(config) {
  try {
    localStorage.setItem(getStorageKey(), JSON.stringify(config));
  } catch (e) {
    // localStorage full or unavailable
  }
}

function scheduleSave(layout) {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(function () {
    _saveTimer = null;
    try {
      var config = layout.saveLayout();
      writeSavedLayout(config);
    } catch (e) {
      // Layout may not be fully ready yet
    }
  }, DEBOUNCE_MS);
}

// ============================================
// Component Factory
// ============================================

function bindComponent(container) {
  const componentType = container.componentType;
  const template = document.getElementById(`template-${componentType}`);

  if (template) {
    // Viewport: move template to preserve map initialization (map can't be cloned)
    // Other components: clone template so it can be reused when window is reopened
    if (componentType === 'viewport') {
      template.style.display = '';
      template.removeAttribute('id');
      template.className = 'gl-component';
      container.element.appendChild(template);

      const resizeMap = () => window.map?.resize?.();
      container.on('resize', resizeMap);
      container.on('show', resizeMap);
      setTimeout(resizeMap, 100);
    } else {
      const clone = template.cloneNode(true);
      clone.style.display = '';
      clone.removeAttribute('id');
      clone.className = 'gl-component';
      container.element.appendChild(clone);
    }
  } else {
    container.element.innerHTML = `<div class="gl-component-placeholder">Component not found: ${componentType}</div>`;
  }

  // Return component binding result
  return {
    component: container.element,
    virtual: false
  };
}

function unbindComponent(container) {
  container.element.innerHTML = '';
}

// ============================================
// Initialize
// ============================================

function init() {
  const containerEl = document.getElementById('workspace-panels');
  if (!containerEl) return;

  // Check if this is a popout window (Golden Layout adds gl-window parameter)
  const urlParams = new URLSearchParams(window.location.search);
  const isPopout = urlParams.has('gl-window');

  if (isPopout) {
    // Popout mode: hide toolbars, make container fullscreen
    document.body.classList.add('gl-popout');
    document.querySelector('.editor-main-toolbar')?.remove();
    document.querySelector('.editor-viewport-toolbar')?.remove();
    document.querySelector('.panel-toolbar')?.remove();

    // Make workspace fill the window
    const workspace = document.querySelector('.editor-workspace');
    if (workspace) {
      workspace.style.cssText = 'position:fixed;inset:0;';
    }
    containerEl.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;';
  }

  const layout = new GoldenLayout(containerEl, bindComponent, unbindComponent);
  layout.resizeWithContainerAutomatically = true;

  // Add icons to tabs when items are created
  layout.on('itemCreated', (item) => {
    if (item.type === 'component' && item.componentType && item.tab) {
      const template = document.getElementById(`template-${item.componentType}`);
      const icon = template?.dataset.panelIcon;
      if (icon && item.tab.element) {
        const titleElement = item.tab.element.querySelector('.lm_title');
        if (titleElement && !titleElement.querySelector('i')) {
          const iconEl = document.createElement('i');
          iconEl.className = `bi ${icon}`;
          iconEl.style.marginRight = '8px';
          iconEl.style.display = 'inline-block';
          titleElement.insertBefore(iconEl, titleElement.firstChild);
        }
      }
    }
  });

  // Only load layout in main window, not in popouts
  if (!isPopout) {
    // Try to restore saved layout, fall back to default
    var saved = readSavedLayout();
    if (saved) {
      try {
        layout.loadLayout(saved);
      } catch (e) {
        // Saved config invalid (e.g. schema changed) — use default
        layout.loadLayout(defaultLayoutConfig);
      }
    } else {
      layout.loadLayout(defaultLayoutConfig);
    }

    // Auto-save on every layout state change (resize, move, close, open, tab reorder)
    layout.on('stateChanged', function () {
      scheduleSave(layout);
    });
  }

  // Expose for debugging/external access
  window.goldenLayout = layout;

  // Expose a helper for non-module scripts (editor-local-state.js) to load
  // configs that may be in ResolvedLayoutConfig format.
  window.loadGoldenLayoutConfig = function (config) {
    if (config && config.resolved) {
      config = LayoutConfig.fromResolved(config);
    }
    layout.loadLayout(config);
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
