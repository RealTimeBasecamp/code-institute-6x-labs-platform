/**
 * Toolbar Renderer - Config-driven toolbar system
 * Renders toolbars from JSON configuration files
 *
 * Features:
 * - Loads toolbar configs from static JSON files
 * - Supports buttons, dropdowns, toggles, spacers, dividers
 * - Advanced dropdown content: checkboxes, sliders, number inputs, groups
 * - Role-based visibility (all, authenticated, staff, superuser)
 * - Dynamic enable/disable based on editor state
 * - Keyboard shortcut display in tooltips
 * - Callbacks via CustomEvent dispatch
 * - Exclusive toggle groups (radio button behavior)
 */

(function() {
  'use strict';

  /**
   * ToolbarRenderer class handles loading and rendering toolbars
   */
  class ToolbarRenderer {
    /**
     * Create a toolbar renderer instance
     * @param {Object} options - Configuration options
     * @param {string} options.configUrl - URL to the toolbar JSON config
     * @param {string|HTMLElement} options.container - Container element or selector
     * @param {string} options.eventPrefix - Prefix for dispatched events (e.g., 'mainToolbar')
     */
    constructor(options = {}) {
      this.configUrl = options.configUrl;
      this.container = typeof options.container === 'string'
        ? document.getElementById(options.container)
        : options.container;
      this.eventPrefix = options.eventPrefix || 'toolbar';
      this.user = window.editorContext?.user || { isAuthenticated: false, isStaff: false, isSuperuser: false };
      this.editorState = window.editorState || {};
      this.config = null;
      this.state = {};

      if (this.container && this.configUrl) {
        this.init();
      }
    }

    /**
     * Initialize the toolbar
     */
    async init() {
      await this.loadConfig();
      this.render();
      this.bindGlobalEvents();
    }

    /**
     * Load toolbar configuration from JSON file
     */
    async loadConfig() {
      try {
        const response = await fetch(this.configUrl);
        if (!response.ok) throw new Error(`Failed to load ${this.configUrl}`);
        this.config = await response.json();

        // Initialize state from config defaults
        if (this.config.state) {
          this.state = { ...this.config.state };
        }
      } catch (error) {
        console.error('Error loading toolbar config:', error);
        this.config = null;
      }
    }

    /**
     * Render the toolbar from config
     */
    render() {
      if (!this.container || !this.config) return;

      // Clear existing content
      this.container.innerHTML = '';

      // Set container attributes from config
      if (this.config.toolbar_id) {
        this.container.id = this.config.toolbar_id;
      }
      if (this.config.label) {
        this.container.setAttribute('aria-label', this.config.label);
      }

      // Render sections
      if (this.config.sections) {
        this.config.sections.forEach((section, index) => {
          const sectionEl = this.renderSection(section);
          if (sectionEl) this.container.appendChild(sectionEl);

          // Add divider between sections (except for spacers and last section)
          if (section.type !== 'spacer' && index < this.config.sections.length - 1) {
            const nextSection = this.config.sections[index + 1];
            if (nextSection && nextSection.type !== 'spacer') {
              const divider = document.createElement('div');
              divider.className = 'vp-toolbar-divider';
              this.container.appendChild(divider);
            }
          }
        });
      }

      // Refresh toolbar overflow handler if available
      this.initOverflow();

      // Dispatch render complete event
      this.container.dispatchEvent(new CustomEvent('toolbarRendered', {
        bubbles: true,
        detail: { toolbar: this }
      }));
    }

    /**
     * Initialize or refresh toolbar overflow handling
     */
    initOverflow() {
      if (!this.container.classList.contains('toolbar-overflow')) return;

      // Try immediately if ToolbarOverflow is available
      if (window.ToolbarOverflow) {
        const existingInstance = window.ToolbarOverflow.get(this.container);
        if (existingInstance) {
          existingInstance.refresh();
        } else {
          window.ToolbarOverflow.init(this.container);
        }
      } else {
        // Wait for ToolbarOverflow to be available
        const checkOverflow = () => {
          if (window.ToolbarOverflow) {
            window.ToolbarOverflow.init(this.container);
          } else {
            requestAnimationFrame(checkOverflow);
          }
        };
        requestAnimationFrame(checkOverflow);
      }
    }

    /**
     * Render a toolbar section
     * @param {Object} section - Section configuration
     * @returns {HTMLElement|null}
     */
    renderSection(section) {
      // Handle spacer type
      if (section.type === 'spacer') {
        return this.renderSpacer(section);
      }

      // Check visibility
      if (!this.isVisible(section)) return null;

      const sectionEl = document.createElement('div');
      sectionEl.className = 'vp-toolbar-section';
      if (section.group) {
        sectionEl.dataset.group = section.group;
      }
      if (section.align === 'right') {
        sectionEl.style.marginLeft = 'auto';
      }
      if (section.exclusive) {
        sectionEl.dataset.exclusive = 'true';
      }

      // Render items in section
      if (section.items) {
        section.items.forEach((item, index) => {
          const itemEl = this.renderItem(item, section);
          if (itemEl) {
            sectionEl.appendChild(itemEl);

            // Add small spacer between items (except last)
            if (index < section.items.length - 1) {
              const spacer = document.createElement('div');
              spacer.className = 'vp-toolbar-spacer-small';
              sectionEl.appendChild(spacer);
            }
          }
        });
      }

      return sectionEl;
    }

    /**
     * Render a spacer element
     * @param {Object} spacer - Spacer configuration
     * @returns {HTMLElement}
     */
    renderSpacer(spacer) {
      const spacerEl = document.createElement('div');
      if (spacer.size === 'flex' || spacer.align === 'right') {
        spacerEl.style.flex = '1';
      } else {
        spacerEl.className = `vp-toolbar-spacer-${spacer.size || 'small'}`;
      }
      return spacerEl;
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
     * Render a toolbar item (button, dropdown, toggle)
     * @param {Object} item - Item configuration
     * @param {Object} section - Parent section configuration
     * @returns {HTMLElement|null}
     */
    renderItem(item, section = {}) {
      if (!this.isVisible(item)) return null;

      switch (item.type) {
        case 'button':
          return this.renderButton(item, section);
        case 'dropdown':
          return this.renderDropdown(item);
        case 'toggle':
          return this.renderToggle(item);
        case 'value-dropdown':
          return this.renderValueDropdown(item);
        default:
          return this.renderButton(item, section); // Default to button
      }
    }

    /**
     * Render a toolbar button
     * @param {Object} item - Button configuration
     * @param {Object} section - Parent section configuration
     * @returns {HTMLElement}
     */
    renderButton(item, section = {}) {
      const btn = document.createElement('button');
      btn.className = 'vp-toolbar-btn';
      btn.dataset.action = item.id;

      // Build tooltip with shortcut
      let tooltip = item.tooltip || item.label;
      if (item.shortcut) {
        tooltip += ` (${item.shortcut})`;
      }
      btn.title = tooltip;

      // Disabled state
      if (!this.isEnabled(item)) {
        btn.classList.add('is-disabled');
        btn.disabled = true;
      }

      // Active state (for exclusive groups)
      if (item.isActive || this.state[item.id]) {
        btn.classList.add('is-active');
      }

      // Icon
      const btnIcon = this.createIcon(item.icon);
      if (btnIcon) {
        btn.appendChild(btnIcon);
      }

      // Label (optional)
      if (item.label && item.showLabel !== false) {
        const label = document.createElement('span');
        label.className = 'vp-btn-label';
        label.textContent = item.label;
        btn.appendChild(label);
      }

      // Click handler
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (btn.disabled) return;

        // Handle exclusive group (radio button behavior)
        if (section.exclusive) {
          const sectionEl = btn.closest('.vp-toolbar-section');
          sectionEl?.querySelectorAll('.vp-toolbar-btn').forEach(b => {
            b.classList.remove('is-active');
          });
          btn.classList.add('is-active');
          this.state[section.group + '_active'] = item.id;
        }

        this.dispatchAction(item.id, item);
      });

      return btn;
    }

    /**
     * Render a dropdown menu
     * @param {Object} item - Dropdown configuration
     * @returns {HTMLElement}
     */
    renderDropdown(item) {
      const wrapper = document.createElement('div');
      wrapper.className = 'vp-toolbar-dropdown';
      wrapper.dataset.dropdownId = item.id;

      // Trigger button
      const trigger = document.createElement('button');
      trigger.className = 'vp-toolbar-btn vp-dropdown-trigger';
      trigger.dataset.dropdown = item.id;
      trigger.title = item.tooltip || item.label;

      // Icon
      const triggerIcon = this.createIcon(item.icon);
      if (triggerIcon) {
        trigger.appendChild(triggerIcon);
      }

      // Label
      if (item.label && item.showLabel !== false) {
        const label = document.createElement('span');
        label.className = 'vp-btn-label';
        label.textContent = item.defaultLabel || item.label;
        trigger.appendChild(label);
      }

      // Dropdown arrow
      const arrow = document.createElement('i');
      arrow.className = 'bi bi-chevron-down vp-dropdown-arrow';
      trigger.appendChild(arrow);

      // Dropdown menu
      const menu = document.createElement('div');
      menu.className = 'vp-dropdown-menu';
      if (item.wide) {
        menu.classList.add('vp-dropdown-wide');
      }
      menu.dataset.menu = item.id;

      // Render dropdown content
      if (item.options) {
        item.options.forEach(option => {
          const optionEl = this.renderDropdownContent(option, item);
          if (optionEl) menu.appendChild(optionEl);
        });
      }

      // Toggle dropdown on click
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleDropdown(menu, trigger);
      });

      wrapper.appendChild(trigger);
      wrapper.appendChild(menu);

      return wrapper;
    }

    /**
     * Render a value dropdown (shows current value instead of label)
     * @param {Object} item - Dropdown configuration
     * @returns {HTMLElement}
     */
    renderValueDropdown(item) {
      const wrapper = document.createElement('div');
      wrapper.className = 'vp-toolbar-dropdown';
      wrapper.dataset.dropdownId = item.id;

      // Trigger button with value display
      const trigger = document.createElement('button');
      trigger.className = 'vp-toolbar-btn vp-dropdown-trigger vp-value-btn';
      trigger.dataset.dropdown = item.id;
      trigger.title = item.tooltip || item.label;

      // Icon (optional)
      if (item.icon) {
        const icon = document.createElement('i');
        icon.className = `bi ${item.icon}`;
        trigger.appendChild(icon);
      }

      // Value display
      const valueSpan = document.createElement('span');
      valueSpan.className = 'vp-btn-value';
      valueSpan.textContent = item.defaultValue || item.value || '';
      trigger.appendChild(valueSpan);

      // Dropdown arrow
      const arrow = document.createElement('i');
      arrow.className = 'bi bi-chevron-down vp-dropdown-arrow';
      trigger.appendChild(arrow);

      // Dropdown menu
      const menu = document.createElement('div');
      menu.className = 'vp-dropdown-menu';
      menu.dataset.menu = item.id;

      // Render dropdown content
      if (item.options) {
        item.options.forEach(option => {
          const optionEl = this.renderDropdownContent(option, item);
          if (optionEl) menu.appendChild(optionEl);
        });
      }

      // Toggle dropdown on click
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleDropdown(menu, trigger);
      });

      wrapper.appendChild(trigger);
      wrapper.appendChild(menu);

      return wrapper;
    }

    /**
     * Render dropdown content (options, groups, checkboxes, sliders, etc.)
     * @param {Object} option - Option configuration
     * @param {Object} parentItem - Parent dropdown configuration
     * @returns {HTMLElement|null}
     */
    renderDropdownContent(option, parentItem) {
      switch (option.type) {
        case 'separator':
          return this.renderSeparator();
        case 'group':
          return this.renderGroupHeader(option);
        case 'checkbox':
          return this.renderCheckbox(option, parentItem);
        case 'slider':
          return this.renderSlider(option, parentItem);
        case 'number':
          return this.renderNumberInput(option, parentItem);
        default:
          return this.renderDropdownOption(option, parentItem);
      }
    }

    /**
     * Render a separator
     * @returns {HTMLElement}
     */
    renderSeparator() {
      const sep = document.createElement('div');
      sep.className = 'vp-dropdown-separator';
      return sep;
    }

    /**
     * Render a group header
     * @param {Object} option - Group configuration
     * @returns {HTMLElement}
     */
    renderGroupHeader(option) {
      const group = document.createElement('div');
      group.className = 'vp-dropdown-group';
      group.textContent = option.label;
      return group;
    }

    /**
     * Render a dropdown option (button)
     * @param {Object} option - Option configuration
     * @param {Object} parentItem - Parent dropdown configuration
     * @returns {HTMLElement}
     */
    renderDropdownOption(option, parentItem) {
      const btn = document.createElement('button');
      btn.className = 'vp-dropdown-item';

      if (option.value !== undefined) {
        btn.dataset.value = option.value;
      }
      if (option.action) {
        btn.dataset.action = option.action;
      }
      if (option.isSelected || option.default) {
        btn.classList.add('is-selected');
      }

      // Icon (optional)
      const optIcon = this.createIcon(option.icon);
      if (optIcon) {
        btn.appendChild(optIcon);
      }

      // Label
      const labelSpan = document.createElement('span');
      labelSpan.textContent = option.label;
      btn.appendChild(labelSpan);

      // Click handler
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleDropdownSelect(btn, option, parentItem);
      });

      return btn;
    }

    /**
     * Render a checkbox option
     * @param {Object} option - Checkbox configuration
     * @param {Object} parentItem - Parent dropdown configuration
     * @returns {HTMLElement}
     */
    renderCheckbox(option, parentItem) {
      const label = document.createElement('label');
      label.className = 'vp-dropdown-item vp-checkbox';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.setting = option.id;
      if (option.checked || option.default) {
        checkbox.checked = true;
      }

      const span = document.createElement('span');
      span.textContent = option.label;

      label.appendChild(checkbox);
      label.appendChild(span);

      // Change handler
      checkbox.addEventListener('change', () => {
        this.state[option.id] = checkbox.checked;
        this.dispatchEvent('settingChange', {
          setting: option.id,
          value: checkbox.checked,
          parentId: parentItem.id
        });
      });

      return label;
    }

    /**
     * Render a slider with value display and reset button
     * @param {Object} option - Slider configuration
     * @param {Object} parentItem - Parent dropdown configuration
     * @returns {HTMLElement}
     */
    renderSlider(option, parentItem) {
      const row = document.createElement('div');
      row.className = 'vp-dropdown-slider-row';

      // Label
      const label = document.createElement('span');
      label.className = 'vp-slider-label';
      label.textContent = option.label;
      row.appendChild(label);

      // Slider input
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'vp-slider';
      slider.min = option.min ?? 0;
      slider.max = option.max ?? 100;
      slider.step = option.step ?? 1;
      slider.value = option.default ?? option.value ?? 50;
      slider.dataset.setting = option.id;
      slider.dataset.default = option.default ?? option.value ?? 50;
      row.appendChild(slider);

      // Value display
      const valueDisplay = document.createElement('span');
      valueDisplay.className = 'vp-slider-value';
      valueDisplay.dataset.valueFor = option.id;
      valueDisplay.textContent = slider.value;
      row.appendChild(valueDisplay);

      // Reset button
      const resetBtn = document.createElement('button');
      resetBtn.className = 'vp-reset-btn';
      resetBtn.dataset.resetFor = option.id;
      resetBtn.title = `Reset to default (${slider.dataset.default})`;
      resetBtn.innerHTML = '<i class="bi bi-arrow-counterclockwise"></i>';
      row.appendChild(resetBtn);

      // Slider input handler
      slider.addEventListener('input', () => {
        valueDisplay.textContent = slider.value;
        this.state[option.id] = parseFloat(slider.value);
        this.dispatchEvent('settingChange', {
          setting: option.id,
          value: parseFloat(slider.value),
          parentId: parentItem.id
        });
      });

      // Reset handler
      resetBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        slider.value = slider.dataset.default;
        valueDisplay.textContent = slider.value;
        slider.dispatchEvent(new Event('input'));
      });

      return row;
    }

    /**
     * Render a number input with reset button
     * @param {Object} option - Number input configuration
     * @param {Object} parentItem - Parent dropdown configuration
     * @returns {HTMLElement}
     */
    renderNumberInput(option, parentItem) {
      const row = document.createElement('div');
      row.className = 'vp-dropdown-input-row';

      // Label
      const label = document.createElement('label');
      label.className = 'vp-input-label';
      label.textContent = option.label;
      row.appendChild(label);

      // Number input
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'vp-input-number';
      input.dataset.setting = option.id;
      input.value = option.default ?? option.value ?? 0;
      input.min = option.min ?? '';
      input.max = option.max ?? '';
      input.step = option.step ?? 1;
      input.dataset.default = option.default ?? option.value ?? 0;
      row.appendChild(input);

      // Reset button
      const resetBtn = document.createElement('button');
      resetBtn.className = 'vp-reset-btn';
      resetBtn.dataset.resetFor = option.id;
      resetBtn.title = `Reset to default (${input.dataset.default})`;
      resetBtn.innerHTML = '<i class="bi bi-arrow-counterclockwise"></i>';
      row.appendChild(resetBtn);

      // Input change handler
      input.addEventListener('change', () => {
        this.state[option.id] = parseFloat(input.value);
        this.dispatchEvent('settingChange', {
          setting: option.id,
          value: parseFloat(input.value),
          parentId: parentItem.id
        });
      });

      // Reset handler
      resetBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        input.value = input.dataset.default;
        input.dispatchEvent(new Event('change'));
      });

      return row;
    }

    /**
     * Render a toggle button
     * @param {Object} item - Toggle configuration
     * @returns {HTMLElement}
     */
    renderToggle(item) {
      const btn = document.createElement('button');
      btn.className = 'vp-toolbar-btn vp-toggle';
      btn.dataset.toggle = item.id;
      if (item.activeIcon) {
        btn.dataset.toggleIcon = item.icon;
        btn.dataset.toggleActiveIcon = item.activeIcon;
      }

      // Build tooltip with shortcut
      let tooltip = item.tooltip || item.label;
      if (item.shortcut) {
        tooltip += ` (${item.shortcut})`;
      }
      btn.title = tooltip;

      // Icon
      const btnIcon = this.createIcon(item.icon);
      if (btnIcon) {
        btnIcon.classList.add('vp-toggle-icon');
        btn.appendChild(btnIcon);
      }

      // Label (optional)
      if (item.label && item.showLabel !== false) {
        const label = document.createElement('span');
        label.className = 'vp-btn-label';
        label.textContent = item.label;
        btn.appendChild(label);
      }

      // Set initial active state
      if (this.state[item.id] !== undefined ? this.state[item.id] : (item.isActive || item.default)) {
        btn.classList.add('is-active');
        this.state[item.id] = true;
        // Swap to active icon if configured
        if (item.activeIcon) {
          this._swapToggleIcon(btn, item.activeIcon);
        }
      }

      // Click handler
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        btn.classList.toggle('is-active');
        const isActive = btn.classList.contains('is-active');
        this.state[item.id] = isActive;
        // Swap icon if activeIcon is configured
        if (item.activeIcon) {
          this._swapToggleIcon(btn, isActive ? item.activeIcon : item.icon);
        }
        this.dispatchEvent('toggle', { id: item.id, isActive, ...item });
      });

      return btn;
    }

    /**
     * Swap the icon inside a toggle button
     * @param {HTMLElement} btn - Toggle button element
     * @param {string} iconStr - New icon identifier
     */
    _swapToggleIcon(btn, iconStr) {
      const oldIcon = btn.querySelector('.vp-toggle-icon');
      const newIcon = this.createIcon(iconStr, 'vp-toggle-icon');
      if (oldIcon && newIcon) {
        oldIcon.replaceWith(newIcon);
      }
    }

    /**
     * Toggle dropdown visibility
     * @param {HTMLElement} menu - Dropdown menu element
     * @param {HTMLElement} trigger - Trigger button element
     */
    toggleDropdown(menu, trigger) {
      // Close other dropdowns in this toolbar
      this.container.querySelectorAll('.vp-dropdown-menu.is-open').forEach(m => {
        if (m !== menu) m.classList.remove('is-open');
      });

      const wasOpen = menu.classList.contains('is-open');
      menu.classList.toggle('is-open');

      if (!wasOpen) {
        this.positionDropdown(menu, trigger);
      }
    }

    /**
     * Position dropdown menu relative to trigger
     * @param {HTMLElement} menu - Dropdown menu element
     * @param {HTMLElement} trigger - Trigger button element
     */
    positionDropdown(menu, trigger) {
      const rect = trigger.getBoundingClientRect();
      const menuWidth = menu.offsetWidth || 200;
      const menuHeight = menu.offsetHeight || 200;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let top = rect.bottom + 2;
      let left = rect.left;

      if (left + menuWidth > viewportWidth) left = rect.right - menuWidth;
      if (left < 0) left = 8;
      if (top + menuHeight > viewportHeight) top = rect.top - menuHeight - 2;
      if (top < 0) top = 8;

      menu.style.top = `${top}px`;
      menu.style.left = `${left}px`;
    }

    /**
     * Handle dropdown option selection
     * @param {HTMLElement} btn - Selected option button
     * @param {Object} option - Option configuration
     * @param {Object} parentItem - Parent dropdown configuration
     */
    handleDropdownSelect(btn, option, parentItem) {
      const menu = btn.closest('.vp-dropdown-menu');
      const wrapper = btn.closest('.vp-toolbar-dropdown');

      // Close menu
      if (menu) menu.classList.remove('is-open');

      // If it's a selection item (has value), update trigger label/value
      if (option.value !== undefined && wrapper) {
        const trigger = wrapper.querySelector('.vp-dropdown-trigger');
        const label = trigger?.querySelector('.vp-btn-label');
        const valueSpan = trigger?.querySelector('.vp-btn-value');

        if (label) label.textContent = option.label;
        if (valueSpan) valueSpan.textContent = option.value;

        // Update selected state
        menu.querySelectorAll('.vp-dropdown-item').forEach(item => {
          item.classList.remove('is-selected');
        });
        btn.classList.add('is-selected');

        // Update state
        this.state[parentItem.id] = option.value;

        // Dispatch selection event
        this.dispatchEvent('select', {
          dropdownId: parentItem.id,
          value: option.value,
          label: option.label
        });
      }

      // If it's an action item
      if (option.action) {
        this.dispatchAction(option.action, option);
      }
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
     * @param {string} eventType - Event type (action, select, toggle, settingChange)
     * @param {Object} detail - Event detail data
     */
    dispatchEvent(eventType, detail) {
      const eventName = `${this.eventPrefix}.${eventType}`;
      document.dispatchEvent(new CustomEvent(eventName, { detail, bubbles: true }));
    }

    /**
     * Check if item is visible based on user role
     * @param {Object} item - Item configuration
     * @returns {boolean}
     */
    isVisible(item) {
      if (item.active === false) return false;

      const visibleTo = item.visible_to || ['all'];

      if (visibleTo.includes('all')) return true;
      if (visibleTo.includes('authenticated') && this.user.isAuthenticated) return true;
      if (visibleTo.includes('staff') && this.user.isStaff) return true;
      if (visibleTo.includes('superuser') && this.user.isSuperuser) return true;

      return false;
    }

    /**
     * Check if item is enabled based on editor state
     * @param {Object} item - Item configuration
     * @returns {boolean}
     */
    isEnabled(item) {
      if (!item.enabled_when) return true;
      return this.editorState[item.enabled_when] ?? true;
    }

    /**
     * Bind global events (close dropdowns on outside click)
     */
    bindGlobalEvents() {
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.vp-toolbar-dropdown')) {
          this.container?.querySelectorAll('.vp-dropdown-menu.is-open').forEach(menu => {
            menu.classList.remove('is-open');
          });
        }
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          this.container?.querySelectorAll('.vp-dropdown-menu.is-open').forEach(menu => {
            menu.classList.remove('is-open');
          });
        }
      });
    }

    /**
     * Update toolbar state and re-render affected elements
     * @param {Object} newState - New state values
     */
    updateState(newState) {
      this.state = { ...this.state, ...newState };

      // Update toggle button states
      Object.entries(newState).forEach(([key, value]) => {
        const toggle = this.container?.querySelector(`[data-toggle="${key}"]`);
        if (toggle) {
          toggle.classList.toggle('is-active', value);
          // Swap icon if toggle has activeIcon configured
          if (toggle.dataset.toggleActiveIcon) {
            this._swapToggleIcon(toggle, value ? toggle.dataset.toggleActiveIcon : toggle.dataset.toggleIcon);
          }
        }

        // Update checkbox states
        const checkbox = this.container?.querySelector(`input[data-setting="${key}"]`);
        if (checkbox && checkbox.type === 'checkbox') {
          checkbox.checked = value;
        }
      });
    }

    /**
     * Update dropdown options dynamically
     * @param {string} dropdownId - Dropdown identifier
     * @param {Array} options - New options array
     */
    updateDropdownOptions(dropdownId, options) {
      const wrapper = this.container?.querySelector(`[data-dropdown-id="${dropdownId}"]`);
      const menu = wrapper?.querySelector('.vp-dropdown-menu');
      if (!menu) return;

      menu.innerHTML = '';
      options.forEach(option => {
        const optionEl = this.renderDropdownContent(option, { id: dropdownId });
        if (optionEl) menu.appendChild(optionEl);
      });
    }

    /**
     * Get current toolbar state
     * @returns {Object}
     */
    getState() {
      return { ...this.state };
    }
  }

  // Expose class globally
  window.ToolbarRenderer = ToolbarRenderer;

})();
