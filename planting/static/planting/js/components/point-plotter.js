  /**
   * Point Plotter Panel - Planting Algorithm Controls
   *
   * Manages point generation parameters with Simple and Advanced modes.
   * Advanced mode provides controls for:
   * - Algorithm selection (uniform grid, random, Poisson disk, etc.)
   * - Point spacing and distribution parameters
   * - Macro settings (species, planting year, maintenance)
   * - Micro settings (constraints, edge distance, obstacles)
   * - Generation execution and statistics display
   */
  (function() {
    'use strict';

    document.addEventListener('DOMContentLoaded', function() {
      // Initialize state
      window.plotterState = {
        isGenerating: false,
        generatedPoints: [],
        algorithmType: 'uniform',
        parameters: {},
        mode: 'advanced'
      };

      // Generate all fields using FieldGenerator
      if (window.FieldGenerator) {
        // Algorithm fields
        window.FieldGenerator.addFieldsToContainer('#plotter-algorithm-fields', [
          {
            id: 'plotter-algorithm-type',
            label: 'Algorithm Type',
            type: 'select',
            value: 'uniform',
            default: 'uniform',
            options: [
              { value: 'uniform', label: 'Uniform Grid' },
              { value: 'random', label: 'Random Distribution' },
              { value: 'poisson', label: 'Poisson Disk Sampling' },
              { value: 'cluster', label: 'Clustered' },
              { value: 'manual', label: 'Manual Placement' }
            ]
          },
          {
            id: 'plotter-point-spacing',
            label: 'Point Spacing',
            type: 'number',
            value: 5.00,
            default: 5.00,
            min: 0.5,
            step: 0.5,
            unit: 'm'
          },
          {
            id: 'plotter-randomness',
            label: 'Randomness',
            type: 'range',
            value: 0,
            default: 0,
            min: 0,
            max: 100,
            step: 5,
            unit: '%'
          }
        ]);

        // Macro fields
        window.FieldGenerator.addFieldsToContainer('#plotter-macro-fields', [
          {
            id: 'plotter-default-species',
            label: 'Default Species',
            type: 'select',
            value: '',
            options: [
              { value: '', label: '-- None --' },
              { value: 'oak', label: 'Oak Tree' },
              { value: 'maple', label: 'Maple Tree' },
              { value: 'birch', label: 'Birch Tree' },
              { value: 'pine', label: 'Pine Tree' },
              { value: 'spruce', label: 'Spruce Tree' },
              { value: 'ash', label: 'Ash Tree' }
            ]
          },
          {
            id: 'plotter-planting-year',
            label: 'Planting Year',
            type: 'number',
            value: 2026,
            default: 2026,
            min: 2020,
            max: 2100
          },
          {
            id: 'plotter-maintenance-cycle',
            label: 'Maintenance Cycle',
            type: 'number',
            value: 5,
            default: 5,
            min: 1,
            max: 50,
            unit: 'years'
          },
          {
            id: 'plotter-autogenerate-glades',
            label: 'Autogenerate Glades',
            type: 'checkbox',
            value: true
          },
          {
            id: 'plotter-glades-priority',
            label: 'Glades Priority Weight',
            type: 'range',
            value: 0.5,
            default: 0.5,
            min: 0,
            max: 1,
            step: 0.1
          },
          {
            id: 'plotter-autogenerate-rides',
            label: 'Autogenerate Rides',
            type: 'checkbox',
            value: true
          },
          {
            id: 'plotter-rides-priority',
            label: 'Rides Priority Weight',
            type: 'range',
            value: 0.5,
            default: 0.5,
            min: 0,
            max: 1,
            step: 0.1
          },
          {
            id: 'plotter-prioritise-wetness',
            label: 'Prioritise Tree Species Matching Wetness Index',
            type: 'checkbox',
            value: true
          },
          {
            id: 'plotter-wetness-cutoff',
            label: 'Wetness Index Cutoff',
            type: 'range',
            value: 0.3,
            default: 0.3,
            min: 0,
            max: 1,
            step: 0.1
          }
        ]);

        // Micro fields
        window.FieldGenerator.addFieldsToContainer('#plotter-micro-fields', [
          {
            id: 'plotter-force-wildflowers',
            label: 'Force Wildflowers to Grow Within Tree Radii',
            type: 'checkbox',
            value: true
          },
          {
            id: 'plotter-force-grasses',
            label: 'Force Grasses to Grow Within Tree Radii',
            type: 'checkbox',
            value: true
          },
          {
            id: 'plotter-allow-radii-slip',
            label: 'Allow Tree Radii to Slip Over Into Glades and Rides',
            type: 'checkbox',
            value: true
          }
        ]);
      }

      const sectionHeaders = document.querySelectorAll('[data-section^="plotter-"]');
      const generateBtn = document.getElementById('plotter-generate-btn');
      const clearBtn = document.getElementById('plotter-clear-btn');
      const undoBtn = document.getElementById('plotter-undo-btn');

      // Handle section collapse/expand
      sectionHeaders.forEach(header => {
        header.addEventListener('click', function() {
          const section = this.closest('.window-section');
          section.classList.toggle('is-collapsed');
        });
      });

      // Note: All field interactions (sliders, inputs, reset buttons) are handled by FieldGenerator and ResetButtonHandler

      // Generate points button
      if (generateBtn) {
        generateBtn.addEventListener('click', function() {
          if (window.plotterState.isGenerating) return;
          generatePoints();
        });
      }

      // Clear points button
      if (clearBtn) {
        clearBtn.addEventListener('click', function() {
          if (confirm('Clear all generated points?')) {
            clearPoints();
          }
        });
      }

      // Undo button
      if (undoBtn) {
        undoBtn.addEventListener('click', function() {
          undoLastAction();
        });
      }

      // Listen for outliner selection changes
      document.addEventListener('outlinerSelection', function(e) {
        const selectedItem = e.detail;

        // Could enable/disable generation based on selection
        if (generateBtn) {
          generateBtn.disabled = !selectedItem || selectedItem.type !== 'site';
        }

      });

      // Listen for viewport selection changes
      document.addEventListener('viewportSelection', function(e) {
        const selectedItem = e.detail;

        // Could enable/disable generation based on selection
        if (generateBtn) {
          generateBtn.disabled = !selectedItem || selectedItem.type !== 'site';
        }
      });

      function generatePoints() {
        window.plotterState.isGenerating = true;
        if (generateBtn) generateBtn.disabled = true;

        const progressDiv = document.getElementById('plotter-progress');
        const progressFill = document.getElementById('plotter-progress-fill');
        const progressText = document.getElementById('plotter-progress-text');
        progressDiv.style.display = 'flex';
        progressFill.style.width = '0%';
        progressText.textContent = '0%';

        // Collect parameters
        const algorithm = document.getElementById('plotter-algorithm-type').value;
        const spacing = parseFloat(document.getElementById('plotter-point-spacing').value);
        const randomness = parseInt(document.getElementById('plotter-randomness').value);
        const edgeDistance = parseFloat(document.getElementById('plotter-edge-distance').value);
        const respectExisting = document.getElementById('plotter-respect-existing').checked;
        const avoidObstacles = document.getElementById('plotter-avoid-obstacles').checked;

        window.plotterState.algorithmType = algorithm;
        window.plotterState.parameters = {
          spacing,
          randomness,
          edgeDistance,
          respectExisting,
          avoidObstacles
        };

        // Simulate point generation with progress
        let progress = 0;
        const interval = setInterval(() => {
          progress += Math.random() * 20;
          if (progress >= 100) {
            progress = 100;
            clearInterval(interval);

            // Simulate point generation completion
            simulatePointGeneration(algorithm, spacing, randomness);
            updateStatistics();

            progressFill.style.width = progress + '%';
            progressText.textContent = '100%';

            window.plotterState.isGenerating = false;
            if (generateBtn) generateBtn.disabled = false;

          } else {
            progressFill.style.width = progress + '%';
            progressText.textContent = Math.floor(progress) + '%';
          }
        }, 200);
      }

      function simulatePointGeneration(algorithm, spacing, randomness) {
        // This would call the backend API to generate actual points
        // For now, simulate with random count
        const basePoints = Math.floor(1000 / (spacing * spacing));
        const randomFactor = 1 + (randomness / 100) * 0.5;
        const generatedCount = Math.floor(basePoints * randomFactor);

        window.plotterState.generatedPoints = Array.from({ length: generatedCount }, (_, i) => ({
          id: i,
          algorithm: algorithm,
          confidence: 0.85 + Math.random() * 0.15
        }));

        // Dispatch event to notify other components
        document.dispatchEvent(new CustomEvent('pointsGenerated', {
          detail: {
            count: generatedCount,
            algorithm: algorithm,
            parameters: window.plotterState.parameters
          },
          bubbles: true
        }));
      }

      function clearPoints() {
        window.plotterState.generatedPoints = [];

        const statsDiv = document.getElementById('plotter-statistics');
        statsDiv.style.display = 'none';

        document.dispatchEvent(new CustomEvent('pointsCleared', {
          detail: {},
          bubbles: true
        }));

      }

      function undoLastAction() {
        document.dispatchEvent(new CustomEvent('plotterUndo', {
          detail: {},
          bubbles: true
        }));
      }

      function updateStatistics() {
        const statsDiv = document.getElementById('plotter-statistics');
        const totalEl = document.getElementById('plotter-stat-total');
        const co2El = document.getElementById('plotter-stat-co2');
        const coverageEl = document.getElementById('plotter-stat-coverage');

        const pointCount = window.plotterState.generatedPoints.length;
        const estimatedCO2 = (pointCount * 25.5).toFixed(0); // Assume ~25.5kg CO2 per tree
        const coverage = (pointCount > 0 ? Math.min(Math.round(pointCount / 10), 100) : 0) + '%';

        totalEl.textContent = pointCount.toLocaleString();
        co2El.textContent = parseInt(estimatedCO2).toLocaleString() + ' kg';
        coverageEl.textContent = coverage;

        statsDiv.style.display = 'block';
      }
    });

  })();
