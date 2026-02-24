/**
 * Sortable Table Component
 * 
 * A reusable vanilla JS table component with:
 * - Click-to-sort headers (ascending/descending)
 * - Search/filter functionality
 * - Dynamic row numbering
 * - Auto-detection of column data types
 * 
 * Usage:
 * 1. Add class="sortable-table" to your <table>
 * 2. Add data-sortable to <th> elements you want to be sortable
 * 3. Add data-row-number to <th> cells that should show dynamic row numbers
 * 
 * Data types are auto-detected:
 * - Numbers: 123, 45.67, -10, 1,000
 * - Booleans: true/false, yes/no, on/off
 * - Categorical: columns with few unique values (like status fields)
 * - Empty values: —, -, empty string (sorted last)
 * - Text: everything else (case-insensitive alphabetical)
 */

class SortableTable {
    constructor(tableElement) {
        this.table = tableElement;
        this.tbody = this.table.querySelector('tbody');
        this.headers = this.table.querySelectorAll('th[data-sortable]');
        this.rows = Array.from(this.tbody.querySelectorAll('tr'));
        this.currentSort = { column: null, direction: 'asc' };
        this.searchInput = null;
        
        this.init();
    }

    init() {
        this.createSearchBar();
        this.setupHeaders();
        this.updateRowNumbers();
    }

    createSearchBar() {
        // Skip search bar creation for tables with data-no-auto-init
        // (they wire their own filter UI externally)
        if (this.table.hasAttribute('data-no-auto-init')) return;

        // Create search container
        const searchContainer = document.createElement('div');
        searchContainer.className = 'sortable-table-search';
        
        // Create search icon
        const searchIcon = document.createElement('i');
        searchIcon.className = 'bi bi-search search-icon';
        
        // Create search input
        this.searchInput = document.createElement('input');
        this.searchInput.type = 'text';
        this.searchInput.placeholder = 'Search...';
        this.searchInput.setAttribute('aria-label', 'Search table');
        
        // Assemble search container
        searchContainer.appendChild(searchIcon);
        searchContainer.appendChild(this.searchInput);
        
        // Check if table specifies a toolbar target for the search bar
        const toolbarId = this.table.dataset.searchToolbar;
        const toolbar = toolbarId ? document.getElementById(toolbarId) : null;
        
        if (toolbar) {
            // Move search bar to toolbar (on the right)
            searchContainer.style.marginBottom = '0';
            toolbar.appendChild(searchContainer);
        } else {
            // Default: insert before table
            this.table.parentNode.insertBefore(searchContainer, this.table);
        }
        
        // Add event listener with debounce
        let debounceTimer;
        this.searchInput.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => this.filterRows(e.target.value), 150);
        });
    }

    setupHeaders() {
        this.headers.forEach((header, index) => {
            header.addEventListener('click', () => this.sortByColumn(index, header));
        });
    }

    /**
     * Extract clean text from a cell, stripping emojis and extra whitespace
     */
    getCleanText(cell) {
        // Check for data-sort-value attribute first
        if (cell.dataset.sortValue !== undefined) {
            return cell.dataset.sortValue.trim();
        }
        
        // Get text content and clean it
        let text = cell.textContent.trim();
        
        // Remove emojis and other symbols (keeps letters, numbers, spaces, common punctuation)
        text = text.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]/gu, '');
        
        // Normalize whitespace
        text = text.replace(/\s+/g, ' ').trim();
        
        return text;
    }

    /**
     * Detect the data type of a column by sampling its values
     */
    detectColumnType(columnIndex) {
        const values = [];
        let numericCount = 0;
        let booleanCount = 0;
        let emptyCount = 0;

        this.rows.forEach(row => {
            const cell = row.cells[columnIndex];
            if (!cell) return;
            
            const value = this.getCleanText(cell);
            values.push(value);

            if (this.isEmpty(value)) {
                emptyCount++;
            } else if (this.isNumeric(value)) {
                numericCount++;
            } else if (this.isBoolean(value)) {
                booleanCount++;
            }
        });

        const totalCount = values.length;
        const nonEmptyCount = totalCount - emptyCount;
        if (nonEmptyCount === 0) return 'string';

        // If most non-empty values are numeric, treat as number
        if (numericCount / nonEmptyCount > 0.8) return 'number';
        // If most non-empty values are boolean, treat as boolean
        if (booleanCount / nonEmptyCount > 0.8) return 'boolean';
        
        // Check if categorical (few unique values = status/enum field)
        const uniqueValues = new Set(values.filter(v => !this.isEmpty(v)));
        if (uniqueValues.size <= Math.max(5, totalCount * 0.3)) {
            return 'categorical';
        }
        
        return 'string';
    }

    isEmpty(value) {
        return !value || value === '—' || value === '-' || value === 'N/A' || value === 'n/a' || value.toLowerCase() === 'none';
    }

    isNumeric(value) {
        // Remove common number formatting (commas, currency symbols, units)
        const cleaned = value.replace(/[,£$€%\s]/g, '');
        return !isNaN(parseFloat(cleaned)) && isFinite(cleaned);
    }

    isBoolean(value) {
        const lower = value.toLowerCase();
        return ['true', 'false', 'yes', 'no', 'on', 'off', 'enabled', 'disabled'].includes(lower);
    }

    parseValue(value, type) {
        const trimmed = value.trim();

        // For categorical, "None" or empty-like values sort last
        if (type === 'categorical') {
            if (this.isEmpty(trimmed)) {
                return { isEmpty: true, value: 'zzzzz' + trimmed.toLowerCase() }; // Sort empty/none last
            }
            return { isEmpty: false, value: trimmed.toLowerCase() };
        }

        // Empty values always sort last for other types
        if (this.isEmpty(trimmed)) {
            return { isEmpty: true, value: null };
        }

        switch (type) {
            case 'number':
                const cleaned = trimmed.replace(/[,£$€%\s]/g, '');
                return { isEmpty: false, value: parseFloat(cleaned) || 0 };
            
            case 'boolean':
                const lower = trimmed.toLowerCase();
                const trueValues = ['true', 'yes', 'on', 'active', 'enabled'];
                return { isEmpty: false, value: trueValues.includes(lower) ? 1 : 0 };
            
            default: // string
                return { isEmpty: false, value: trimmed.toLowerCase() };
        }
    }

    sortByColumn(columnIndex, header) {
        // Determine sort direction
        let direction = 'asc';
        if (this.currentSort.column === columnIndex && this.currentSort.direction === 'asc') {
            direction = 'desc';
        }

        // Update current sort state
        this.currentSort = { column: columnIndex, direction };

        // Update header classes
        this.headers.forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
        header.classList.add(direction === 'asc' ? 'sort-asc' : 'sort-desc');

        // Auto-detect column type
        const columnType = this.detectColumnType(columnIndex);

        // Sort rows
        this.rows.sort((a, b) => {
            const aCell = a.cells[columnIndex];
            const bCell = b.cells[columnIndex];
            
            const aRaw = this.getCleanText(aCell);
            const bRaw = this.getCleanText(bCell);
            
            const aParsed = this.parseValue(aRaw, columnType);
            const bParsed = this.parseValue(bRaw, columnType);

            // For non-categorical types, empty values always go to the end
            if (columnType !== 'categorical') {
                if (aParsed.isEmpty && bParsed.isEmpty) return 0;
                if (aParsed.isEmpty) return 1;
                if (bParsed.isEmpty) return -1;
            }

            // Compare values
            let comparison = 0;
            if (aParsed.value < bParsed.value) comparison = -1;
            if (aParsed.value > bParsed.value) comparison = 1;

            return direction === 'asc' ? comparison : -comparison;
        });

        // Re-append rows in new order
        this.rows.forEach(row => this.tbody.appendChild(row));
        
        // Update row numbers after sort
        this.updateRowNumbers();
    }

    getCellValue(cell) {
        // Check for data-sort-value attribute first (for custom sort values)
        if (cell.dataset.sortValue !== undefined) {
            return cell.dataset.sortValue;
        }
        // Otherwise use text content
        return cell.textContent.trim();
    }

    filterRows(searchTerm) {
        const term = searchTerm.toLowerCase().trim();
        let visibleCount = 0;

        this.rows.forEach(row => {
            // Get searchable content from cells
            const cells = row.querySelectorAll('td, th');
            let rowText = '';
            
            cells.forEach(cell => {
                // Include all cells or only those marked searchable
                if (!this.table.dataset.searchableOnly || cell.dataset.searchable !== undefined) {
                    rowText += ' ' + cell.textContent.toLowerCase();
                }
            });

            // Show/hide row based on match
            if (term === '' || rowText.includes(term)) {
                row.classList.remove('filtered-out');
                visibleCount++;
            } else {
                row.classList.add('filtered-out');
            }
        });

        // Update row numbers after filter
        this.updateRowNumbers();

        // Show/hide no results message
        this.updateNoResultsMessage(visibleCount === 0 && term !== '');
    }

    updateRowNumbers() {
        // Find all cells marked as row numbers and update them
        let visibleIndex = 1;
        this.rows.forEach(row => {
            const rowNumberCell = row.querySelector('[data-row-number]');
            if (rowNumberCell) {
                if (row.classList.contains('filtered-out')) {
                    // Hidden rows don't need updating
                } else {
                    rowNumberCell.textContent = visibleIndex;
                    visibleIndex++;
                }
            }
        });
    }

    updateNoResultsMessage(show) {
        let noResultsRow = this.tbody.querySelector('.no-results-row');
        
        if (show) {
            if (!noResultsRow) {
                noResultsRow = document.createElement('tr');
                noResultsRow.className = 'no-results-row';
                const td = document.createElement('td');
                td.className = 'no-results';
                td.colSpan = this.table.querySelectorAll('thead th').length;
                td.textContent = 'No matching results found';
                noResultsRow.appendChild(td);
                this.tbody.appendChild(noResultsRow);
            }
        } else if (noResultsRow) {
            noResultsRow.remove();
        }
    }
}

// Auto-initialize all sortable tables on DOM load
// Tables with data-no-auto-init are managed manually
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.sortable-table:not([data-no-auto-init])').forEach(table => {
        new SortableTable(table);
    });
});
