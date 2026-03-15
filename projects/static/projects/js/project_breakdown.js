/**
 * Project Breakdown Charts Module
 *
 * Mirrors dashboard.js pattern exactly — exposes ProjectBreakdownCharts.init()
 * which is called from an inline script after shown.bs.tab fires.
 */

(function () {
  'use strict';

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

  function hexToRgba(hex, alpha = 1) {
    if (!hex) return `rgba(0,0,0,${alpha})`;
    hex = hex.replace('#', '').trim();
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

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
        itemStyle: { borderRadius: 6, borderColor: colors.cardBg, borderWidth: 2 },
        label: {
          show: true,
          position: 'center',
          formatter: function() {
            if (!hasData) return '{empty|0}\n{unit|tCO\u2082}';
            return `{value|${displayValue.toLocaleString()}}\n{unit|tCO\u2082}`;
          },
          rich: {
            value: { fontSize: 28, fontWeight: 600, color: colors.text, lineHeight: 36 },
            empty: { fontSize: 28, fontWeight: 600, color: colors.textSecondary, lineHeight: 36 },
            unit: { fontSize: 13, color: colors.textSecondary, lineHeight: 20 }
          }
        },
        emphasis: {
          label: { show: true },
          itemStyle: { shadowBlur: 10, shadowColor: hexToRgba(colors.primary, 0.3) }
        },
        labelLine: { show: false },
        data: hasData ? [
          { value: displayValue, name: 'Sequestered', itemStyle: { color: colors.primary } },
          { value: Math.max(1, Math.round(displayValue * 0.2)), name: 'placeholder', itemStyle: { color: hexToRgba(colors.text, 0.06) } }
        ] : [
          { value: 1, name: 'No data', itemStyle: { color: hexToRgba(colors.text, 0.1) } }
        ],
        animationDuration: 1200,
        animationDelay: 200
      }]
    };
  }

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
          itemStyle: { color: colors.primary, shadowBlur: 6, shadowColor: hexToRgba(colors.primary, 0.4) }
        },
        axisLine: { lineStyle: { width: 16, color: [[1, hexToRgba(colors.text, 0.08)]] } },
        pointer: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        title: { show: true, offsetCenter: [0, '30%'], color: colors.textSecondary, fontSize: 13, fontWeight: 400 },
        detail: {
          show: true,
          valueAnimation: true,
          fontSize: 32,
          fontWeight: 600,
          color: colors.text,
          offsetCenter: [0, '-10%'],
          formatter: function() { return displayValue + ' ha'; }
        },
        data: [{ value: displayValue, name: displayValue === 0 ? 'No area data' : 'Hectares' }],
        animationDuration: 1200,
        animationDelay: 400
      }]
    };
  }

  function createPlantsBarConfig(colors, value) {
    const displayValue = value || 0;
    const hasData = displayValue > 0;
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
      grid: { left: '10%', right: '10%', top: '45%', bottom: '25%' },
      xAxis: { type: 'value', max: 100, show: false },
      yAxis: { type: 'category', data: ['Plants'], show: false },
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
        itemStyle: { color: colors.primary, borderRadius: 6 },
        backgroundStyle: { color: hexToRgba(colors.text, 0.08), borderRadius: 6 },
        showBackground: true,
        animationDuration: 1200,
        animationDelay: 600
      }]
    };
  }

  function initializeCharts() {
    const dataEl = document.getElementById('project-breakdown-data');
    if (!dataEl || !window.echarts) return;

    const totalCo2Kg = Number(dataEl.dataset.totalCo2) || 0;
    const areaHa = Number(dataEl.dataset.areaHectares) || 0;
    const totalPlants = Number(dataEl.dataset.totalPlants) || 0;

    const colors = getThemeColors();
    const charts = [];

    const co2El = document.getElementById('pbCo2Chart');
    if (co2El) {
      const existing = echarts.getInstanceByDom(co2El);
      if (existing) existing.dispose();
      const co2Chart = echarts.init(co2El);
      co2Chart.setOption(createCO2DoughnutConfig(colors, totalCo2Kg));
      charts.push(co2Chart);
    }

    const areaEl = document.getElementById('pbAreaChart');
    if (areaEl) {
      const existing = echarts.getInstanceByDom(areaEl);
      if (existing) existing.dispose();
      const areaChart = echarts.init(areaEl);
      areaChart.setOption(createAreaGaugeConfig(colors, areaHa));
      charts.push(areaChart);
    }

    const plantsEl = document.getElementById('pbPlantsChart');
    if (plantsEl) {
      const existing = echarts.getInstanceByDom(plantsEl);
      if (existing) existing.dispose();
      const plantsChart = echarts.init(plantsEl);
      plantsChart.setOption(createPlantsBarConfig(colors, totalPlants));
      charts.push(plantsChart);
    }

    let resizeTimeout;
    window.addEventListener('resize', function() {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(function() {
        charts.forEach(chart => chart.resize());
      }, 100);
    });

    const observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        if (mutation.attributeName === 'data-bs-theme' || mutation.attributeName === 'data-theme') {
          setTimeout(function() { initializeCharts(); }, 50);
        }
      });
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-bs-theme', 'data-theme']
    });
  }

  window.ProjectBreakdownCharts = {
    init: initializeCharts,
    getThemeColors: getThemeColors
  };

})();
