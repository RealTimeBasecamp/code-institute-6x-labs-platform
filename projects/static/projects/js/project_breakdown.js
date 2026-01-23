/**
 * Project Breakdown Charts Module
 *
 * Initializes and manages ECharts visualizations for the project breakdown tab.
 * Uses CSS theme variables for consistent styling across light/dark modes.
 * Mirrors the dashboard chart styling for visual consistency.
 */

(function () {
  'use strict';

  // =========================================================================
  // THEME UTILITIES
  // =========================================================================

  /**
   * Reads CSS custom properties from the document root.
   * @returns {Object} Theme colors extracted from CSS variables
   */
  function getThemeColors() {
    const rootStyles = getComputedStyle(document.documentElement);

    return {
      primary: rootStyles.getPropertyValue('--primary-color').trim() || '#059acc',
      text: rootStyles.getPropertyValue('--bs-body-color').trim() || '#55534e',
      textSecondary: rootStyles.getPropertyValue('--bs-secondary-color').trim() || '#91918e',
      background: rootStyles.getPropertyValue('--bs-body-bg').trim() || '#ffffff',
      cardBg: rootStyles.getPropertyValue('--bs-tertiary-bg').trim() || '#f9fafb',
      border: rootStyles.getPropertyValue('--bs-border-color').trim() || '#e9e9e7',
      hover: rootStyles.getPropertyValue('--bs-hover-bg').trim() || '#f1f0ef'
    };
  }

  /**
   * Converts a hex color to rgba format with specified alpha.
   * @param {string} hex - Hex color code (with or without #)
   * @param {number} alpha - Alpha value between 0 and 1
   * @returns {string} rgba color string
   */
  function hexToRgba(hex, alpha = 1) {
    if (!hex) return `rgba(0,0,0,${alpha})`;

    hex = hex.replace('#', '').trim();

    // Handle shorthand hex (e.g., #fff)
    if (hex.length === 3) {
      hex = hex.split('').map(c => c + c).join('');
    }

    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    return `rgba(${r},${g},${b},${alpha})`;
  }

  // =========================================================================
  // CHART CONFIGURATION BUILDERS
  // =========================================================================

  /**
   * Creates configuration for the CO2 doughnut chart.
   * @param {Object} colors - Theme colors
   * @param {number} valueKg - Total CO2 in kilograms
   * @returns {Object} ECharts option configuration
   */
  function createCO2DoughnutConfig(colors, valueKg) {
    const displayValue = valueKg ? +(valueKg / 1000).toFixed(2) : 0;
    const hasData = displayValue > 0;

    return {
      tooltip: {
        show: hasData,
        trigger: 'item',
        backgroundColor: colors.cardBg,
        borderColor: colors.border,
        textStyle: { color: colors.text },
        formatter: function(params) {
          if (params.name === 'placeholder') return '';
          return `${params.name}: ${params.value.toLocaleString()} tCO\u2082`;
        }
      },
      series: [{
        type: 'pie',
        radius: ['60%', '80%'],
        center: ['50%', '50%'],
        avoidLabelOverlap: false,
        itemStyle: {
          borderRadius: 6,
          borderColor: colors.cardBg,
          borderWidth: 2
        },
        label: {
          show: true,
          position: 'center',
          formatter: function() {
            if (!hasData) {
              return '{empty|0}\n{unit|tCO\u2082}';
            }
            return `{value|${displayValue.toLocaleString()}}\n{unit|tCO\u2082}`;
          },
          rich: {
            value: {
              fontSize: 28,
              fontWeight: 600,
              color: colors.text,
              lineHeight: 36
            },
            empty: {
              fontSize: 28,
              fontWeight: 600,
              color: colors.textSecondary,
              lineHeight: 36
            },
            unit: {
              fontSize: 13,
              color: colors.textSecondary,
              lineHeight: 20
            }
          }
        },
        emphasis: {
          label: { show: true },
          itemStyle: {
            shadowBlur: 10,
            shadowColor: hexToRgba(colors.primary, 0.3)
          }
        },
        labelLine: { show: false },
        data: hasData ? [
          {
            value: displayValue,
            name: 'Sequestered',
            itemStyle: { color: colors.primary }
          },
          {
            value: Math.max(1, Math.round(displayValue * 0.2)),
            name: 'placeholder',
            itemStyle: { color: hexToRgba(colors.text, 0.06) }
          }
        ] : [
          {
            value: 1,
            name: 'No data',
            itemStyle: { color: hexToRgba(colors.text, 0.1) }
          }
        ],
        animationDuration: 1200,
        animationDelay: 200
      }]
    };
  }

  /**
   * Creates configuration for the Area gauge chart.
   * @param {Object} colors - Theme colors
   * @param {number} value - Area in hectares
   * @returns {Object} ECharts option configuration
   */
  function createAreaGaugeConfig(colors, value) {
    const displayValue = value || 0;
    const maxValue = Math.max(displayValue * 1.5, 10);

    return {
      tooltip: {
        show: true,
        formatter: `Area: ${displayValue} ha`,
        backgroundColor: colors.cardBg,
        borderColor: colors.border,
        textStyle: { color: colors.text }
      },
      series: [{
        type: 'gauge',
        startAngle: 200,
        endAngle: -20,
        radius: '90%',
        center: ['50%', '60%'],
        min: 0,
        max: maxValue,
        progress: {
          show: true,
          width: 16,
          itemStyle: {
            color: colors.primary,
            shadowBlur: 6,
            shadowColor: hexToRgba(colors.primary, 0.4)
          }
        },
        axisLine: {
          lineStyle: {
            width: 16,
            color: [[1, hexToRgba(colors.text, 0.08)]]
          }
        },
        pointer: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        title: {
          show: true,
          offsetCenter: [0, '30%'],
          color: colors.textSecondary,
          fontSize: 13,
          fontWeight: 400
        },
        detail: {
          show: true,
          valueAnimation: true,
          fontSize: 32,
          fontWeight: 600,
          color: colors.text,
          offsetCenter: [0, '-10%'],
          formatter: function() {
            return displayValue + ' ha';
          }
        },
        data: [{
          value: displayValue,
          name: displayValue === 0 ? 'No area data' : 'Hectares'
        }],
        animationDuration: 1200,
        animationDelay: 400
      }]
    };
  }

  /**
   * Creates configuration for the Total Plants bar chart.
   * @param {Object} colors - Theme colors
   * @param {number} value - Total plants planted
   * @returns {Object} ECharts option configuration
   */
  function createPlantsBarConfig(colors, value) {
    const displayValue = value || 0;
    const hasData = displayValue > 0;

    // Create a simple horizontal bar showing progress
    const target = Math.max(displayValue * 1.3, 1000);
    const percentage = Math.min((displayValue / target) * 100, 100);

    return {
      tooltip: {
        show: true,
        formatter: `Total: ${displayValue.toLocaleString()} plants`,
        backgroundColor: colors.cardBg,
        borderColor: colors.border,
        textStyle: { color: colors.text }
      },
      grid: {
        left: '10%',
        right: '10%',
        top: '45%',
        bottom: '25%'
      },
      xAxis: {
        type: 'value',
        max: 100,
        show: false
      },
      yAxis: {
        type: 'category',
        data: ['Plants'],
        show: false
      },
      graphic: [
        {
          type: 'text',
          left: 'center',
          top: '20%',
          style: {
            text: hasData ? displayValue.toLocaleString() : '0',
            fontSize: 28,
            fontWeight: 600,
            fill: hasData ? colors.text : colors.textSecondary,
            textAlign: 'center'
          }
        },
        {
          type: 'text',
          left: 'center',
          bottom: '8%',
          style: {
            text: hasData ? 'plants planted' : 'No plants yet',
            fontSize: 12,
            fill: colors.textSecondary,
            textAlign: 'center'
          }
        }
      ],
      series: [{
        type: 'bar',
        data: [percentage],
        barWidth: 12,
        itemStyle: {
          color: colors.primary,
          borderRadius: 6
        },
        backgroundStyle: {
          color: hexToRgba(colors.text, 0.08),
          borderRadius: 6
        },
        showBackground: true,
        animationDuration: 1200,
        animationDelay: 600
      }]
    };
  }

  // =========================================================================
  // CHART INITIALIZATION
  // =========================================================================

  /**
   * Initializes all project breakdown charts.
   * @returns {Array} Array of ECharts instances
   */
  function initializeCharts() {
    const dataEl = document.getElementById('project-breakdown-data');
    if (!dataEl) return [];

    const totalCo2Kg = Number(dataEl.dataset.totalCo2) || 0;
    const areaHa = Number(dataEl.dataset.areaHectares) || 0;
    const totalPlants = Number(dataEl.dataset.totalPlants) || 0;

    const colors = getThemeColors();
    const charts = [];

    // CO2 Doughnut
    const co2El = document.getElementById('pbCo2Chart');
    if (co2El && window.echarts) {
      const co2Chart = echarts.init(co2El);
      co2Chart.setOption(createCO2DoughnutConfig(colors, totalCo2Kg));
      charts.push({ el: co2El, chart: co2Chart, type: 'co2', value: totalCo2Kg });
      hideLoading(co2El);
    }

    // Area Gauge
    const areaEl = document.getElementById('pbAreaChart');
    if (areaEl && window.echarts) {
      const areaChart = echarts.init(areaEl);
      areaChart.setOption(createAreaGaugeConfig(colors, areaHa));
      charts.push({ el: areaEl, chart: areaChart, type: 'area', value: areaHa });
      hideLoading(areaEl);
    }

    // Plants Bar
    const plantsEl = document.getElementById('pbPlantsChart');
    if (plantsEl && window.echarts) {
      const plantsChart = echarts.init(plantsEl);
      plantsChart.setOption(createPlantsBarConfig(colors, totalPlants));
      charts.push({ el: plantsEl, chart: plantsChart, type: 'plants', value: totalPlants });
      hideLoading(plantsEl);
    }

    // Handle window resize
    let resizeTimeout;
    window.addEventListener('resize', function() {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(function() {
        charts.forEach(item => item.chart.resize());
      }, 100);
    });

    // Handle theme changes - reinitialize charts when theme switches
    const observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        if (mutation.attributeName === 'data-bs-theme' || mutation.attributeName === 'data-theme') {
          // Small delay to let CSS variables update
          setTimeout(function() {
            const newColors = getThemeColors();

            charts.forEach(function(item) {
              const chart = echarts.getInstanceByDom(item.el);
              if (!chart) return;

              switch (item.type) {
                case 'co2':
                  chart.setOption(createCO2DoughnutConfig(newColors, item.value));
                  break;
                case 'area':
                  chart.setOption(createAreaGaugeConfig(newColors, item.value));
                  break;
                case 'plants':
                  chart.setOption(createPlantsBarConfig(newColors, item.value));
                  break;
              }
            });
          }, 50);
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-bs-theme', 'data-theme']
    });

    return charts;
  }

  // =========================================================================
  // LOADING STATE
  // =========================================================================

  /**
   * Hides the loading spinner for a chart container.
   * @param {HTMLElement} chartEl - The chart element
   */
  function hideLoading(chartEl) {
    const container = chartEl.closest('.chart-container');
    if (container) {
      container.classList.remove('loading');
    }
  }

  /**
   * Shows loading spinners on all chart containers.
   */
  function showLoadingState() {
    const chartContainers = document.querySelectorAll('#project-breakdown .chart-container');
    chartContainers.forEach(container => {
      container.classList.add('loading');
    });
  }

  // =========================================================================
  // LIFECYCLE MANAGEMENT
  // =========================================================================

  /**
   * Sets up the initialization lifecycle for charts.
   * Handles tab-based lazy loading and fallback for direct page loads.
   */
  function setupLifecycle() {
    const breakdownTab = document.getElementById('project-breakdown-tab');
    const breakdownPane = document.getElementById('project-breakdown');

    if (breakdownTab && breakdownPane) {
      // If already active, init immediately
      if (breakdownPane.classList.contains('show') || breakdownPane.classList.contains('active')) {
        initializeCharts();
      }

      // Listen for bootstrap tab shown event
      document.addEventListener('shown.bs.tab', function (e) {
        if (!e || !e.target) return;
        if (e.target.id === 'project-breakdown-tab') {
          // Check if charts already initialized
          const co2El = document.getElementById('pbCo2Chart');
          if (co2El && !echarts.getInstanceByDom(co2El)) {
            initializeCharts();
          }
        }
      });
    } else {
      // Fallback: init on DOM ready
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeCharts);
      } else {
        initializeCharts();
      }
    }
  }

  // =========================================================================
  // PUBLIC API
  // =========================================================================

  // Expose initialization function globally for potential external use
  window.ProjectBreakdownCharts = {
    init: initializeCharts,
    showLoading: showLoadingState,
    getThemeColors: getThemeColors
  };

  // Start lifecycle setup
  setupLifecycle();

})();
