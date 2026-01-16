/**
 * Wizard Summary Populator
 * 
 * Generic utility for populating wizard summary steps with collected data.
 * Works with the WizardManager's exposed `window.wizardSessionData`.
 * 
 * Usage in summary templates:
 * 
 *   <script src="{% static 'js/core/wizard-summary.js' %}"></script>
 *   <script>
 *     WizardSummary.populate(['name', 'project_type', 'city', 'country_code']);
 *   </script>
 * 
 * Or with field mappings for display labels:
 * 
 *   WizardSummary.populate({
 *     'name': { choices: null },
 *     'project_type': { choices: PROJECT_TYPE_CHOICES },
 *     'soil_type': { choices: SOIL_TYPE_CHOICES }
 *   });
 * 
 * Expected HTML structure:
 *   <span id="summary-{field_name}">—</span>
 */
(function() {
  'use strict';

  const WizardSummary = {
    /**
     * Populate summary elements with wizard session data
     * 
     * @param {Array|Object} fields - Array of field names or object with field config
     * @param {Object} options - Optional configuration
     * @param {string} options.prefix - ID prefix (default: 'summary-')
     * @param {string} options.fallback - Fallback text for empty values (default: '—')
     */
    populate(fields, options = {}) {
      const prefix = options.prefix || 'summary-';
      const fallback = options.fallback || '—';
      
      // Wait for wizard data to be ready
      const doPopulate = () => {
        const data = window.wizardSessionData || {};
        
        // Normalize fields to array
        const fieldList = Array.isArray(fields) ? fields : Object.keys(fields);
        const fieldConfig = Array.isArray(fields) 
          ? Object.fromEntries(fieldList.map(f => [f, {}]))
          : fields;
        
        fieldList.forEach(field => {
          const el = document.getElementById(prefix + field);
          if (!el) return;
          
          let value = data[field];
          const config = fieldConfig[field] || {};
          
          // Apply choice mapping if provided
          if (value && config.choices) {
            value = config.choices[value] || value;
          }
          
          el.textContent = value || fallback;
        });
      };
      
      // If data already available, populate immediately
      if (window.wizardSessionData) {
        doPopulate();
      }
      
      // Also listen for updates (handles async loading and step navigation)
      document.addEventListener('wizardDataReady', doPopulate);
    },

    /**
     * Create a simple choice mapper from Django's CHOICES format
     * 
     * @param {Array} choices - Array of [value, label] tuples
     * @returns {Object} Object mapping values to labels
     * 
     * Usage:
     *   const PROJECT_TYPES = WizardSummary.choicesToMap([
     *     ['private_land', 'Private Land'],
     *     ['public_land', 'Public Land']
     *   ]);
     */
    choicesToMap(choices) {
      return Object.fromEntries(choices);
    }
  };

  // Expose globally
  window.WizardSummary = WizardSummary;
})();
