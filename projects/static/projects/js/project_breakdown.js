(function () {
  function hexToRgba(hex, alpha = 1) {
    if (!hex) return `rgba(0,0,0,${alpha})`;
    hex = hex.replace('#', '').trim();
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function init() {
    const dataEl = document.getElementById('project-breakdown-data');
    if (!dataEl) return;

    const totalCo2Kg = Number(dataEl.dataset.totalCo2) || 0;
    const areaHa = Number(dataEl.dataset.areaHectares) || 0;
    const totalPlants = Number(dataEl.dataset.totalPlants) || 0;
    const projectName = dataEl.dataset.projectName || '';

    const rootStyles = getComputedStyle(document.documentElement);
    const mainColor = rootStyles.getPropertyValue('--primary-color').trim() || '#059acc';
    const textColor = rootStyles.getPropertyValue('--bs-body-color').trim() || '#111';

    // chart instances container
    const charts = [];

    // CO2 chart (convert kg -> t)
    const co2El = document.getElementById('pbCo2Chart');
    if (co2El && window.echarts) {
      const co2Chart = echarts.init(co2El);
      const totalTonnes = +(totalCo2Kg / 1000).toFixed(2);
      const placeholder = Math.max(1, Math.round(totalTonnes * 0.15));
      co2Chart.setOption({
        title: { text: projectName, left: 'center', top: 6, textStyle: { color: textColor, fontSize: 12 } },
        series: [{
          type: 'pie', radius: ['62%', '82%'], avoidLabelOverlap: false,
          label: { show: true, position: 'center', formatter: totalTonnes + '\n tCO₂', color: textColor, fontSize: 16 },
          data: [
            { value: totalTonnes, name: 'Sequestered', itemStyle: { color: mainColor } },
            { value: placeholder, name: 'placeholder', itemStyle: { color: hexToRgba(textColor, 0.08) } }
          ]
        }]
      });
      // remove spinner if any
      const s = co2El.querySelector('.spinner-border'); if (s) s.remove();
      charts.push(co2Chart);
    }

    // Area chart - gauge style
    const areaEl = document.getElementById('pbAreaChart');
    if (areaEl && window.echarts) {
      const areaChart = echarts.init(areaEl);
      areaChart.setOption({
        series: [{
          type: 'gauge', startAngle: 180, endAngle: 0, radius: '100%',
          progress: { show: true, width: 16, itemStyle: { color: mainColor } },
          axisLine: { lineStyle: { width: 16, color: [[1, mainColor]] } },
          pointer: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false },
          title: { color: textColor },
          detail: { valueAnimation: true, fontSize: 22, color: textColor, formatter: areaHa + ' ha' },
          data: [{ value: areaHa, name: 'Area' }]
        }]
      });
      const s2 = areaEl.querySelector('.spinner-border'); if (s2) s2.remove();
      charts.push(areaChart);
    }

    // Plants chart - simple bar
    const plantsEl = document.getElementById('pbPlantsChart');
    if (plantsEl && window.echarts) {
      const plantsChart = echarts.init(plantsEl);
      plantsChart.setOption({
        xAxis: { type: 'category', data: ['Plants'], axisLine: { show: false }, axisLabel: { color: textColor } },
        yAxis: { type: 'value', axisLine: { show: false }, splitLine: { show: false }, axisLabel: { color: textColor } },
        series: [{ type: 'bar', data: [totalPlants], itemStyle: { color: mainColor }, barWidth: '40%' }],
        grid: { left: '6%', right: '6%', bottom: '12%', top: '6%' }
      });
      const s3 = plantsEl.querySelector('.spinner-border'); if (s3) s3.remove();
      charts.push(plantsChart);
    }

    // When any chart exists, handle resize on window
    if (charts.length) {
      window.addEventListener('resize', () => charts.forEach(c => c.resize()));
    }

    return charts;
  }

  function setupLifecycle() {
    // If breakdown tab is present, initialize when tab is shown (handles hidden-tab render)
    const breakdownTab = document.getElementById('project-breakdown-tab');
    const breakdownPane = document.getElementById('project-breakdown');
    if (breakdownTab && breakdownPane) {
      // If already active, init immediately
      if (breakdownPane.classList.contains('show') || breakdownPane.classList.contains('active')) {
        init();
      }
      // Listen for bootstrap tab shown event
      document.addEventListener('shown.bs.tab', function (e) {
        if (!e || !e.target) return;
        if (e.target.id === 'project-breakdown-tab') {
          init();
        }
      });
    } else {
      // fallback: init on DOM ready
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
      } else {
        init();
      }
    }
  }

  setupLifecycle();
})();
