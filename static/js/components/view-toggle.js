/**
 * View Toggle Component
 * 
 * Handles switching between table and grid views with proper button styling.
 * Works with Bootstrap tabs and btn-secondary/btn-outline-secondary classes.
 * 
 * Usage:
 * - Add class="view-toggle-btn" to toggle buttons
 * - Active button gets btn-secondary (solid)
 * - Inactive buttons get btn-outline-secondary (outline)
 */

document.addEventListener('DOMContentLoaded', function() {
    const toggleButtons = document.querySelectorAll('.view-toggle-btn');

    if (toggleButtons.length === 0) return;

    // Rely on Bootstrap's Tab API and the nav-pills markup for active state
    toggleButtons.forEach(btn => {
        btn.addEventListener('click', function(event) {
            // Use Bootstrap Tab to show the target pane and update active classes
            try {
                if (window.bootstrap && window.bootstrap.Tab) {
                    const tab = window.bootstrap.Tab.getOrCreateInstance(this);
                    tab.show();
                }
            } catch (e) {
                // Fallback: manually toggle active class
                toggleButtons.forEach(b => b.classList.remove('active'));
                this.classList.add('active');
            }
        });
    });
    
    // Also filter grid view when table search is used
    const searchInput = document.querySelector('.sortable-table-search input');
    const gridView = document.getElementById('grid-view');
    
    if (searchInput && gridView) {
        searchInput.addEventListener('input', function() {
            const query = this.value.toLowerCase();
            gridView.querySelectorAll('[data-project-name]').forEach(el => {
                const name = el.getAttribute('data-project-name');
                el.style.display = name.includes(query) ? '' : 'none';
            });
        });
    }
});
