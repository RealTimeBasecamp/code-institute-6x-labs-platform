/**
 * Tool Palette Renderer - Config-driven vertical tool palette
 * Renders a Photoshop/Unreal-style tool palette from JSON configuration
 *
 * Features:
 * - Vertical layout with tool groups
 * - Single tool buttons
 * - Nested tools with flyout menus (long-press to show)
 * - Active tool state management (one tool active at a time)
 * - Keyboard shortcuts
 * - Tool options exposed via events for Details panel
 */

(function() {
  'use strict';

  /**
   * ToolPaletteRenderer class handles loading and rendering the tool palette
   */
  class ToolPaletteRenderer {
    /**
     * Create a tool palette renderer instance
     * @param {Object} options - Configuration options
     * @param {string} options.configUrl - URL to the tool palette JSON config
     * @param {string|HTMLElement} options.container - Container element or selector
     * @param {string} options.eventPrefix - Prefix for dispatched events
     */
    constructor(options = {}) {
      this.configUrl = options.configUrl;
      this.container = typeof options.container === 'string'
        ? document.getElementById(options.container)
        : options.container;
      this.eventPrefix = options.eventPrefix || 'toolPalette';
      this.config = null;
      this.activeTool = null;
      this.mode = options.mode || 'advanced';
      this.pressTimers = new Map();
      this.justOpenedFlyout = false;
      this.LONG_PRESS_DURATION = 500;

      if (this.container && this.configUrl) {
        this.init();
      }
    }

    /**
     * Initialize the tool palette
     */
    async init() {
      await this.loadConfig();
      if (this.config?.defaultMode) {
        this.mode = this.config.defaultMode;
      }
      this.render();
      this.bindGlobalEvents();
    }

    /**
     * Load configuration from JSON file
     */
    async loadConfig() {
      try {
        const response = await fetch(this.configUrl);
        if (!response.ok) throw new Error(`Failed to load ${this.configUrl}`);
        this.config = await response.json();
      } catch (error) {
        console.error('Error loading tool palette config:', error);
        this.config = null;
      }
    }

    /**
     * Render the tool palette from config
     */
    render() {
      if (!this.container || !this.config) return;

      this.container.innerHTML = '';

      if (this.config.tools) {
        this.config.tools.forEach((group) => {
          // Filter tools by current mode
          const filteredTools = group.tools
            ? group.tools.filter(t => this.isToolInMode(t))
            : [];

          if (filteredTools.length === 0) return;

          const filteredGroup = { ...group, tools: filteredTools };
          const groupEl = this.renderToolGroup(filteredGroup);
          if (groupEl) {
            this.container.appendChild(groupEl);
          }
        });
      }

      // Activate the first tool by default
      const firstTool = this.container.querySelector('[data-tool]');
      if (firstTool) {
        this.activateTool(firstTool.dataset.tool, firstTool);
      }
    }

    /**
     * Check if a tool should be visible in the current mode
     * Tools without a modes field default to advanced-only
     * @param {Object} tool - Tool configuration
     * @returns {boolean}
     */
    isToolInMode(tool) {
      const modes = tool.modes || ['advanced'];
      return modes.includes(this.mode);
    }

    /**
     * Render a tool group
     * @param {Object} group - Tool group configuration
     * @returns {HTMLElement}
     */
    renderToolGroup(group) {
      const groupEl = document.createElement('div');
      groupEl.className = 'tool-palette-group';
      if (group.group) {
        groupEl.dataset.group = group.group;
      }
      if (group.pushToBottom) {
        groupEl.style.marginTop = 'auto';
      }

      if (group.tools && group.tools.length > 0) {
        if (group.tools.length === 1) {
          // Single tool - render directly
          const toolEl = this.renderTool(group.tools[0]);
          if (toolEl) groupEl.appendChild(toolEl);
        } else {
          // Multiple tools - render as nested with flyout
          const nestedEl = this.renderNestedTools(group);
          if (nestedEl) groupEl.appendChild(nestedEl);
        }
      }

      return groupEl;
    }

    /**
     * Create an icon element from an icon string.
     * Supports Bootstrap Icons ("bi-cursor") and custom SVGs ("svg:select").
     * @param {string} iconStr - Icon identifier
     * @param {string} [extraClass] - Additional CSS class(es)
     * @returns {HTMLElement|null}
     */
    createIcon(iconStr, extraClass) {
      if (!iconStr) return null;

      if (iconStr.startsWith('svg:')) {
        const name = iconStr.slice(4);
        const icon = document.createElement('span');
        icon.className = 'custom-tool-icon' + (extraClass ? ' ' + extraClass : '');
        const url = `/static/planting/images/icons/${name}.svg`;
        icon.style.maskImage = `url('${url}')`;
        icon.style.webkitMaskImage = `url('${url}')`;
        return icon;
      }

      // Default: Bootstrap Icon
      const icon = document.createElement('i');
      icon.className = `bi ${iconStr}` + (extraClass ? ' ' + extraClass : '');
      return icon;
    }

    /**
     * Render a single tool button
     * @param {Object} tool - Tool configuration
     * @returns {HTMLElement}
     */
    renderTool(tool) {
      const btn = document.createElement('button');
      btn.className = 'vertical-toolbar-btn tool-palette-btn';
      btn.dataset.tool = tool.id;

      // Build tooltip with shortcut
      let tooltip = tool.label;
      if (tool.shortcut) {
        tooltip += ` (${tool.shortcut})`;
      }
      btn.title = tooltip;

      // Icon
      const icon = this.createIcon(tool.icon);
      if (icon) {
        btn.appendChild(icon);
      }

      // Click handler for non-action tools
      if (!tool.action) {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.activateTool(tool.id, btn);
        });
      } else {
        // Action tools (zoom in/out/fit) - immediate action, no active state
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.dispatchAction(tool.id, tool);
        });
      }

      return btn;
    }

    /**
     * Render nested tools with flyout
     * @param {Object} group - Tool group with multiple tools
     * @returns {HTMLElement}
     */
    renderNestedTools(group) {
      const nested = document.createElement('div');
      nested.className = 'tool-palette-nested';
      nested.dataset.trigger = group.group;

      // Primary tool (first tool shown, triggers flyout on long press)
      const primaryTool = group.tools[0];
      const trigger = document.createElement('button');
      trigger.className = 'vertical-toolbar-btn tool-palette-btn tool-palette-trigger';
      trigger.dataset.trigger = group.group;
      trigger.dataset.tool = primaryTool.id;

      let tooltip = primaryTool.label;
      if (primaryTool.shortcut) {
        tooltip += ` (${primaryTool.shortcut})`;
      }
      trigger.title = tooltip;

      const triggerIcon = this.createIcon(primaryTool.icon);
      if (triggerIcon) {
        trigger.appendChild(triggerIcon);
      }

      // Flyout indicator
      const indicator = document.createElement('span');
      indicator.className = 'tool-trigger-indicator';
      indicator.textContent = '▼';
      trigger.appendChild(indicator);

      // Flyout container
      const flyout = document.createElement('div');
      flyout.className = 'tool-palette-flyout';
      flyout.dataset.flyout = group.group;

      // Render all tools in flyout
      group.tools.forEach(tool => {
        const toolBtn = document.createElement('button');
        toolBtn.className = 'vertical-toolbar-btn tool-palette-btn tool-palette-nested-item';
        toolBtn.dataset.tool = tool.id;
        toolBtn.title = tool.label;

        const flyoutIcon = this.createIcon(tool.icon);
        if (flyoutIcon) {
          toolBtn.appendChild(flyoutIcon);
        }

        const label = document.createElement('span');
        label.textContent = tool.label.split(' - ')[0].split(' / ')[0]; // Short label
        toolBtn.appendChild(label);

        toolBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.selectFromFlyout(tool, trigger, nested);
        });

        flyout.appendChild(toolBtn);
      });

      // Long press handler for trigger
      this.bindLongPressHandler(trigger, nested, flyout, primaryTool);

      nested.appendChild(trigger);
      nested.appendChild(flyout);

      return nested;
    }

    /**
     * Bind long press handler to show flyout
     * @param {HTMLElement} trigger - Trigger button
     * @param {HTMLElement} nested - Nested container
     * @param {HTMLElement} flyout - Flyout element
     * @param {Object} primaryTool - Primary tool config
     */
    bindLongPressHandler(trigger, nested, flyout, primaryTool) {
      trigger.addEventListener('mousedown', (e) => {
        e.preventDefault();

        const timerId = setTimeout(() => {
          // Close other flyouts
          this.container.querySelectorAll('.tool-palette-nested.is-open').forEach(n => {
            if (n !== nested) n.classList.remove('is-open');
          });

          // Show flyout
          nested.classList.add('is-open');
          this.justOpenedFlyout = true;
        }, this.LONG_PRESS_DURATION);

        this.pressTimers.set(nested, timerId);
      });

      trigger.addEventListener('mouseup', (e) => {
        if (this.justOpenedFlyout) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        const timerId = this.pressTimers.get(nested);
        if (timerId) {
          clearTimeout(timerId);
          this.pressTimers.delete(nested);

          // Quick click - activate the current tool shown on trigger
          const toolId = trigger.dataset.tool;
          this.activateTool(toolId, trigger);
        }
      });

      trigger.addEventListener('mouseleave', () => {
        const timerId = this.pressTimers.get(nested);
        if (timerId) {
          clearTimeout(timerId);
          this.pressTimers.delete(nested);
        }
      });
    }

    /**
     * Select a tool from flyout
     * @param {Object} tool - Selected tool config
     * @param {HTMLElement} trigger - Trigger button to update
     * @param {HTMLElement} nested - Nested container
     */
    selectFromFlyout(tool, trigger, nested) {
      // Close flyout
      nested.classList.remove('is-open');

      // Update trigger to show selected tool
      trigger.dataset.tool = tool.id;
      let tooltip = tool.label;
      if (tool.shortcut) {
        tooltip += ` (${tool.shortcut})`;
      }
      trigger.title = tooltip;

      // Update icon - replace existing icon element (could be <i> or <span>)
      const oldIcon = trigger.querySelector('i, .custom-tool-icon');
      const newIcon = this.createIcon(tool.icon);
      if (oldIcon && newIcon) {
        oldIcon.replaceWith(newIcon);
      } else if (!oldIcon && newIcon) {
        trigger.insertBefore(newIcon, trigger.firstChild);
      }

      // Activate the tool
      this.activateTool(tool.id, trigger);
    }

    /**
     * Activate a tool
     * @param {string} toolId - Tool identifier
     * @param {HTMLElement} btn - Button element
     */
    activateTool(toolId, btn) {
      // Find tool config
      let toolConfig = null;
      if (this.config.tools) {
        for (const group of this.config.tools) {
          if (group.tools) {
            const found = group.tools.find(t => t.id === toolId);
            if (found) {
              toolConfig = found;
              break;
            }
          }
        }
      }

      // Skip activation for action tools
      if (toolConfig?.action) {
        this.dispatchAction(toolId, toolConfig);
        return;
      }

      // Remove active state from all tool buttons
      this.container.querySelectorAll('.tool-palette-btn').forEach(b => {
        b.classList.remove('is-active');
      });

      // Set active on clicked button
      btn.classList.add('is-active');
      this.activeTool = toolId;

      // Dispatch tool change event
      this.dispatchEvent('toolChange', {
        tool: toolId,
        config: toolConfig,
        options: toolConfig?.options || []
      });
    }

    /**
     * Bind global events
     */
    bindGlobalEvents() {
      // Close flyouts on click outside
      document.addEventListener('click', (e) => {
        if (this.justOpenedFlyout) {
          this.justOpenedFlyout = false;
          return;
        }

        if (!e.target.closest('.tool-palette-flyout')) {
          this.container.querySelectorAll('.tool-palette-nested.is-open').forEach(n => {
            n.classList.remove('is-open');
          });
        }
      });

      // Keyboard shortcuts
      document.addEventListener('keydown', (e) => {
        // Skip if typing in an input
        if (e.target.matches('input, textarea, select')) return;

        const key = e.key.toUpperCase();
        if (this.config.tools) {
          for (const group of this.config.tools) {
            if (group.tools) {
              const tool = group.tools.find(t => t.shortcut?.toUpperCase() === key && this.isToolInMode(t));
              if (tool) {
                e.preventDefault();
                const btn = this.container.querySelector(`[data-tool="${tool.id}"]`);
                if (btn) {
                  if (tool.action) {
                    this.dispatchAction(tool.id, tool);
                  } else {
                    this.activateTool(tool.id, btn);
                  }
                }
                break;
              }
            }
          }
        }
      });
    }

    /**
     * Dispatch an action event
     * @param {string} action - Action identifier
     * @param {Object} data - Additional event data
     */
    dispatchAction(action, data = {}) {
      this.dispatchEvent('action', { action, ...data });
    }

    /**
     * Dispatch a custom event
     * @param {string} eventType - Event type
     * @param {Object} detail - Event detail data
     */
    dispatchEvent(eventType, detail) {
      const eventName = `${this.eventPrefix}.${eventType}`;
      document.dispatchEvent(new CustomEvent(eventName, { detail, bubbles: true }));
    }

    /**
     * Set the palette mode and re-render
     * @param {string} mode - 'simple' or 'advanced'
     */
    setMode(mode) {
      this.mode = mode;
      this.render();
      this.dispatchEvent('modeChange', { mode });
    }

    /**
     * Get current palette mode
     * @returns {string}
     */
    getMode() {
      return this.mode;
    }

    /**
     * Get active tool
     * @returns {string|null}
     */
    getActiveTool() {
      return this.activeTool;
    }

    /**
     * Set active tool programmatically
     * @param {string} toolId - Tool identifier
     */
    setActiveTool(toolId) {
      const btn = this.container.querySelector(`[data-tool="${toolId}"]`);
      if (btn) {
        this.activateTool(toolId, btn);
      }
    }
  }

  // Expose class globally
  window.ToolPaletteRenderer = ToolPaletteRenderer;

})();
