/**
 * Sidebar Manager - Handles all sidebar/offcanvas functionality
 */
(function () {
  'use strict';
  
  const root = document.documentElement;
  const sidebar = document.getElementById("sidebar");
  const navbarLeft = document.getElementById("navbarLeft");
  const handle = document.querySelector("[data-sidebar-resizer]");

  if (!sidebar) return;

  // ===== DATA STORAGE =====
  let navigationData = null;
  let userData = null;
  let rolesData = null;
  let bsOffcanvas = null;

  // ===== INITIALIZATION =====
  
  /**
   * Set initial state on page load
   */
  async function init() {
    // Remove the initial flash-prevention class
    document.documentElement.classList.remove('offcanvas-open-init');
    
    // Restore sidebar visibility state from localStorage
    // Ensure the sidebar is visible on page load if no state is saved
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
    
    // Load navigation and user data
    await loadConfigs();
    
    // Render dynamic navigation
    renderNavigation();
    
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
    // This ensures the sidebar is shown/hidden appropriately on initial load.
    restoreOffcanvasState();
  }

  // ===== EVENT LISTENERS =====

  function setupSidebarEvents() {
    // Use bootstrap offcanvas events to persist state and update toggle visibility.
    // No manual toggle click handler — Bootstrap will emit shown/hidden events.
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

  // ===== CONFIG LOADING =====
  
  /**
   * Load navigation and user configs
   */
  async function loadConfigs() {
    try {
      const [navResponse, userResponse, rolesResponse] = await Promise.all([
        fetch('assets/config/navigation.json'),
        fetch('assets/config/user.json'),
        fetch('assets/config/roles.json')
      ]);
      
      if (navResponse.ok && userResponse.ok && rolesResponse.ok) {
        navigationData = await navResponse.json();
        userData = await userResponse.json();
        rolesData = await rolesResponse.json();
      } else {
        console.error('Failed to load configuration files');
      }
    } catch (error) {
      console.error('Error loading configs:', error);
    }
  }

  // ===== NAVIGATION RENDERING =====
  
  /**
   * Filter navigation items based on user role
   */
  function filterByRole(items, allowedPages) {
    return items.filter(item => {
      if (allowedPages.includes(item.id)) {
        if (item.children) {
          item.children = filterByRole(item.children, allowedPages);
          return item.children.length > 0;
        }
        return true;
      }
      return false;
    });
  }
  
  /**
   * Render navigation dynamically
   */
  function renderNavigation() {
    if (!navigationData || !userData || !rolesData) {
      console.warn('Navigation, user, or roles data not loaded');
      return;
    }
    
    const userRole = userData.role;
    const roleConfig = rolesData[userRole];
    
    if (!roleConfig || !roleConfig.allowedPages) {
      console.warn('Invalid role configuration for:', userRole);
      return;
    }
    
    // Render ALL navigation items, but mark restricted ones
    const navContainer = sidebar.querySelector('.offcanvas-body .sidebar-nav');
    if (!navContainer) return;
    
    navContainer.innerHTML = '';
    
    navigationData.navigation.forEach(item => {
      const isAllowed = roleConfig.allowedPages.includes(item.id);
      const li = createNavigationItem(item, isAllowed, roleConfig.allowedPages);
      navContainer.appendChild(li);
    });
  }
  
  /**
   * Create a navigation list item
   */
  function createNavigationItem(item, isAllowed, allowedPages) {
    const li = document.createElement('li');
    li.className = 'sidebar-item';
    
    // Check if item is active (defaults to true if not specified)
    const isActive = item.active !== false;
    
    if (item.type === 'profile') {
      li.innerHTML = `
        <a class="sidebar-link text-decoration-none d-flex align-items-center" data-active="${isActive}" data-page-id="${item.id}">
          <img
            src="${item.icon}"
            alt=""
            width="16"
            height="16"
            style="margin-right: 0.5rem"
          />
          <span class="profile-name">${item.label}</span>
        </a>
      `;
    } else if (item.type === 'modal') {
      const iconHTML = item.icon.startsWith('bi-') 
        ? `<i class="bi ${item.icon}"></i>`
        : `<img src="${item.icon}" alt="" width="16" height="16" style="margin-right: 0.5rem" />`;
      
      li.innerHTML = `
        <a href="#" class="sidebar-link text-decoration-none d-flex align-items-center ${!isAllowed ? 'locked' : ''}" data-locked="${!isAllowed}" data-page-id="${item.id}" data-modal-trigger="${item.id}" data-active="${isActive}">
          ${iconHTML}
          <span>${item.label}</span>
        </a>
      `;
    } else if (item.type === 'parent' && item.children && item.children.length > 0) {
      li.classList.add('has-children');
      
      li.innerHTML = `
        <a href="${isAllowed ? item.url : '#'}" class="sidebar-link text-decoration-none d-flex align-items-center ${!isAllowed ? 'locked' : ''}" data-locked="${!isAllowed}" data-page-id="${item.id}" data-active="${isActive}">
          <button class="sidebar-icon-toggle" aria-label="Toggle submenu">
            <i class="${item.icon} icon-default"></i>
            <i class="bi bi-chevron-right icon-chevron"></i>
          </button>
          <span>${item.label}</span>
        </a>
        <ul class="sidebar-submenu"></ul>
      `;
      
      const submenu = li.querySelector('.sidebar-submenu');
      item.children.forEach(child => {
        const childAllowed = allowedPages.includes(child.id);
        const childActive = child.active !== false;
        
        const childLi = document.createElement('li');
        childLi.className = 'sidebar-item';
        childLi.innerHTML = `
          <a href="${childAllowed ? child.url : '#'}" class="sidebar-link text-decoration-none d-flex align-items-center ${!childAllowed ? 'locked' : ''}" data-locked="${!childAllowed}" data-page-id="${child.id}" data-active="${childActive}">
            <i class="${child.icon}"></i>
            <span>${child.label}</span>
          </a>
        `;
        submenu.appendChild(childLi);
      });
    } else {
      const iconHTML = item.icon.startsWith('bi-') 
        ? `<i class="bi ${item.icon}"></i>`
        : `<img src="${item.icon}" alt="" width="16" height="16" style="margin-right: 0.5rem" />`;
      
      li.innerHTML = `
        <a href="${isAllowed ? item.url : '#'}" class="sidebar-link text-decoration-none d-flex align-items-center ${!isAllowed ? 'locked' : ''}" data-locked="${!isAllowed}" data-page-id="${item.id}" data-active="${isActive}">
          ${iconHTML}
          <span>${item.label}</span>
        </a>
      `;
    }
    
    return li;
  }
  
  /**
   * Show inactive page modal
   */
  function showInactivePageModal() {
    // Remove existing modal if present
    const existingModal = document.getElementById('inactive-modal');
    if (existingModal) {
      existingModal.remove();
    }
    
    // Create modal
    const modal = document.createElement('div');
    modal.id = 'inactive-modal';
    modal.className = 'modal fade';
    modal.setAttribute('tabindex', '-1');
    modal.innerHTML = `
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title"><i class="bi bi-hourglass-split me-2"></i>Coming Soon</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <p>This page is not ready yet.</p>
            <p class="mb-0">Please check back soon!</p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-primary" data-bs-dismiss="modal">OK</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();
    
    // Clean up after modal is hidden
    modal.addEventListener('hidden.bs.modal', () => {
      modal.remove();
    });
  }
  
  /**
   * Show upgrade modal for locked pages
   */
  function showUpgradeModal(pageId) {
    // Remove existing modal if present
    const existingModal = document.getElementById('upgrade-modal');
    if (existingModal) {
      existingModal.remove();
    }
    
    // Create modal
    const modal = document.createElement('div');
    modal.id = 'upgrade-modal';
    modal.className = 'modal fade';
    modal.setAttribute('tabindex', '-1');
    modal.innerHTML = `
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title"><i class="bi bi-lock-fill me-2"></i>Upgrade Required</h5>
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
    
    // Clean up after modal is hidden
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
    // TODO: Implement settings modal
    console.log('Settings modal triggered');
    alert('Settings modal - to be implemented');
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
    // Update visibility of any offcanvas toggle buttons (navbar + mobile button)
    updateToggleVisibility(isOpen);
  }
  
  /**
   * Restore offcanvas state from localStorage (defaults to open)
   */
  function restoreOffcanvasState() {
    // Check screen size - different behavior for mobile vs desktop
    if (window.innerWidth > 768) {
      // Desktop: use saved state or default to open
      let savedState = localStorage.getItem('offcanvas-state');
      if (!savedState) {
        // Default to open on first load
        savedState = 'open';
        localStorage.setItem('offcanvas-state', 'open');
      }
      // Update toggle visibility immediately
      updateToggleVisibility(savedState === 'open');

      if (savedState === 'open') {
        bsOffcanvas.show();
      } else {
        bsOffcanvas.hide();
      }
    } else {
      // Mobile: hide sidebar by default
      bsOffcanvas.hide();
    }
  }

  /**
   * Show or hide any buttons that toggle the sidebar.
   * Hides the buttons when the sidebar is open, shows when closed.
   */
  function updateToggleVisibility(isOpen) {
    try {
      // All buttons that toggle the sidebar (including mobile and navbar)
      const toggles = Array.from(document.querySelectorAll('[data-bs-toggle="offcanvas"][data-bs-target="#sidebar"]'));
      toggles.forEach(btn => {
        // Use inline style to control visibility per request (JS, canonical for old behavior)
        btn.style.display = isOpen ? 'none' : '';
      });

      // Also handle the standalone mobile-menu-btn if present
      const mobileBtn = document.querySelector('.mobile-menu-btn');
      if (mobileBtn) mobileBtn.style.display = isOpen ? 'none' : '';

      // Hide or show the entire navbar-left (logo + navbar toggle) via JS (restore old behavior)
      if (navbarLeft) navbarLeft.style.display = isOpen ? 'none' : 'flex';

      // Keep body class for CSS rules that depend on it (page shifting, etc.)
      if (isOpen) document.body.classList.add('offcanvas-open');
      else document.body.classList.remove('offcanvas-open');
    } catch (err) {
      // ignore errors quietly
      console.warn('Failed to update sidebar toggle visibility', err);
    }
  }
  
  /**
   * Update sidebar state based on screen size
   */
  function updateSidebarState() {
    if (window.innerWidth > 768) {
      // Desktop: show sidebar by default
      const savedState = localStorage.getItem('offcanvas-state') || 'open';
      if (savedState === 'open') {
        bsOffcanvas.show();
      }
    } else {
      // Mobile: hide sidebar by default
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

  // ===== NESTED MENU TOGGLES =====
  
  /**
   * Setup nested menu expansion/collapse functionality
   */
  function setupNestedMenuToggles() {
    // Handle icon toggle buttons
    const toggleButtons = document.querySelectorAll('.sidebar-icon-toggle');
    
    toggleButtons.forEach(button => {
      button.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        // Find the parent sidebar-item and toggle open class
        const parentItem = this.closest('.sidebar-item');
        parentItem.classList.toggle('open');
        
        return false;
      });
    });
    
    // Prevent parent links with toggles from navigating when clicking the toggle area
    const parentLinks = document.querySelectorAll('.sidebar-item.has-children > .sidebar-link');
    
    parentLinks.forEach(link => {
      link.addEventListener('click', function(e) {
        // If the click target is the icon toggle button or its icons, don't navigate
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
      
      // Check if link is locked or inactive (should not navigate)
      const isActive = link.getAttribute('data-active') !== 'false';
      const isLocked = link.getAttribute('data-locked') === 'true';
      const isModal = link.getAttribute('data-modal-trigger');
      
      if (!isActive || isLocked || isModal) {
        // These cases are handled by setupLockedPageHandlers
        return;
      }
      
      // Save state before navigation
      saveOffcanvasState();
      saveSidebarWidth();
      
      // Use View Transitions if supported
      if (supportsViewTransitions) {
        e.preventDefault();
        document.startViewTransition(() => {
          window.location.href = href;
        });
      }
    });
    
    // Backup save on page unload
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
    const currentPage = currentPath.split('/').pop() || 'index.html';
    
    const allLinks = sidebar.querySelectorAll('.offcanvas-body a[href]');
    allLinks.forEach(link => {
      link.classList.remove('active', 'fw-bold');
      link.style.backgroundColor = '';
    });
    
    allLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (href === currentPage || (currentPage === '' && href === 'index.html')) {
        link.classList.add('active', 'fw-bold');
        const hoverBg = getComputedStyle(root).getPropertyValue('--bs-hover-bg').trim();
        if (hoverBg) {
          link.style.backgroundColor = hoverBg;
        }
      }
    });
  }

  // ===== SIDEBAR EVENTS =====
  
  /**
   * Setup sidebar show/hide event listeners
   */
  function setupSidebarEvents() {
    sidebar.addEventListener("shown.bs.offcanvas", () => {
      document.body.classList.add("offcanvas-open");
      saveOffcanvasState();
    });

    sidebar.addEventListener("hidden.bs.offcanvas", () => {
      document.body.classList.remove("offcanvas-open");
      saveOffcanvasState();
    });
  }

  // ===== SIDEBAR RESIZE =====
  
  /**
   * Setup drag-to-resize functionality
   */
  function setupResizeHandle() {
    const getVarNumber = (name, fallback) => {
      const value = parseFloat(getComputedStyle(root).getPropertyValue(name));
      return Number.isNaN(value) ? fallback : value;
    };

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

    handle.addEventListener("pointerdown", (event) => {
      if (!event.isPrimary || event.button === 2) return;
      event.preventDefault();

      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startWidth = getVarNumber("--sidebar-width", 260);
      const minWidth = getVarNumber("--sidebar-min-width", 260);
      const maxWidth = Math.max(minWidth, getVarNumber("--sidebar-max-width", 540));
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
        
        // Save the new width
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
