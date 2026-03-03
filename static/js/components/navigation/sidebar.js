/**
 * Sidebar Manager - Handles all sidebar/offcanvas UI functionality
 * Navigation is rendered server-side by Django, this handles UI behaviors only
 */
(function () {
  'use strict';

  const root = document.documentElement;
  const sidebar = document.getElementById("sidebar");
  const navbarLeft = document.getElementById("navbarLeft");
  const handle = document.querySelector("[data-sidebar-resizer]");

  if (!sidebar) return;

  let bsOffcanvas = null;

  // ===== INITIALIZATION =====

  /**
   * Set initial state on page load
   */
  function init() {
    // Remove the initial flash-prevention class
    document.documentElement.classList.remove('offcanvas-open-init');

    // Restore sidebar visibility state from localStorage
    const sidebarState = localStorage.getItem('sidebar-state') || 'open';
    if (sidebarState === 'hidden') {
      sidebar.classList.add('hidden');
    } else {
      sidebar.classList.remove('hidden');
    }

    // Initialize the offcanvas instance once (always exists)
    bsOffcanvas = new bootstrap.Offcanvas(sidebar, {
      backdrop: false,
      scroll: true
    });

    // Setup sidebar event listeners (must be before restoreOffcanvasState)
    setupSidebarEvents();

    // Setup locked page handlers
    setupLockedPageHandlers();

    // Setup nested menu toggles
    setupNestedMenuToggles();

    // Highlight active page
    highlightActivePage();

    // Setup navigation handlers
    setupNavigationHandlers();

    // Setup resize functionality if handle exists
    if (handle) {
      setupResizeHandle();
    }

    // Update sidebar state on window resize
    window.addEventListener('resize', updateSidebarState);

    // Restore offcanvas visibility now that listeners and bootstrap instance exist
    restoreOffcanvasState();
  }

  // ===== EVENT LISTENERS =====

  function setupSidebarEvents() {
    sidebar.addEventListener("shown.bs.offcanvas", () => {
      document.body.classList.add("offcanvas-open");
      try {
        if (navbarLeft) navbarLeft.style.display = 'none';
      } catch (e) {}
      saveOffcanvasState();
    });

    sidebar.addEventListener("hidden.bs.offcanvas", () => {
      document.body.classList.remove("offcanvas-open");
      try {
        if (navbarLeft) navbarLeft.style.display = 'flex';
      } catch (e) {}
      saveOffcanvasState();
    });
  }

  // ===== MODAL FUNCTIONS =====

  /**
   * Show inactive page modal
   */
  function showInactivePageModal() {
    // Prefer server-rendered modal component with id `comingSoonModal`.
    const modalElem = document.getElementById('comingSoonModal');
    if (modalElem) {
      try {
        const bsModal = new bootstrap.Modal(modalElem);
        bsModal.show();
      } catch (err) {
        console.warn('Failed to show comingSoonModal:', err);
      }
      return;
    }

    // If the server-rendered modal isn't present, warn and do nothing.
    console.warn('comingSoonModal not found — include the modal component in your templates.');
  }

  /**
   * Show upgrade modal for locked pages
   */
  function showUpgradeModal(pageId) {
    const existingModal = document.getElementById('upgrade-modal');
    if (existingModal) {
      existingModal.remove();
    }

    const modal = document.createElement('div');
    modal.id = 'upgrade-modal';
    modal.className = 'modal fade';
    modal.setAttribute('tabindex', '-1');
    modal.innerHTML = `
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <div class="modal-title"><i class="bi bi-lock-fill me-2"></i>Upgrade Required</div>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <p>This feature is not available in your current plan.</p>
            <p class="mb-0">Please upgrade your account to access this page.</p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
            <button type="button" class="btn btn-primary">Upgrade Now</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();

    modal.addEventListener('hidden.bs.modal', () => {
      modal.remove();
    });
  }

  /**
   * Setup locked page click handlers
   */
  function setupLockedPageHandlers() {
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a.sidebar-link');
      if (!link) return;

      // Check active state first (highest priority)
      const isActive = link.getAttribute('data-active') !== 'false';
      if (!isActive) {
        e.preventDefault();
        showInactivePageModal();
        return;
      }

      // Check locked state (second priority)
      const isLocked = link.getAttribute('data-locked') === 'true';
      if (isLocked) {
        e.preventDefault();
        const pageId = link.getAttribute('data-page-id');
        showUpgradeModal(pageId);
        return;
      }

      // Handle modal triggers
      const modalTrigger = link.getAttribute('data-modal-trigger');
      if (modalTrigger) {
        e.preventDefault();
        handleModalTrigger(modalTrigger);
      }
    });
  }

  /**
   * Handle modal triggers based on ID
   */
  function handleModalTrigger(modalId) {
    switch(modalId) {
      case 'search':
        openSearchModal();
        break;
      case 'upgrade':
        openUpgradeModal();
        break;
      case 'settings':
        openSettingsModal();
        break;
      default:
        console.warn('No handler defined for modal:', modalId);
    }
  }

  /**
   * Open search modal
   */
  function openSearchModal() {
    // TODO: Implement search modal
    console.log('Search modal triggered');
    alert('Search modal - to be implemented');
  }

  /**
   * Open upgrade modal
   */
  function openUpgradeModal() {
    showUpgradeModal('upgrade');
  }

  /**
   * Open settings modal
   */
  function openSettingsModal() {
    var modal = document.getElementById('UserSettingsModal');
    if (modal) bootstrap.Modal.getOrCreateInstance(modal).show();
  }

  // ===== OFFCANVAS STATE PERSISTENCE =====

  /**
   * Save offcanvas state to localStorage
   */
  function saveOffcanvasState() {
    const hasShowClass = sidebar.classList.contains('show');
    const hasShowingClass = sidebar.classList.contains('showing');
    const isOpen = hasShowClass || hasShowingClass;

    localStorage.setItem('offcanvas-state', isOpen ? 'open' : 'closed');
    updateToggleVisibility(isOpen);
  }

  /**
   * Restore offcanvas state from localStorage (defaults to open)
   */
  function restoreOffcanvasState() {
    if (window.innerWidth > 768) {
      let savedState = localStorage.getItem('offcanvas-state');
      if (!savedState) {
        savedState = 'open';
        localStorage.setItem('offcanvas-state', 'open');
      }
      updateToggleVisibility(savedState === 'open');

      if (savedState === 'open') {
        bsOffcanvas.show();
      } else {
        bsOffcanvas.hide();
      }
    } else {
      bsOffcanvas.hide();
    }
  }

  /**
   * Show or hide any buttons that toggle the sidebar.
   */
  function updateToggleVisibility(isOpen) {
    try {
      const toggles = Array.from(document.querySelectorAll('[data-bs-toggle="offcanvas"][data-bs-target="#sidebar"]'));
      toggles.forEach(btn => {
        btn.style.display = isOpen ? 'none' : '';
      });

      const mobileBtn = document.querySelector('.mobile-menu-btn');
      if (mobileBtn) mobileBtn.style.display = isOpen ? 'none' : '';

      if (navbarLeft) navbarLeft.style.display = isOpen ? 'none' : 'flex';

      if (isOpen) document.body.classList.add('offcanvas-open');
      else document.body.classList.remove('offcanvas-open');
    } catch (err) {
      console.warn('Failed to update sidebar toggle visibility', err);
    }
  }

  /**
   * Update sidebar state based on screen size
   */
  function updateSidebarState() {
    if (window.innerWidth > 768) {
      const savedState = localStorage.getItem('offcanvas-state') || 'open';
      if (savedState === 'open') {
        bsOffcanvas.show();
      }
    } else {
      bsOffcanvas.hide();
    }
  }

  /**
   * Save sidebar width to localStorage
   */
  function saveSidebarWidth() {
    const currentWidth = getComputedStyle(root).getPropertyValue('--sidebar-width').trim();
    if (currentWidth) {
      localStorage.setItem('sidebar-width', currentWidth);
    }
  }

  // ===== NESTED MENU STATE PERSISTENCE =====

  const NAV_STATE_KEY = 'nav-expanded-items';

  /**
   * Get expanded nav item IDs from localStorage
   */
  function getExpandedNavItems() {
    try {
      const stored = localStorage.getItem(NAV_STATE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      return [];
    }
  }

  /**
   * Save expanded nav item IDs to localStorage
   */
  function saveExpandedNavItems(ids) {
    try {
      localStorage.setItem(NAV_STATE_KEY, JSON.stringify(ids));
    } catch (e) {
      console.warn('Failed to save nav state:', e);
    }
  }

  /**
   * Toggle a nav item's expanded state in localStorage
   */
  function toggleNavItemState(itemId, isOpen) {
    const expanded = getExpandedNavItems();
    const index = expanded.indexOf(itemId);

    if (isOpen && index === -1) {
      expanded.push(itemId);
    } else if (!isOpen && index !== -1) {
      expanded.splice(index, 1);
    }

    saveExpandedNavItems(expanded);
  }

  /**
   * Restore expanded state for all parent nav items from localStorage
   */
  function restoreExpandedNavItems() {
    const expanded = getExpandedNavItems();
    const parentItems = document.querySelectorAll('.sidebar-item.has-children');

    parentItems.forEach(item => {
      const link = item.querySelector('.sidebar-link[data-page-id]');
      if (link) {
        const pageId = link.getAttribute('data-page-id');
        if (expanded.includes(pageId)) {
          item.classList.add('open');
        }
      }
    });
  }

  // ===== NESTED MENU TOGGLES =====

  /**
   * Setup nested menu expansion/collapse functionality
   */
  function setupNestedMenuToggles() {
    // Restore expanded state from localStorage
    restoreExpandedNavItems();

    const toggleButtons = document.querySelectorAll('.sidebar-icon-toggle');

    toggleButtons.forEach(button => {
      button.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();

        const parentItem = this.closest('.sidebar-item');
        parentItem.classList.toggle('open');

        // Persist state to localStorage
        const link = parentItem.querySelector('.sidebar-link[data-page-id]');
        if (link) {
          const pageId = link.getAttribute('data-page-id');
          toggleNavItemState(pageId, parentItem.classList.contains('open'));
        }

        return false;
      });

      // Support keyboard activation for non-button element (Enter / Space)
      button.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          this.click();
        }
      });
    });

    const parentLinks = document.querySelectorAll('.sidebar-item.has-children .sidebar-link');

    parentLinks.forEach(link => {
      link.addEventListener('click', function(e) {
        if (e.target.closest('.sidebar-icon-toggle')) {
          e.preventDefault();
          return false;
        }
      });
    });
  }

  // ===== NAVIGATION HANDLING =====

  /**
   * Setup navigation handlers with View Transitions support
   */
  function setupNavigationHandlers() {
    const supportsViewTransitions = 'startViewTransition' in document;

    document.addEventListener('click', function(e) {
      const link = e.target.closest('a[href]');
      if (!link) return;

      const href = link.getAttribute('href');
      if (!href || href.startsWith('http') || href.startsWith('//') || href.startsWith('#')) {
        return;
      }

      const isActive = link.getAttribute('data-active') !== 'false';
      const isLocked = link.getAttribute('data-locked') === 'true';
      const isModal = link.getAttribute('data-modal-trigger');

      if (!isActive || isLocked || isModal) {
        return;
      }

      saveOffcanvasState();
      saveSidebarWidth();

      if (supportsViewTransitions) {
        e.preventDefault();
        document.startViewTransition(() => {
          window.location.href = href;
        });
      }
    });

    window.addEventListener('beforeunload', function() {
      saveOffcanvasState();
      saveSidebarWidth();
    });
  }

  // ===== ACTIVE PAGE HIGHLIGHTING =====

  /**
   * Highlight the current page in sidebar navigation
   */
  function highlightActivePage() {
    const currentPath = window.location.pathname;

    const allLinks = sidebar.querySelectorAll('.offcanvas-body a[href]');
    allLinks.forEach(link => {
      link.classList.remove('active', 'fw-bold');
      link.style.backgroundColor = '';
    });

    allLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (href && currentPath === href) {
        link.classList.add('active', 'fw-bold');

        // Expand parent menu if this is a child item and persist state
        const parentItem = link.closest('.sidebar-submenu')?.closest('.sidebar-item.has-children');
        if (parentItem && !parentItem.classList.contains('open')) {
          parentItem.classList.add('open');
          const parentLink = parentItem.querySelector('.sidebar-link[data-page-id]');
          if (parentLink) {
            toggleNavItemState(parentLink.getAttribute('data-page-id'), true);
          }
        }
      }
    });
  }

  // ===== SIDEBAR RESIZE =====

  /**
   * Setup drag-to-resize functionality
   */
  function setupResizeHandle() {
    /**
     * Get CSS variable value in pixels.
     * Handles px, rem, and em units by converting to pixels.
     */
    const getVarInPixels = (name, fallback) => {
      const raw = getComputedStyle(root).getPropertyValue(name).trim();
      if (!raw) return fallback;

      const value = parseFloat(raw);
      if (Number.isNaN(value)) return fallback;

      // Convert rem/em to pixels using root font size
      if (raw.endsWith('rem') || raw.endsWith('em')) {
        const rootFontSize = parseFloat(getComputedStyle(root).fontSize) || 16;
        return value * rootFontSize;
      }

      return value; // Already in pixels or unitless
    };

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

    handle.addEventListener("pointerdown", (event) => {
      if (!event.isPrimary || event.button === 2) return;
      event.preventDefault();

      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startWidth = getVarInPixels("--sidebar-width", 260);
      const minWidth = getVarInPixels("--sidebar-min-width", 260);
      const maxWidth = Math.max(minWidth, getVarInPixels("--sidebar-max-width", 540));
      const closeThreshold = 30;

      let wasClosed = false;

      const onMove = (moveEvent) => {
        const delta = moveEvent.clientX - startX;
        const rawWidth = startWidth + delta;

        if (moveEvent.clientX < closeThreshold) {
          if (!wasClosed) {
            bsOffcanvas.hide();
            wasClosed = true;
          }
        } else {
          if (wasClosed) {
            bsOffcanvas.show();
            wasClosed = false;
          }
          const nextWidth = clamp(rawWidth, minWidth, maxWidth);
          root.style.setProperty("--sidebar-width", `${Math.round(nextWidth)}px`);
        }
      };

      const stopResize = () => {
        document.body.classList.remove("sidebar-resizing");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", stopResize);
        window.removeEventListener("pointercancel", stopResize);
        try {
          handle.releasePointerCapture(pointerId);
        } catch (err) {}

        saveSidebarWidth();
      };

      document.body.classList.add("sidebar-resizing");
      handle.setPointerCapture(pointerId);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", stopResize);
      window.addEventListener("pointercancel", stopResize);
    });
  }

  // ===== RUN INITIALIZATION =====

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
