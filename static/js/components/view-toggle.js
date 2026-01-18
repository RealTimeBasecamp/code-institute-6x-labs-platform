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
    
    toggleButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            // Remove active styling from all buttons
            toggleButtons.forEach(b => {
                b.classList.remove('btn-secondary');
                b.classList.add('btn-outline-secondary');
            });
            
            // Add active styling to clicked button
            this.classList.remove('btn-outline-secondary');
            this.classList.add('btn-secondary');
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
