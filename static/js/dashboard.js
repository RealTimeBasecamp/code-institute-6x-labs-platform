/**
 * Dashboard Charts Module
 *
 * Initializes and manages ECharts visualizations for the dashboard.
 * Uses CSS theme variables for consistent styling across light/dark modes.
 * Handles empty data gracefully with placeholder displays.
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

  /**
   * Generates a color palette derived from the primary color.
   * Creates variations for multi-series charts.
   * @param {string} primaryHex - Primary color in hex format
   * @param {number} count - Number of colors needed
   * @returns {Array<string>} Array of hex colors
   */
  function generateColorPalette(primaryHex, count = 5) {
    const colors = [primaryHex];

    // Generate variations by adjusting lightness
    const variations = [
      hexToRgba(primaryHex, 0.8),
      hexToRgba(primaryHex, 0.6),
      hexToRgba(primaryHex, 0.4),
      hexToRgba(primaryHex, 0.25)
    ];

    return colors.concat(variations).slice(0, count);
  }

  // =========================================================================
  // CHART CONFIGURATION BUILDERS
  // =========================================================================

  /**
   * Creates configuration for the overview area chart (full-width).
   * Shows project activity over time.
   * @param {Object} colors - Theme colors
   * @param {Object} data - Chart data {years, values, label}
   * @returns {Object} ECharts option configuration
   */
  function createOverviewChartConfig(colors, data) {
    const hasData = data.years && data.years.length > 0 && data.values.some(v => v > 0);

    // Fallback data when no real data exists
    const years = hasData ? data.years : ['2021', '2022', '2023', '2024', '2025'];
    const values = hasData ? data.values : [0, 0, 0, 0, 0];

    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: colors.cardBg,
        borderColor: colors.border,
        textStyle: { color: colors.text },
        formatter: function(params) {
          const point = params[0];
          if (!hasData) {
            return `<strong>${point.name}</strong><br/>No data yet`;
          }
          return `<strong>${point.name}</strong><br/>${data.label || 'Value'}: ${point.value.toLocaleString()}`;
        }
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '12%',
        top: '10%',
        containLabel: true
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: years,
        axisLine: {
          lineStyle: { color: hexToRgba(colors.text, 0.2) }
        },
        axisLabel: {
          color: colors.textSecondary,
          fontSize: 12
        },
        axisTick: { show: false }
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        splitLine: {
          lineStyle: {
            color: hexToRgba(colors.text, 0.08),
            type: 'dashed'
          }
        },
        axisLabel: {
          color: colors.textSecondary,
          fontSize: 12,
          formatter: function(value) {
            if (value >= 1000) return (value / 1000) + 'k';
            return value;
          }
        }
      },
      series: [{
        name: data.label || 'Plants Planted',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 8,
        sampling: 'lttb',
        itemStyle: {
          color: colors.primary
        },
        lineStyle: {
          color: colors.primary,
          width: 3
        },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: hexToRgba(colors.primary, 0.3) },
              { offset: 1, color: hexToRgba(colors.primary, 0.02) }
            ]
          }
        },
        emphasis: {
          itemStyle: {
            borderColor: colors.primary,
            borderWidth: 3
          }
        },
        data: values,
        animationDelay: function(idx) {
          return idx * 50;
        }
      }],
      animationEasing: 'cubicOut',
      animationDuration: 1000
    };
  }

  /**
   * Creates configuration for the projects gauge chart.
   * @param {Object} colors - Theme colors
   * @param {number} value - Number of projects
   * @returns {Object} ECharts option configuration
   */
  function createProjectsGaugeConfig(colors, value) {
    const displayValue = value || 0;
    const maxValue = Math.max(displayValue * 1.5, 10); // Dynamic max for better visual

    return {
      tooltip: {
        show: true,
        formatter: `Projects: ${displayValue}`,
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
          formatter: '{value}'
        },
        data: [{
          value: displayValue,
          name: displayValue === 0 ? 'No projects yet' : 'Active'
        }],
        animationDuration: 1200,
        animationDelay: 200
      }]
    };
  }

  /**
   * Creates configuration for the CO2 doughnut chart.
   * @param {Object} colors - Theme colors
   * @param {number} value - Total CO2 saved (tonnes)
   * @returns {Object} ECharts option configuration
   */
  function createCO2DoughnutConfig(colors, value) {
    const displayValue = value || 0;
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
            name: 'Saved',
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
        animationDelay: 400
      }]
    };
  }

  /**
   * Creates configuration for the Years of Growth radial bar.
   * @param {Object} colors - Theme colors
   * @param {number} value - Years of growth
   * @returns {Object} ECharts option configuration
   */
  function createYearsRadialConfig(colors, value) {
    const displayValue = value || 0;
    const maxYears = Math.max(displayValue + 5, 10);
    const percentage = (displayValue / maxYears) * 100;

    return {
      tooltip: {
        show: true,
        formatter: `${displayValue} year${displayValue !== 1 ? 's' : ''} of growth`,
        backgroundColor: colors.cardBg,
        borderColor: colors.border,
        textStyle: { color: colors.text }
      },
      series: [{
        type: 'gauge',
        startAngle: 90,
        endAngle: -270,
        radius: '85%',
        pointer: { show: false },
        progress: {
          show: true,
          overlap: false,
          roundCap: true,
          clip: false,
          width: 14,
          itemStyle: {
            color: colors.primary
          }
        },
        axisLine: {
          lineStyle: {
            width: 14,
            color: [[1, hexToRgba(colors.text, 0.08)]]
          }
        },
        splitLine: { show: false },
        axisTick: { show: false },
        axisLabel: { show: false },
        title: {
          show: true,
          offsetCenter: [0, '30%'],
          color: colors.textSecondary,
          fontSize: 12
        },
        detail: {
          show: true,
          valueAnimation: true,
          fontSize: 26,
          fontWeight: 600,
          color: colors.text,
          offsetCenter: [0, '-5%'],
          formatter: function(val) {
            return displayValue + (displayValue === 1 ? ' yr' : ' yrs');
          }
        },
        data: [{
          value: percentage,
          name: displayValue === 0 ? 'Just starting' : 'Growing'
        }],
        animationDuration: 1200,
        animationDelay: 600
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
        animationDelay: 800
      }]
    };
  }

  // =========================================================================
  // CHART INITIALIZATION
  // =========================================================================

  /**
   * Initializes all dashboard charts with the provided data.
   * @param {Object} dashboardData - Data object from the server
   */
  function initializeCharts(dashboardData) {
    const colors = getThemeColors();
    const charts = [];

    // Overview Chart (full-width area chart)
    const overviewEl = document.getElementById('overviewChart');
    if (overviewEl) {
      const overviewChart = echarts.init(overviewEl);
      overviewChart.setOption(createOverviewChartConfig(colors, {
        years: dashboardData.plantsYears || [],
        values: dashboardData.plantsValues || [],
        label: 'Plants Planted'
      }));
      charts.push(overviewChart);
    }

    // Projects Gauge
    const projectsEl = document.getElementById('projectsChart');
    if (projectsEl) {
      const projectsChart = echarts.init(projectsEl);
      projectsChart.setOption(createProjectsGaugeConfig(colors, dashboardData.numProjects));
      charts.push(projectsChart);
    }

    // CO2 Doughnut
    const co2El = document.getElementById('co2Chart');
    if (co2El) {
      const co2Chart = echarts.init(co2El);
      co2Chart.setOption(createCO2DoughnutConfig(colors, dashboardData.totalCo2));
      charts.push(co2Chart);
    }

    // Years Radial
    const yearsEl = document.getElementById('yearsChart');
    if (yearsEl) {
      const yearsChart = echarts.init(yearsEl);
      yearsChart.setOption(createYearsRadialConfig(colors, dashboardData.yearsOfGrowth));
      charts.push(yearsChart);
    }

    // Plants Bar (using total plants)
    const plantsEl = document.getElementById('plantsChart');
    if (plantsEl) {
      const plantsChart = echarts.init(plantsEl);
      plantsChart.setOption(createPlantsBarConfig(colors, dashboardData.totalPlants));
      charts.push(plantsChart);
    }

    // Handle window resize
    let resizeTimeout;
    window.addEventListener('resize', function() {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(function() {
        charts.forEach(chart => chart.resize());
      }, 100);
    });

    // Handle theme changes - reinitialize charts when theme switches
    const observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        if (mutation.attributeName === 'data-bs-theme' || mutation.attributeName === 'data-theme') {
          // Small delay to let CSS variables update
          setTimeout(function() {
            const newColors = getThemeColors();

            if (overviewEl) {
              const chart = echarts.getInstanceByDom(overviewEl);
              if (chart) {
                chart.setOption(createOverviewChartConfig(newColors, {
                  years: dashboardData.plantsYears || [],
                  values: dashboardData.plantsValues || [],
                  label: 'Plants Planted'
                }));
              }
            }

            if (projectsEl) {
              const chart = echarts.getInstanceByDom(projectsEl);
              if (chart) chart.setOption(createProjectsGaugeConfig(newColors, dashboardData.numProjects));
            }

            if (co2El) {
              const chart = echarts.getInstanceByDom(co2El);
              if (chart) chart.setOption(createCO2DoughnutConfig(newColors, dashboardData.totalCo2));
            }

            if (yearsEl) {
              const chart = echarts.getInstanceByDom(yearsEl);
              if (chart) chart.setOption(createYearsRadialConfig(newColors, dashboardData.yearsOfGrowth));
            }

            if (plantsEl) {
              const chart = echarts.getInstanceByDom(plantsEl);
              if (chart) chart.setOption(createPlantsBarConfig(newColors, dashboardData.totalPlants));
            }
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
   * Shows loading spinners on all chart containers.
   */
  function showLoadingState() {
    const chartContainers = document.querySelectorAll('.chart-container');
    chartContainers.forEach(container => {
      container.classList.add('loading');
    });
  }

  /**
   * Hides loading spinners from all chart containers.
   */
  function hideLoadingState() {
    const chartContainers = document.querySelectorAll('.chart-container');
    chartContainers.forEach(container => {
      container.classList.remove('loading');
    });
  }

  // =========================================================================
  // PUBLIC API
  // =========================================================================

  // Expose initialization function globally
  window.DashboardCharts = {
    init: initializeCharts,
    showLoading: showLoadingState,
    hideLoading: hideLoadingState,
    getThemeColors: getThemeColors
  };

})();
