/**
 * ============================================================================
 * MeteoRiotuerto — Almanaque meteorológico y climatológico digital (app.js)
 * ============================================================================
 * Controlador de vistas, carga progresiva de productos JSON, formateo español,
 * gráficos interactivos con Chart.js y exportación de datos.
 * ============================================================================
 */

'use strict';

(function () {
  /* ------------------------------------------------------------------------
   * Estado en memoria y caché de productos JSON
   * ------------------------------------------------------------------------ */
  const STATE = {
    theme: document.documentElement.getAttribute('data-theme') || 'light',
    route: 'portada',
    selectedYear: 2025,
    calendarMode: 'rain', // 'rain' | 'temp'
    include2026InComparisons: false,
    recordsRankingKey: 'top_hottest_days',
    explorer: {
      variable: 'temp_mean',
      yearFilter: 'all',
      dateFrom: '2022-01-01',
      dateTo: '2026-10-25',
      aggregation: 'daily', // 'daily' | 'monthly'
      episodeFilter: 'all',
      searchQuery: '',
      page: 1,
      pageSize: 30,
    },
    cache: {
      index: null,
      records: null,
      comparisons: null,
      almanacs: {}, // { 2022: {...}, ... }
    },
    charts: {}, // Instancias activas de Chart.js
  };

  const MONTH_NAMES_ES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ];
  const MONTH_SHORT_ES = [
    'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
    'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
  ];

  const EXPLORER_VARIABLES = {
    temp_mean: { label: 'Temperatura media diaria', unit: '°C', dec: 1, color: '#1b4332', type: 'line', agg: 'mean' },
    temp_max: { label: 'Temperatura máxima diaria', unit: '°C', dec: 1, color: '#c2410c', type: 'line', agg: 'max' },
    temp_min: { label: 'Temperatura mínima diaria', unit: '°C', dec: 1, color: '#0e7490', type: 'line', agg: 'min' },
    temp_amp: { label: 'Amplitud térmica diaria', unit: '°C', dec: 1, color: '#b45309', type: 'line', agg: 'mean' },
    rain_daily: { label: 'Precipitación diaria', unit: 'mm', dec: 1, color: '#0369a1', type: 'bar', agg: 'sum' },
    wind_gust: { label: 'Racha máxima de viento', unit: 'km/h', dec: 1, color: '#0f766e', type: 'line', agg: 'max' },
    wind_speed: { label: 'Velocidad media del viento', unit: 'km/h', dec: 1, color: '#2d6a4f', type: 'line', agg: 'mean' },
    humidity_mean: { label: 'Humedad relativa media', unit: '%', dec: 1, color: '#0284c7', type: 'line', agg: 'mean' },
    pressure_rel: { label: 'Presión atmosférica media', unit: 'hPa', dec: 1, color: '#475569', type: 'line', agg: 'mean' },
    solar_max: { label: 'Radiación solar máxima diaria', unit: 'W/m²', dec: 1, color: '#d97706', type: 'line', agg: 'max' },
  };

  /* ------------------------------------------------------------------------
   * Utilidades de formato numérico y fechas en español
   * ------------------------------------------------------------------------ */
  function fmtNum(val, decimals = 1, suffix = '') {
    if (val === null || val === undefined || Number.isNaN(Number(val))) {
      return '—';
    }
    const formatted = Number(val).toLocaleString('es-ES', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    return suffix ? `${formatted} ${suffix}` : formatted;
  }

  function fmtSignNum(val, decimals = 1, suffix = '') {
    if (val === null || val === undefined || Number.isNaN(Number(val))) {
      return '—';
    }
    const num = Number(val);
    const sign = num > 0 ? '+' : '';
    return sign + fmtNum(num, decimals, suffix);
  }

  function fmtDateES(isoDate, longFormat = true) {
    if (!isoDate || typeof isoDate !== 'string') return '—';
    const parts = isoDate.slice(0, 10).split('-');
    if (parts.length !== 3) return isoDate;
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    if (!longFormat) {
      return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
    }
    return `${d} de ${MONTH_NAMES_ES[m - 1].toLowerCase()} de ${y}`;
  }

  function fmtDateShortMonth(isoDate) {
    if (!isoDate || typeof isoDate !== 'string') return '—';
    const parts = isoDate.slice(0, 10).split('-');
    if (parts.length !== 3) return isoDate;
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    return `${d} ${MONTH_SHORT_ES[m - 1].toLowerCase()}.`;
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ------------------------------------------------------------------------
   * Carga de datos JSON con caché
   * ------------------------------------------------------------------------ */
  async function fetchJson(filename) {
    const res = await fetch(`./data/${filename}`);
    if (!res.ok) {
      throw new Error(`No se pudo cargar ./data/${filename} (HTTP ${res.status})`);
    }
    return res.json();
  }

  async function ensureIndexLoaded() {
    if (!STATE.cache.index) {
      STATE.cache.index = await fetchJson('index.json');
    }
    return STATE.cache.index;
  }

  async function ensureRecordsLoaded() {
    if (!STATE.cache.records) {
      STATE.cache.records = await fetchJson('records.json');
    }
    return STATE.cache.records;
  }

  async function ensureComparisonsLoaded() {
    if (!STATE.cache.comparisons) {
      STATE.cache.comparisons = await fetchJson('comparisons.json');
    }
    return STATE.cache.comparisons;
  }

  async function ensureAlmanacLoaded(year) {
    const y = Number(year);
    if (!STATE.cache.almanacs[y]) {
      STATE.cache.almanacs[y] = await fetchJson(`almanac_${y}.json`);
    }
    return STATE.cache.almanacs[y];
  }

  async function ensureAllAlmanacsLoaded() {
    const idx = await ensureIndexLoaded();
    const years = idx.series_overview.years_available;
    await Promise.all(years.map((y) => ensureAlmanacLoaded(y)));
    return STATE.cache.almanacs;
  }

  /* ------------------------------------------------------------------------
   * Gestión de instancias de Chart.js y paleta dinámica según tema
   * ------------------------------------------------------------------------ */
  function chartPalette() {
    const isDark = STATE.theme === 'dark';
    return {
      text: isDark ? '#d8e6e0' : '#263530',
      muted: isDark ? '#849c93' : '#5c6e68',
      grid: isDark ? 'rgba(255, 255, 255, 0.09)' : 'rgba(22, 33, 29, 0.09)',
      forest: isDark ? '#52b788' : '#1b4332',
      forestFill: isDark ? 'rgba(82, 183, 136, 0.2)' : 'rgba(27, 67, 50, 0.14)',
      rain: isDark ? '#38bdf8' : '#0284c7',
      rainBar: isDark ? 'rgba(56, 189, 248, 0.68)' : 'rgba(3, 105, 161, 0.72)',
      heat: isDark ? '#fb923c' : '#dc2626',
      cold: isDark ? '#22d3ee' : '#0284c7',
      ampBand: isDark ? 'rgba(251, 146, 60, 0.22)' : 'rgba(234, 88, 12, 0.20)',
      wind: isDark ? '#2dd4bf' : '#0f766e',
      solar: isDark ? '#fbbf24' : '#d97706',
    };
  }

  function destroyChartsInPrefix(prefix) {
    Object.keys(STATE.charts).forEach((key) => {
      if (!prefix || key.startsWith(prefix)) {
        if (STATE.charts[key]) {
          STATE.charts[key].destroy();
        }
        delete STATE.charts[key];
      }
    });
  }

  function createChart(key, canvasId, config) {
    if (!window.Chart) return null;
    if (STATE.charts[key]) {
      STATE.charts[key].destroy();
    }
    const el = document.getElementById(canvasId);
    if (!el) return null;
    STATE.charts[key] = new window.Chart(el, config);
    return STATE.charts[key];
  }

  /* ------------------------------------------------------------------------
   * VISTA 1: PORTADA DEL ALMANAQUE
   * ------------------------------------------------------------------------ */
  async function renderPortada() {
    const [idx, comparisons] = await Promise.all([
      ensureIndexLoaded(),
      ensureComparisonsLoaded(),
    ]);

    const container = document.getElementById('view-portada');
    const overview = idx.series_overview;
    const ref = overview.reference_2022_2025;
    const rec = idx.headline_records;
    const yearsSummary = [...idx.years_summary].sort((a, b) => b.year - a.year);

    const almanacCardsHtml = yearsSummary.map((y) => {
      const badgeHtml = y.is_provisional
        ? `<span class="badge badge-provisional">Avance provisional</span>`
        : `<span class="badge badge-complete">Anuario cerrado · ${fmtNum(y.coverage_pct, 1)}%</span>`;
      return `
        <a href="#almanaque/${y.year}" class="almanac-card" aria-label="Abrir almanaque meteorológico de ${y.year}">
          <div>
            <div class="almanac-card-top">
              <span class="almanac-year-num">${y.year}</span>
              ${badgeHtml}
            </div>
            <div class="almanac-character">${escapeHtml(y.character)}</div>
            <p class="almanac-headline">
              Mes más húmedo: <strong>${escapeHtml(y.wettest_month)}</strong> (${fmtNum(y.wettest_month_mm, 1)} mm) ·
              Racha máx.: <strong>${fmtNum(y.wind_gust_max_kmh, 1)} km/h</strong>
            </p>
          </div>
          <div>
            <div class="almanac-mini-stats">
              <div>
                <span>T. media</span>
                <strong>${fmtNum(y.temp_mean, 1)} °C</strong>
              </div>
              <div>
                <span>Precipitación</span>
                <strong>${fmtNum(y.rain_total_mm, 1)} mm</strong>
              </div>
              <div>
                <span>Extremos térmicos</span>
                <strong>${fmtNum(y.temp_min_abs, 1)} / ${fmtNum(y.temp_max_abs, 1)} °C</strong>
              </div>
              <div>
                <span>Días de lluvia</span>
                <strong>${fmtNum(y.rain_days_02, 0)} días</strong>
              </div>
            </div>
            <div class="almanac-card-cta">
              <span>Consultar almanaque ${y.year}</span>
              <span aria-hidden="true">→</span>
            </div>
          </div>
        </a>
      `;
    }).join('');

    container.innerHTML = `
      <!-- Bloque editorial de presentación -->
      <article class="editorial-hero">
        <div class="editorial-kicker">NOTARIO DEL CLIMA DE RIOTUERTO · ARCHIVO HISTÓRICO VERIFICADO</div>
        <h2 id="portada-heading" class="editorial-title">
          La memoria meteorológica y climatológica del valle del Covadal
        </h2>
        <p class="editorial-lead">
          <strong>MeteoRiotuerto</strong> documenta, analiza y conserva el registro instrumental de las condiciones
          atmosféricas observadas en <strong>Barrio de Arriba (municipio de Riotuerto, Cantabria, 115 m s. n. m.)</strong>.
          Organizado como un almanaque anual, transforma las lecturas de la estación automática en crónicas sinópticas,
          series verificadas, efemérides y comparativas interanuales abiertas a vecinos, docentes e investigadores.
        </p>

        <div class="editorial-columns">
          <div class="notary-manifesto">
            <p>
              Situada en las estribaciones de la Cordillera Cantábrica, a 14 km del mar Cantábrico y a 5 km del puerto de Alisas,
              la estación captura un microclima de valle muy definido: <strong>elevada pluviosidad orográfica</strong> cuando los
              frentes del noroeste remontan la cuenca del Miera (superando habitualmente los 1.600–2.100 mm anuales) y
              <strong>marcadas suradas por efecto Foehn</strong> que desploman la humedad y disparan súbitamente la temperatura.
            </p>
            <p>
              Cada cifra publicada en este archivo procede directamente de los registros instrumentales validados,
              distinguiendo con rigor entre observaciones directas, indicadores derivados y contexto sinóptico.
            </p>
          </div>
          <aside class="complement-box" aria-label="Nota sobre consulta en tiempo real">
            <h3>¿Busca el dato meteorológico de este instante?</h3>
            <p style="margin-bottom:10px;color:var(--txt-secondary)">
              Esta publicación no es un portal de predicción meteorológica ni un monitor en vivo. Su función es explicar
              <strong>qué ocurrió, cómo fue cada año y qué patrones muestra el registro</strong>.
            </p>
            <a href="${idx.station.links.weathercloud || 'https://app.weathercloud.net/d6619283754'}" target="_blank" rel="noopener noreferrer" class="btn btn-primary" style="width:100%">
              Abrir panel en tiempo real en WeatherCloud ↗
            </a>
          </aside>
        </div>

        <!-- Tarjeta de localización geográfica y mapa de Riotuerto -->
        <div class="station-location-block" aria-label="Localización geográfica de Riotuerto">
          <div class="station-location-info">
            <h3 class="location-title">📍 Situación geográfica: ¿Dónde está Riotuerto y la estación?</h3>
            <p class="location-desc">
              El municipio de <strong>Riotuerto</strong> se sitúa en la comarca histórica de <strong>Trasmiera (Cantabria, norte de España)</strong>,
              en el valle medio-alto de la cuenca del río Miera, entre la capital municipal (<strong>La Cavada</strong>) y las estribaciones
              del <strong>puerto de Alisas (674 m s. n. m.)</strong>.
            </p>
            <p class="location-desc">
              La estación meteorológica automática está instalada en una pradera abierta en la localidad de <strong>Barrio de Arriba</strong> (115 m s. n. m.),
              un enclave caracterizado por un microclima de gran personalidad:
            </p>
            <ul class="location-highlights">
              <li><strong>Retención orográfica Cantábrica:</strong> a solo 14 km del mar Cantábrico, las masas de aire húmedo del noroeste quedan retenidas contra la barrera montañosa, generando una elevada pluviosidad (1.600 a más de 2.100 mm anuales).</li>
              <li><strong>Efecto Foehn («suradas»):</strong> cuando el viento sopla del sur desciende recalentado desde la divisoria de la cordillera, disparando bruscamente las temperaturas y hundiendo la humedad relativa.</li>
              <li><strong>Distancias clave:</strong> a 5 km de Alisas, a 7 km de Liérganes, a 16 km del aeropuerto de Santander y a 23 km de la ciudad de Santander.</li>
            </ul>
            <div class="location-coord-badge mono">
              <span>Coordenadas WGS84: <a href="https://www.openstreetmap.org/?mlat=43.341&mlon=-3.670#map=15/43.341/-3.670" target="_blank" rel="noopener noreferrer" style="text-decoration:underline"><strong>43.341° N, 3.670° W</strong></a> (43.341, -3.670)</span>
              <span>Altitud: <strong>115 m s. n. m.</strong></span>
            </div>
          </div>
          <div class="station-location-map-wrap">
            <iframe
              class="station-osm-map"
              src="https://www.openstreetmap.org/export/embed.html?bbox=-3.770%2C43.295%2C-3.560%2C43.385&amp;layer=mapnik&amp;marker=43.341%2C-3.670"
              title="Mapa de situación de Riotuerto y la estación meteorológica en Barrio de Arriba (Cantabria)"
              loading="lazy">
            </iframe>
            <div class="map-link-bar">
              <a href="https://www.openstreetmap.org/?mlat=43.341&mlon=-3.670#map=15/43.341/-3.670" target="_blank" rel="noopener noreferrer">
                Explorar mapa en pantalla completa en OpenStreetMap ↗
              </a>
            </div>
          </div>
        </div>
      </article>

      <!-- Síntesis cuantitativa del archivo -->
      <div class="kpi-grid" aria-label="Indicadores generales del archivo">
        <div class="kpi-card accent-forest">
          <div class="kpi-label">Cobertura consolidada</div>
          <div class="kpi-value">${fmtNum(overview.total_observed_days, 0)} <span class="kpi-unit">días</span></div>
          <div class="kpi-meta">5 almanaques anuales (2022–2025 completos + 2026 en curso)</div>
        </div>
        <div class="kpi-card accent-rain">
          <div class="kpi-label">Precipitación media (2022–2025)</div>
          <div class="kpi-value">${fmtNum(ref.mean_annual_rain_mm, 1)} <span class="kpi-unit">mm/año</span></div>
          <div class="kpi-meta">Promedio de ${fmtNum(ref.mean_annual_rain_days, 0)} días de lluvia apreciable (≥0,2 mm) al año</div>
        </div>
        <div class="kpi-card accent-heat">
          <div class="kpi-label">Temperatura media (2022–2025)</div>
          <div class="kpi-value">${fmtNum(ref.mean_annual_temp_c, 1)} <span class="kpi-unit">°C</span></div>
          <div class="kpi-meta">Amplitud extrema observada entre ${fmtNum(rec.temp_min.value, 1)} °C y ${fmtNum(rec.temp_max.value, 1)} °C</div>
        </div>
        <div class="kpi-card accent-wind">
          <div class="kpi-label">Techo de racha eólica</div>
          <div class="kpi-value">${fmtNum(rec.max_wind_gust.value, 1)} <span class="kpi-unit">km/h</span></div>
          <div class="kpi-meta">Registrado el ${fmtDateES(rec.max_wind_gust.date, false)} (borrasca Karlotta)</div>
        </div>
      </div>

      <!-- Colección de Almanaques Anuales -->
      <section class="section-block" aria-labelledby="sec-almanaques-title">
        <div class="section-header">
          <div>
            <h2 id="sec-almanaques-title" class="section-title">Almanaques meteorológicos anuales</h2>
            <p class="section-subtitle">Seleccione un año para abrir su crónica sinóptica, gráficas diarias, rosa de vientos y tablas mensuales</p>
          </div>
          <a href="#comparativas" class="btn">Comparar todos los años →</a>
        </div>
        <div class="almanac-cards-grid">
          ${almanacCardsHtml}
        </div>
      </section>

      <!-- Selección de récords históricos destacados -->
      <section class="section-block" aria-labelledby="sec-records-portada">
        <div class="section-header">
          <div>
            <h2 id="sec-records-portada" class="section-title">Hitos y extremos históricos registrados</h2>
            <p class="section-subtitle">Valores extremos verificados en la serie observada por la estación MeteoRiotuerto</p>
          </div>
          <a href="#records" class="btn">Ver todos los récords y rankings Top 10 →</a>
        </div>
        <div class="kpi-grid">
          <div class="kpi-card accent-heat">
            <div class="kpi-label">${escapeHtml(rec.temp_max.label)}</div>
            <div class="kpi-value">${fmtNum(rec.temp_max.value, 1)} <span class="kpi-unit">°C</span></div>
            <div class="kpi-meta"><strong>${fmtDateES(rec.temp_max.date)}</strong> (${rec.temp_max.time} h) · Efecto Foehn</div>
          </div>
          <div class="kpi-card accent-cold">
            <div class="kpi-label">${escapeHtml(rec.temp_min.label)}</div>
            <div class="kpi-value">${fmtNum(rec.temp_min.value, 1)} <span class="kpi-unit">°C</span></div>
            <div class="kpi-meta"><strong>${fmtDateES(rec.temp_min.date)}</strong> (${rec.temp_min.time} h) · Inversión térmica</div>
          </div>
          <div class="kpi-card accent-rain">
            <div class="kpi-label">${escapeHtml(rec.max_daily_rain.label)}</div>
            <div class="kpi-value">${fmtNum(rec.max_daily_rain.value, 1)} <span class="kpi-unit">mm</span></div>
            <div class="kpi-meta"><strong>${fmtDateES(rec.max_daily_rain.date)}</strong> · Borrasca Fien (enero de 509,8 mm)</div>
          </div>
          <div class="kpi-card accent-rain">
            <div class="kpi-label">Intensidad máxima de lluvia</div>
            <div class="kpi-value">${fmtNum(rec.max_rain_rate.value, 1)} <span class="kpi-unit">mm/h</span></div>
            <div class="kpi-meta"><strong>${fmtDateES(rec.max_rain_rate.date)}</strong> (${rec.max_rain_rate.time} h) · 44,2 mm en 1 h</div>
          </div>
        </div>
      </section>

      <!-- Evolución interanual y tabla resumen en portada -->
      <section class="section-block" aria-labelledby="sec-evol-title">
        <div class="section-header">
          <div>
            <h2 id="sec-evol-title" class="section-title">Evolución interanual del registro (2022–2026)</h2>
            <p class="section-subtitle">Comparación de acumulados pluviométricos, regímenes térmicos y días característicos</p>
          </div>
          <div class="btn-group">
            <a href="#explorador" class="btn">Abrir explorador interactivo</a>
            <a href="#metodologia" class="btn">Metodología y descargas</a>
          </div>
        </div>

        <div class="charts-grid-2">
          <div class="chart-panel">
            <div class="chart-panel-header">
              <div>
                <h3 class="chart-panel-title">Precipitación acumulada y días de lluvia por año</h3>
                <p class="chart-panel-subtitle">Media de años cerrados (2022–2025): 1.875,0 mm · 2026 muestra el avance hasta el 25 de octubre</p>
              </div>
            </div>
            <div class="chart-canvas-wrap">
              <canvas id="chart-home-rain"></canvas>
            </div>
          </div>

          <div class="chart-panel">
            <div class="chart-panel-header">
              <div>
                <h3 class="chart-panel-title">Perfil térmico anual (media, media de máximas y mínimas)</h3>
                <p class="chart-panel-subtitle">Valores expresados en °C · 2026 es provisional al no incluir aún noviembre y diciembre</p>
              </div>
            </div>
            <div class="chart-canvas-wrap">
              <canvas id="chart-home-temp"></canvas>
            </div>
          </div>
        </div>
      </section>
    `;

    // Renderizar gráficos de portada
    renderHomeCharts(comparisons);
  }

  function renderHomeCharts(comparisons) {
    const pal = chartPalette();
    const rows = comparisons.yearly_table;
    const labels = rows.map((r) => (r.is_provisional ? `${r.year} (prov.)` : String(r.year)));

    createChart('home_rain', 'chart-home-rain', {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Precipitación total (mm)',
            data: rows.map((r) => r.rain_total_mm),
            backgroundColor: rows.map((r) => (r.is_provisional ? 'rgba(56, 189, 248, 0.38)' : pal.rainBar)),
            borderColor: pal.rain,
            borderWidth: 1.5,
            borderRadius: 5,
            yAxisID: 'y',
          },
          {
            label: 'Días de lluvia (≥0,2 mm)',
            data: rows.map((r) => r.rain_days_02),
            type: 'line',
            borderColor: pal.forest,
            backgroundColor: pal.forest,
            borderWidth: 2.5,
            pointRadius: 4,
            tension: 0.25,
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: pal.text } },
        },
        scales: {
          x: { ticks: { color: pal.text }, grid: { color: pal.grid } },
          y: {
            position: 'left',
            beginAtZero: true,
            title: { display: true, text: 'Precipitación (mm)', color: pal.text },
            ticks: { color: pal.text },
            grid: { color: pal.grid },
          },
          y1: {
            position: 'right',
            beginAtZero: true,
            max: 300,
            title: { display: true, text: 'Días con lluvia ≥0,2 mm', color: pal.text },
            ticks: { color: pal.text },
            grid: { drawOnChartArea: false },
          },
        },
      },
    });

    createChart('home_temp', 'chart-home-temp', {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Media de las máximas (°C)',
            data: rows.map((r) => r.temp_max_mean),
            borderColor: pal.heat,
            backgroundColor: pal.heat,
            borderWidth: 2,
            pointRadius: 4,
            tension: 0.25,
          },
          {
            label: 'Temperatura media anual (°C)',
            data: rows.map((r) => r.temp_mean),
            borderColor: pal.forest,
            backgroundColor: pal.forest,
            borderWidth: 3,
            pointRadius: 5,
            tension: 0.25,
          },
          {
            label: 'Media de las mínimas (°C)',
            data: rows.map((r) => r.temp_min_mean),
            borderColor: pal.cold,
            backgroundColor: pal.cold,
            borderWidth: 2,
            pointRadius: 4,
            tension: 0.25,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: pal.text } },
        },
        scales: {
          x: { ticks: { color: pal.text }, grid: { color: pal.grid } },
          y: {
            title: { display: true, text: 'Temperatura (°C)', color: pal.text },
            ticks: { color: pal.text },
            grid: { color: pal.grid },
          },
        },
      },
    });
  }

  /* ------------------------------------------------------------------------
   * VISTA 2: ALMANAQUE ANUAL (Plantilla reutilizable 2022–2026)
   * ------------------------------------------------------------------------ */
  async function renderAlmanaque(year) {
    const [idx, alm] = await Promise.all([
      ensureIndexLoaded(),
      ensureAlmanacLoaded(year),
    ]);

    STATE.selectedYear = alm.year;
    const container = document.getElementById('view-almanaque');
    const yearsAvailable = idx.series_overview.years_available;
    const stT = alm.stats.temperature;
    const stP = alm.stats.precipitation;
    const stW = alm.stats.wind;
    const stA = alm.stats.atmosphere_and_solar;
    const cov = alm.coverage;
    const ed = alm.editorial || {};

    const pillsHtml = yearsAvailable.map((y) => {
      const isAct = y === alm.year ? 'active' : '';
      const label = y === 2026 ? '2026 (Prov.)' : String(y);
      return `<a href="#almanaque/${y}" class="year-pill ${isAct}">${label}</a>`;
    }).join('');

    // Avisos específicos de cobertura o provisionalidad
    const banners = [];
    if (alm.is_provisional) {
      banners.push(`
        <div class="callout callout-warning">
          <strong>Aviso de datos parciales y provisionales (${alm.year}):</strong>
          El año ${alm.year} se encuentra actualmente en curso. Todas las estadísticas, acumulados y gráficos corresponden
          al periodo observado hasta el <strong>${fmtDateES(alm.last_observed_date)}</strong> (${cov.valid_days} días) y tienen
          carácter provisional hasta el cierre del año natural el 31 de diciembre.
        </div>
      `);
    }
    if (cov.missing_days > 0) {
      banners.push(`
        <div class="callout callout-info">
          <strong>Nota de cobertura instrumental (${cov.valid_days} de ${cov.observed_span_days} días con datos · ${fmtNum(cov.coverage_pct, 1)}%):</strong>
          ${escapeHtml(ed.data_note || `Se registran ${cov.missing_days} días sin observación en este año.`)}
        </div>
      `);
    } else if (ed.data_note) {
      banners.push(`
        <div class="callout callout-forest">
          <strong>Cobertura de la serie ${alm.year}:</strong> ${escapeHtml(ed.data_note)}
        </div>
      `);
    }

    // Episodios destacados del año
    const episodesHtml = (ed.episodes || []).map((ep) => `
      <article class="episode-item episode-type-${escapeHtml(ep.type)}">
        <div class="episode-header">
          <span class="episode-date">${fmtDateES(ep.date, false)}</span>
          <span class="episode-val">${escapeHtml(ep.value)}</span>
        </div>
        <h4 class="episode-title">${escapeHtml(ep.title)}</h4>
        <p class="episode-desc">${escapeHtml(ep.description)}</p>
      </article>
    `).join('');

    // Filas de la tabla mensual
    const monthlyRowsHtml = alm.monthly.map((m) => {
      if (m.valid_days === 0) {
        return `
          <tr>
            <td><strong>${m.name}</strong></td>
            <td class="num" colspan="10" style="text-align:center;color:var(--txt-muted)">Mes aún no observado o sin registros</td>
          </tr>
        `;
      }
      const incTag = m.valid_days < m.calendar_days
        ? ` <span title="${m.valid_days} de ${m.calendar_days} días observados" style="color:var(--accent-solar);font-size:0.75rem">(${m.valid_days}/${m.calendar_days} d)</span>`
        : '';
      return `
        <tr>
          <td><strong>${m.name}</strong>${incTag}</td>
          <td class="num"><strong>${fmtNum(m.temp_mean, 1)}</strong></td>
          <td class="num">${fmtNum(m.temp_max_mean, 1)}</td>
          <td class="num">${fmtNum(m.temp_min_mean, 1)}</td>
          <td class="num" style="color:var(--accent-heat)">${fmtNum(m.temp_max_abs, 1)} <small>(${fmtDateShortMonth(m.temp_max_date)})</small></td>
          <td class="num" style="color:var(--accent-cold)">${fmtNum(m.temp_min_abs, 1)} <small>(${fmtDateShortMonth(m.temp_min_date)})</small></td>
          <td class="num" style="color:var(--accent-rain)"><strong>${fmtNum(m.rain_total, 1)}</strong></td>
          <td class="num">${fmtNum(m.rain_days_02, 0)}</td>
          <td class="num">${fmtNum(m.rain_max_day, 1)} <small>(${fmtDateShortMonth(m.rain_max_date)})</small></td>
          <td class="num">${fmtNum(m.wind_gust_max, 1)}</td>
          <td class="num">${fmtNum(m.humidity_mean, 1)}%</td>
        </tr>
      `;
    }).join('');

    container.innerHTML = `
      <!-- Selector de edición anual -->
      <div class="year-switcher-bar" role="navigation" aria-label="Selector de año del almanaque">
        <div>
          <span class="editorial-kicker" style="margin:0">EDICIÓN ANUAL DEL ALMANAQUE</span>
          <h2 id="almanaque-heading" class="section-title" style="margin:0">
            Almanaque meteorológico ${alm.year} · Barrio de Arriba, Riotuerto
          </h2>
        </div>
        <div class="year-pills">
          ${pillsHtml}
        </div>
      </div>

      <div class="callouts-stack">
        ${banners.join('')}
      </div>

      <!-- Cabecera sinóptica y crónica del año -->
      <article class="editorial-hero">
        <div class="editorial-kicker">CARÁCTER SINÓPTICO: ${escapeHtml((ed.character || '').toUpperCase())}</div>
        <h3 class="editorial-title">${escapeHtml(ed.headline || `Síntesis climatológica del año ${alm.year}`)}</h3>
        <p class="editorial-lead">${escapeHtml(ed.synoptic_summary || '')}</p>
      </article>

      <div class="chronicle-grid">
        <div class="chronicle-card">
          <h3>🌡️ Comportamiento térmico</h3>
          <p>${escapeHtml(ed.thermal_notes || '')}</p>
        </div>
        <div class="chronicle-card">
          <h3>☔ Régimen pluviométrico</h3>
          <p>${escapeHtml(ed.rain_notes || '')}</p>
        </div>
        <div class="chronicle-card">
          <h3>💨 Dinámica eólica y atmosférica</h3>
          <p>${escapeHtml(ed.wind_notes || '')}</p>
        </div>
      </div>

      <!-- Indicadores principales del año -->
      <div class="kpi-grid">
        <div class="kpi-card accent-forest">
          <div class="kpi-label">Temperatura media anual</div>
          <div class="kpi-value">${fmtNum(stT.mean, 1)} <span class="kpi-unit">°C</span></div>
          <div class="kpi-meta">Media de máx.: ${fmtNum(stT.max_mean, 1)} °C · Media de mín.: ${fmtNum(stT.min_mean, 1)} °C</div>
        </div>
        <div class="kpi-card accent-heat">
          <div class="kpi-label">Máxima absoluta del año</div>
          <div class="kpi-value">${fmtNum(stT.max_abs, 1)} <span class="kpi-unit">°C</span></div>
          <div class="kpi-meta">${fmtDateES(stT.max_abs_date)}${stT.max_abs_time ? ` a las ${stT.max_abs_time} h` : ''} · ${stT.hot_days_ge_30} días ≥30 °C</div>
        </div>
        <div class="kpi-card accent-cold">
          <div class="kpi-label">Mínima absoluta del año</div>
          <div class="kpi-value">${fmtNum(stT.min_abs, 1)} <span class="kpi-unit">°C</span></div>
          <div class="kpi-meta">${fmtDateES(stT.min_abs_date)}${stT.min_abs_time ? ` a las ${stT.min_abs_time} h` : ''} · ${stT.frost_days_le_0} días de helada (≤0 °C)</div>
        </div>
        <div class="kpi-card accent-rain">
          <div class="kpi-label">Precipitación total acumulada</div>
          <div class="kpi-value">${fmtNum(stP.total_mm, 1)} <span class="kpi-unit">mm</span></div>
          <div class="kpi-meta">${stP.days_ge_02mm} días de lluvia (${fmtNum(stP.rain_days_pct, 1)}%) · Máx. 24h: ${fmtNum(stP.max_daily_mm, 1)} mm (${fmtDateShortMonth(stP.max_daily_date)})</div>
        </div>
        <div class="kpi-card accent-wind">
          <div class="kpi-label">Racha máxima de viento</div>
          <div class="kpi-value">${fmtNum(stW.max_gust_kmh, 1)} <span class="kpi-unit">km/h</span></div>
          <div class="kpi-meta">${fmtDateES(stW.max_gust_date)}${stW.max_gust_time ? ` (${stW.max_gust_time} h)` : ''} · ${stW.days_gust_ge_40} días ≥40 km/h</div>
        </div>
        <div class="kpi-card accent-solar">
          <div class="kpi-label">Radiación e insolación</div>
          <div class="kpi-value">${stA.estimated_sunshine_hours !== null ? `${fmtNum(stA.estimated_sunshine_hours, 0)} <span class="kpi-unit">h sol</span>` : `${fmtNum(stA.solar_max_wm2 || stA.solar_max_raw_wm2, 0)} <span class="kpi-unit">W/m²</span>`}</div>
          <div class="kpi-meta">Pico validado: ${fmtNum(stA.solar_max_wm2 || stA.solar_max_raw_wm2, 1)} W/m² · UV máx.: ${stA.uvi_max ?? stA.uvi_max_raw ?? '—'}</div>
        </div>
      </div>

      <!-- Episodios meteorológicos destacados del año -->
      <section class="section-block">
        <div class="section-header">
          <div>
            <h3 class="section-title">Efemérides y episodios destacados de ${alm.year}</h3>
            <p class="section-subtitle">Hitos atmosféricos documentados con los registros de la estación</p>
          </div>
        </div>
        <div class="episodes-list">
          ${episodesHtml}
        </div>
      </section>

      <!-- Gráficos principales: Climograma y Rango térmico diario -->
      <section class="section-block">
        <div class="section-header">
          <div>
            <h3 class="section-title">Dinámica termo-pluviométrica de ${alm.year}</h3>
            <p class="section-subtitle">Climograma mensual y curva diaria de temperaturas máximas, medias y mínimas</p>
          </div>
        </div>

        <div class="charts-grid-2">
          <div class="chart-panel">
            <div class="chart-panel-header">
              <div>
                <h4 class="chart-panel-title">Climograma anual (${alm.year})</h4>
                <p class="chart-panel-subtitle">Precipitación acumulada mensual (mm) y temperaturas medias, máximas y mínimas (°C)</p>
              </div>
            </div>
            <div class="chart-canvas-wrap">
              <canvas id="chart-alm-climogram"></canvas>
            </div>
          </div>

          <div class="chart-panel">
            <div class="chart-panel-header">
              <div>
                <h4 class="chart-panel-title">Evolución y amplitud térmica diaria (${alm.year})</h4>
                <p class="chart-panel-subtitle">Banda entre máxima y mínima diaria · Máx.: ${fmtNum(stT.max_abs, 1)} °C | Mín.: ${fmtNum(stT.min_abs, 1)} °C</p>
              </div>
            </div>
            <div class="chart-canvas-wrap">
              <canvas id="chart-alm-temprange"></canvas>
            </div>
          </div>
        </div>

        <!-- Calendario matricial anual interactivo (12 x 31) -->
        <div class="chart-panel" style="margin-bottom:24px">
          <div class="chart-panel-header">
            <div>
              <h4 class="chart-panel-title">Calendario diario de observación (${alm.year})</h4>
              <p class="chart-panel-subtitle">Mapa de calor día a día (1 a 31 de cada mes). Pase el cursor sobre cualquier celda para ver el detalle diario.</p>
            </div>
            <div class="btn-group" role="group" aria-label="Variable del calendario anual">
              <button type="button" id="btn-cal-rain" class="btn ${STATE.calendarMode === 'rain' ? 'btn-primary' : ''}">
                ☔ Precipitación diaria (mm)
              </button>
              <button type="button" id="btn-cal-temp" class="btn ${STATE.calendarMode === 'temp' ? 'btn-primary' : ''}">
                🌡️ Temperatura media (°C)
              </button>
            </div>
          </div>
          <div id="almanac-calendar-container" class="calendar-heatmap-wrap"></div>
        </div>

        <!-- Hietograma diario y rachas máximas -->
        <div class="charts-grid-2">
          <div class="chart-panel">
            <div class="chart-panel-header">
              <div>
                <h4 class="chart-panel-title">Distribución diaria de precipitaciones (${alm.year})</h4>
                <p class="chart-panel-subtitle">Lluvia diaria acumulada (mm) · ${stP.days_ge_10mm} días ≥10 mm y ${stP.days_ge_30mm} días ≥30 mm</p>
              </div>
            </div>
            <div class="chart-canvas-wrap">
              <canvas id="chart-alm-dailyrain"></canvas>
            </div>
          </div>

          <div class="chart-panel">
            <div class="chart-panel-header">
              <div>
                <h4 class="chart-panel-title">Rachas máximas diarias de viento (${alm.year})</h4>
                <p class="chart-panel-subtitle">Racha máxima diaria (km/h) y umbral de viento fuerte (40 km/h)</p>
              </div>
            </div>
            <div class="chart-canvas-wrap">
              <canvas id="chart-alm-windgust"></canvas>
            </div>
          </div>
        </div>

        <!-- Rosa de los vientos y Escala Beaufort -->
        <div class="charts-grid-2">
          <div class="chart-panel">
            <div class="chart-panel-header">
              <div>
                <h4 class="chart-panel-title">Frecuencia por dirección del viento (16 sectores)</h4>
                <p class="chart-panel-subtitle">Sector predominante: ${stW.predominant_sector} · Basado en ${fmtNum(alm.wind_analysis.total_direction_observations, 0)} observaciones (${alm.wind_analysis.source_resolution})</p>
              </div>
            </div>
            <div class="chart-canvas-wrap">
              <canvas id="chart-alm-windrose"></canvas>
            </div>
          </div>

          <div class="chart-panel">
            <div class="chart-panel-header">
              <div>
                <h4 class="chart-panel-title">Clasificación de días según la escala de Beaufort</h4>
                <p class="chart-panel-subtitle">Distribución del viento medio diario en el fondo del valle del Covadal</p>
              </div>
            </div>
            <div class="chart-canvas-wrap">
              <canvas id="chart-alm-beaufort"></canvas>
            </div>
          </div>
        </div>
      </section>

      <!-- Ficha estadística exhaustiva del año -->
      <section class="section-block">
        <div class="section-header">
          <div>
            <h3 class="section-title">Ficha estadística anual completa (${alm.year})</h3>
            <p class="section-subtitle">Indicadores observados y conteo de umbrales térmicos, pluviométricos y eólicos</p>
          </div>
          <div class="btn-group">
            <button type="button" id="btn-dl-year-csv" class="btn">⬇ Descargar serie diaria ${alm.year} (CSV)</button>
            <a href="./data/almanac_${alm.year}.json" download="meteoriotuerto_almanaque_${alm.year}.json" class="btn">⬇ Descargar JSON anual</a>
          </div>
        </div>

        <div class="stats-two-col">
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th colspan="3">Termometría y umbrales térmicos (${alm.year})</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>Temperatura media anual</td><td class="num"><strong>${fmtNum(stT.mean, 1)} °C</strong></td><td>Promedio de ${cov.valid_days} días</td></tr>
                <tr><td>Media de las máximas diarias</td><td class="num">${fmtNum(stT.max_mean, 1)} °C</td><td></td></tr>
                <tr><td>Media de las mínimas diarias</td><td class="num">${fmtNum(stT.min_mean, 1)} °C</td><td></td></tr>
                <tr><td>Temperatura máxima absoluta</td><td class="num"><strong>${fmtNum(stT.max_abs, 1)} °C</strong></td><td>${fmtDateES(stT.max_abs_date)}${stT.max_abs_time ? ` (${stT.max_abs_time} h)` : ''}</td></tr>
                <tr><td>Temperatura mínima absoluta</td><td class="num"><strong>${fmtNum(stT.min_abs, 1)} °C</strong></td><td>${fmtDateES(stT.min_abs_date)}${stT.min_abs_time ? ` (${stT.min_abs_time} h)` : ''}</td></tr>
                <tr><td>Día más frío (máxima más baja)</td><td class="num">${fmtNum(stT.lowest_max, 1)} °C</td><td>${fmtDateES(stT.lowest_max_date)}</td></tr>
                <tr><td>Noche más cálida (mínima más alta)</td><td class="num">${fmtNum(stT.highest_min, 1)} °C</td><td>${fmtDateES(stT.highest_min_date)}</td></tr>
                <tr><td>Mayor amplitud térmica diaria</td><td class="num">${fmtNum(stT.max_daily_amplitude, 1)} °C</td><td>${fmtDateES(stT.max_daily_amplitude_date)} (media: ${fmtNum(stT.mean_daily_amplitude, 1)} °C)</td></tr>
                <tr><td>Días de helada (T. mín. ≤ 0 °C)</td><td class="num">${stT.frost_days_le_0} días</td><td></td></tr>
                <tr><td>Días cálidos (T. máx. ≥ 25 °C)</td><td class="num">${stT.warm_days_ge_25} días</td><td></td></tr>
                <tr><td>Días de calor (T. máx. ≥ 30 °C)</td><td class="num">${stT.hot_days_ge_30} días</td><td></td></tr>
                <tr><td>Días de calor intenso (T. máx. ≥ 35 °C)</td><td class="num">${stT.intense_heat_days_ge_35} días</td><td></td></tr>
                <tr><td>Días de calor extremo (T. máx. ≥ 40 °C)</td><td class="num">${stT.extreme_heat_days_ge_40} días</td><td></td></tr>
                <tr><td>Noches tropicales (T. mín. ≥ 20 °C)</td><td class="num">${stT.tropical_nights_ge_20} días</td><td>Noches ecuatoriales (≥25 °C): ${stT.torrid_nights_ge_25}</td></tr>
              </tbody>
            </table>
          </div>

          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th colspan="3">Pluviometría, viento y atmósfera (${alm.year})</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>Precipitación total acumulada</td><td class="num"><strong>${fmtNum(stP.total_mm, 1)} mm</strong></td><td>${fmtNum(stP.rain_days_pct, 1)}% de los días con lluvia</td></tr>
                <tr><td>Días de lluvia apreciable (≥ 0,2 mm)</td><td class="num">${stP.days_ge_02mm} días</td><td>Días ≥ 1,0 mm: ${stP.days_ge_1mm} días</td></tr>
                <tr><td>Días de lluvia abundante (≥ 10 mm)</td><td class="num">${stP.days_ge_10mm} días</td><td>Días muy fuertes (≥ 30 mm): ${stP.days_ge_30mm} días</td></tr>
                <tr><td>Precipitación máxima en 24 horas</td><td class="num"><strong>${fmtNum(stP.max_daily_mm, 1)} mm</strong></td><td>${fmtDateES(stP.max_daily_date)}</td></tr>
                <tr><td>Intensidad máxima de precipitación</td><td class="num">${fmtNum(stP.max_rain_rate_mm_h, 1)} mm/h</td><td>${fmtDateES(stP.max_rain_rate_date)}${stP.max_rain_rate_time ? ` (${stP.max_rain_rate_time} h)` : ''}</td></tr>
                <tr><td>Mes más lluvioso / más seco</td><td class="num">${stP.wettest_month} (${fmtNum(stP.wettest_month_mm, 1)} mm)</td><td>Mín.: ${stP.driest_month} (${fmtNum(stP.driest_month_mm, 1)} mm)</td></tr>
                <tr><td>Racha más larga de días lloviendo</td><td class="num">${stP.spells.max_wet_days} días seguidos</td><td>${fmtDateShortMonth(stP.spells.max_wet_start)} a ${fmtDateShortMonth(stP.spells.max_wet_end)}</td></tr>
                <tr><td>Racha más larga sin lluvia (< 0,2 mm)</td><td class="num">${stP.spells.max_dry_days} días seguidos</td><td>${fmtDateShortMonth(stP.spells.max_dry_start)} a ${fmtDateShortMonth(stP.spells.max_dry_end)}</td></tr>
                <tr><td>Velocidad media del viento</td><td class="num">${fmtNum(stW.mean_speed_kmh, 1)} km/h</td><td>Rumbo dominante: ${stW.predominant_sector}</td></tr>
                <tr><td>Racha máxima de viento</td><td class="num"><strong>${fmtNum(stW.max_gust_kmh, 1)} km/h</strong></td><td>${fmtDateES(stW.max_gust_date)}${stW.max_gust_time ? ` (${stW.max_gust_time} h)` : ''}</td></tr>
                <tr><td>Días con rachas ≥ 40 km/h / ≥ 60 km/h</td><td class="num">${stW.days_gust_ge_40} días</td><td>Rachas ≥ 60 km/h: ${stW.days_gust_ge_60} días</td></tr>
                <tr><td>Humedad relativa media / mínima</td><td class="num">${fmtNum(stA.humidity_mean_pct, 1)} %</td><td>Mín.: ${fmtNum(stA.humidity_min_pct, 0)} % (${fmtDateShortMonth(stA.humidity_min_date)})</td></tr>
                <tr><td>Presión atmosférica máx. / mín.</td><td class="num">${fmtNum(stA.pressure_max_hpa, 1)} hPa</td><td>Mín.: ${fmtNum(stA.pressure_min_hpa, 1)} hPa (${fmtDateShortMonth(stA.pressure_min_date)})</td></tr>
                <tr><td>Radiación solar máx. / Horas sol est.</td><td class="num">${fmtNum(stA.solar_max_wm2 || stA.solar_max_raw_wm2, 1)} W/m²</td><td>${stA.estimated_sunshine_hours !== null ? `${fmtNum(stA.estimated_sunshine_hours, 1)} h (≥120 W/m²)` : 'Serie 30 min no disponible'}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- Desglose mensual en tabla -->
      <section class="section-block">
        <div class="section-header">
          <div>
            <h3 class="section-title">Resumen climatológico mensual (${alm.year})</h3>
            <p class="section-subtitle">Valores mensuales de temperatura, extremos absolutos, precipitación, rachas de viento y humedad</p>
          </div>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Mes</th>
                <th class="num">T. media (°C)</th>
                <th class="num">Med. máx. (°C)</th>
                <th class="num">Med. mín. (°C)</th>
                <th class="num">T. máx. abs. (°C)</th>
                <th class="num">T. mín. abs. (°C)</th>
                <th class="num">Lluvia (mm)</th>
                <th class="num">Días ≥0,2 mm</th>
                <th class="num">Máx. 24h (mm)</th>
                <th class="num">Racha máx. (km/h)</th>
                <th class="num">Humedad med.</th>
              </tr>
            </thead>
            <tbody>
              ${monthlyRowsHtml}
            </tbody>
            <tfoot>
              <tr>
                <td>Anual / Total (${alm.year})</td>
                <td class="num">${fmtNum(stT.mean, 1)}</td>
                <td class="num">${fmtNum(stT.max_mean, 1)}</td>
                <td class="num">${fmtNum(stT.min_mean, 1)}</td>
                <td class="num">${fmtNum(stT.max_abs, 1)}</td>
                <td class="num">${fmtNum(stT.min_abs, 1)}</td>
                <td class="num">${fmtNum(stP.total_mm, 1)}</td>
                <td class="num">${fmtNum(stP.days_ge_02mm, 0)}</td>
                <td class="num">${fmtNum(stP.max_daily_mm, 1)}</td>
                <td class="num">${fmtNum(stW.max_gust_kmh, 1)}</td>
                <td class="num">${fmtNum(stA.humidity_mean_pct, 1)}%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    `;

    // Eventos del calendario y descarga
    renderCalendarMatrix(alm, STATE.calendarMode);
    document.getElementById('btn-cal-rain')?.addEventListener('click', () => {
      STATE.calendarMode = 'rain';
      document.getElementById('btn-cal-rain')?.classList.add('btn-primary');
      document.getElementById('btn-cal-temp')?.classList.remove('btn-primary');
      renderCalendarMatrix(alm, 'rain');
    });
    document.getElementById('btn-cal-temp')?.addEventListener('click', () => {
      STATE.calendarMode = 'temp';
      document.getElementById('btn-cal-temp')?.classList.add('btn-primary');
      document.getElementById('btn-cal-rain')?.classList.remove('btn-primary');
      renderCalendarMatrix(alm, 'temp');
    });
    document.getElementById('btn-dl-year-csv')?.addEventListener('click', () => {
      downloadYearDailyCSV(alm);
    });

    // Renderizar gráficos del almanaque
    renderAlmanacCharts(alm);
  }

  function renderCalendarMatrix(alm, mode) {
    const wrap = document.getElementById('almanac-calendar-container');
    if (!wrap) return;

    const ds = alm.daily_series;
    const byDate = {};
    ds.dates.forEach((d, idx) => {
      byDate[d] = {
        rain: ds.rain_daily[idx],
        tmean: ds.temp_mean[idx],
        tmax: ds.temp_max[idx],
        tmin: ds.temp_min[idx],
        gust: ds.wind_gust[idx],
      };
    });

    const isLeap = (alm.year % 4 === 0 && alm.year % 100 !== 0) || (alm.year % 400 === 0);
    const daysInMonths = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

    let dayHeaders = '<tr><th class="month-label">Mes \\ Día</th>';
    for (let d = 1; d <= 31; d++) {
      dayHeaders += `<th>${d}</th>`;
    }
    dayHeaders += '</tr>';

    let bodyRows = '';
    for (let m = 1; m <= 12; m++) {
      const maxD = daysInMonths[m - 1];
      bodyRows += `<tr><th class="month-label">${MONTH_SHORT_ES[m - 1]}</th>`;
      for (let d = 1; d <= 31; d++) {
        if (d > maxD) {
          bodyRows += `<td class="cal-cell invalid-day"></td>`;
          continue;
        }
        const iso = `${alm.year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const rec = byDate[iso];
        const val = rec ? (mode === 'rain' ? rec.rain : rec.tmean) : null;

        if (!rec || val === null || val === undefined) {
          bodyRows += `<td class="cal-cell missing-day" title="${fmtDateES(iso)}: Sin datos">—</td>`;
          continue;
        }

        const style = getCalendarCellStyle(val, mode);
        const disp = val === 0 && mode === 'rain' ? '0' : fmtNum(val, val >= 10 || val <= -1 ? 0 : 1);
        const tooltip = `${fmtDateES(iso, false)} · T.med: ${fmtNum(rec.tmean, 1)} °C (${fmtNum(rec.tmin, 1)} / ${fmtNum(rec.tmax, 1)} °C) · Lluvia: ${fmtNum(rec.rain, 1)} mm · Racha: ${fmtNum(rec.gust, 1)} km/h`;
        bodyRows += `<td class="cal-cell" style="${style}" title="${escapeHtml(tooltip)}">${disp}</td>`;
      }
      bodyRows += '</tr>';
    }

    wrap.innerHTML = `<table class="calendar-matrix" aria-label="Calendario diario de ${alm.year}"><thead>${dayHeaders}</thead><tbody>${bodyRows}</tbody></table>`;
  }

  function getCalendarCellStyle(val, mode) {
    if (mode === 'rain') {
      if (val <= 0) return 'background:var(--bg-subtle);color:var(--txt-muted);';
      if (val < 2) return 'background:#bae6fd;color:#0c4a6e;';
      if (val < 10) return 'background:#38bdf8;color:#082f49;font-weight:600;';
      if (val < 25) return 'background:#0284c7;color:#ffffff;font-weight:600;';
      if (val < 50) return 'background:#0369a1;color:#ffffff;font-weight:700;';
      return 'background:#1e3a8a;color:#ffffff;font-weight:700;';
    }
    // Temperatura media (°C)
    if (val <= 4) return 'background:#0284c7;color:#ffffff;font-weight:600;';
    if (val <= 9) return 'background:#7dd3fc;color:#082f49;';
    if (val <= 14) return 'background:#e0f2fe;color:#0c4a6e;';
    if (val <= 18) return 'background:#fef3c7;color:#78350f;';
    if (val <= 22) return 'background:#fdba74;color:#7c2d12;font-weight:600;';
    return 'background:#ea580c;color:#ffffff;font-weight:700;';
  }

  function renderAlmanacCharts(alm) {
    const pal = chartPalette();
    const mLabels = alm.monthly.map((m) => m.short);
    const ds = alm.daily_series;
    const shortDates = ds.dates.map((d) => fmtDateShortMonth(d));

    // 1. Climograma anual
    createChart('alm_climogram', 'chart-alm-climogram', {
      type: 'bar',
      data: {
        labels: mLabels,
        datasets: [
          {
            label: 'T. máxima media (°C)',
            data: alm.monthly.map((m) => m.temp_max_mean),
            type: 'line',
            borderColor: pal.heat,
            backgroundColor: pal.heat,
            borderWidth: 2,
            pointRadius: 3.5,
            tension: 0.3,
            yAxisID: 'yTemp',
          },
          {
            label: 'T. media mensual (°C)',
            data: alm.monthly.map((m) => m.temp_mean),
            type: 'line',
            borderColor: pal.forest,
            backgroundColor: pal.forest,
            borderWidth: 2.8,
            pointRadius: 4,
            tension: 0.3,
            yAxisID: 'yTemp',
          },
          {
            label: 'T. mínima media (°C)',
            data: alm.monthly.map((m) => m.temp_min_mean),
            type: 'line',
            borderColor: pal.cold,
            backgroundColor: pal.cold,
            borderWidth: 2,
            pointRadius: 3.5,
            tension: 0.3,
            yAxisID: 'yTemp',
          },
          {
            label: 'Precipitación mensual (mm)',
            data: alm.monthly.map((m) => m.rain_total),
            backgroundColor: pal.rainBar,
            borderColor: pal.rain,
            borderWidth: 1,
            borderRadius: 4,
            yAxisID: 'yRain',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: pal.text } } },
        scales: {
          x: { ticks: { color: pal.text }, grid: { color: pal.grid } },
          yRain: {
            position: 'left',
            beginAtZero: true,
            title: { display: true, text: 'Precipitación (mm)', color: pal.text },
            ticks: { color: pal.text },
            grid: { color: pal.grid },
          },
          yTemp: {
            position: 'right',
            title: { display: true, text: 'Temperatura (°C)', color: pal.text },
            ticks: { color: pal.text },
            grid: { drawOnChartArea: false },
          },
        },
      },
    });

    // 2. Rango térmico diario
    createChart('alm_temprange', 'chart-alm-temprange', {
      type: 'line',
      data: {
        labels: shortDates,
        datasets: [
          {
            label: 'T. máxima diaria (°C)',
            data: ds.temp_max,
            borderColor: pal.heat,
            backgroundColor: pal.ampBand,
            borderWidth: 1.3,
            pointRadius: 0,
            fill: '+1',
            tension: 0.15,
          },
          {
            label: 'T. mínima diaria (°C)',
            data: ds.temp_min,
            borderColor: pal.cold,
            backgroundColor: 'transparent',
            borderWidth: 1.3,
            pointRadius: 0,
            fill: false,
            tension: 0.15,
          },
          {
            label: 'T. media diaria (°C)',
            data: ds.temp_mean,
            borderColor: pal.forest,
            borderWidth: 1.6,
            pointRadius: 0,
            fill: false,
            tension: 0.15,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: pal.text } } },
        scales: {
          x: { ticks: { color: pal.text, maxTicksLimit: 12 }, grid: { color: pal.grid } },
          y: {
            title: { display: true, text: 'Temperatura (°C)', color: pal.text },
            ticks: { color: pal.text },
            grid: { color: pal.grid },
          },
        },
      },
    });

    // 3. Lluvia diaria
    createChart('alm_dailyrain', 'chart-alm-dailyrain', {
      type: 'bar',
      data: {
        labels: shortDates,
        datasets: [
          {
            label: 'Precipitación diaria (mm)',
            data: ds.rain_daily,
            backgroundColor: pal.rainBar,
            borderColor: pal.rain,
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: pal.text } } },
        scales: {
          x: { ticks: { color: pal.text, maxTicksLimit: 12 }, grid: { color: pal.grid } },
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Precipitación diaria (mm)', color: pal.text },
            ticks: { color: pal.text },
            grid: { color: pal.grid },
          },
        },
      },
    });

    // 4. Rachas máximas diarias
    createChart('alm_windgust', 'chart-alm-windgust', {
      type: 'line',
      data: {
        labels: shortDates,
        datasets: [
          {
            label: 'Racha máxima diaria (km/h)',
            data: ds.wind_gust,
            borderColor: pal.wind,
            backgroundColor: pal.forestFill,
            borderWidth: 1.4,
            pointRadius: 0,
            fill: true,
            tension: 0.15,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: pal.text } } },
        scales: {
          x: { ticks: { color: pal.text, maxTicksLimit: 12 }, grid: { color: pal.grid } },
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Racha máxima (km/h)', color: pal.text },
            ticks: { color: pal.text },
            grid: { color: pal.grid },
          },
        },
      },
    });

    // 5. Rosa de los vientos (16 sectores)
    const rose = alm.wind_analysis.rose_16;
    createChart('alm_windrose', 'chart-alm-windrose', {
      type: 'bar',
      data: {
        labels: rose.map((r) => r.sector),
        datasets: [
          {
            label: 'Frecuencia relativa (%)',
            data: rose.map((r) => r.frequency_pct),
            backgroundColor: pal.rainBar,
            borderColor: pal.rain,
            borderWidth: 1.2,
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: pal.text } } },
        scales: {
          x: { ticks: { color: pal.text }, grid: { color: pal.grid } },
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Frecuencia (%)', color: pal.text },
            ticks: { color: pal.text },
            grid: { color: pal.grid },
          },
        },
      },
    });

    // 6. Distribución Beaufort
    const bft = alm.wind_analysis.beaufort_daily;
    createChart('alm_beaufort', 'chart-alm-beaufort', {
      type: 'bar',
      data: {
        labels: bft.map((b) => b.label),
        datasets: [
          {
            label: 'Número de días',
            data: bft.map((b) => b.days),
            backgroundColor: pal.forest,
            borderRadius: 4,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: pal.text } } },
        scales: {
          x: {
            beginAtZero: true,
            title: { display: true, text: 'Días en el año', color: pal.text },
            ticks: { color: pal.text },
            grid: { color: pal.grid },
          },
          y: { ticks: { color: pal.text }, grid: { color: pal.grid } },
        },
      },
    });
  }

  function downloadYearDailyCSV(alm) {
    const ds = alm.daily_series;
    const headers = [
      'fecha', 'temp_media_c', 'temp_max_c', 'temp_min_c', 'amplitud_c',
      'humedad_media_pct', 'lluvia_diaria_mm', 'viento_medio_kmh', 'racha_max_kmh',
      'direccion_viento_deg', 'presion_rel_hpa', 'radiacion_max_wm2', 'uvi_max',
    ];
    const rows = [headers.join(',')];
    ds.dates.forEach((d, i) => {
      rows.push([
        d,
        ds.temp_mean[i] ?? '',
        ds.temp_max[i] ?? '',
        ds.temp_min[i] ?? '',
        ds.temp_amp[i] ?? '',
        ds.humidity_mean[i] ?? '',
        ds.rain_daily[i] ?? '',
        ds.wind_speed[i] ?? '',
        ds.wind_gust[i] ?? '',
        ds.wind_dir[i] ?? '',
        ds.pressure_rel[i] ?? '',
        ds.solar_max[i] ?? '',
        ds.uvi_max[i] ?? '',
      ].join(','));
    });
    triggerBlobDownload(rows.join('\n'), `meteoriotuerto_diario_${alm.year}.csv`, 'text/csv;charset=utf-8;');
  }

  function triggerBlobDownload(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ------------------------------------------------------------------------
   * VISTA 3: EXPLORADOR DE DATOS HISTÓRICOS
   * ------------------------------------------------------------------------ */
  async function renderExplorador() {
    await ensureAllAlmanacsLoaded();
    const container = document.getElementById('view-explorador');

    const varOptionsHtml = Object.entries(EXPLORER_VARIABLES).map(([k, v]) => {
      const sel = STATE.explorer.variable === k ? 'selected' : '';
      return `<option value="${k}" ${sel}>${escapeHtml(v.label)} (${v.unit})</option>`;
    }).join('');

    container.innerHTML = `
      <article class="editorial-hero">
        <div class="editorial-kicker">HERRAMIENTA DE CONSULTA Y REUTILIZACIÓN CIENTÍFICA</div>
        <h2 id="explorador-heading" class="editorial-title">Explorador interactivo del registro histórico (2022–2026)</h2>
        <p class="editorial-lead">
          Consulte, filtre y descargue las observaciones diarias y mensuales registradas por MeteoRiotuerto.
          Puede acotar cualquier periodo temporal, aislar episodios de lluvia torrencial, heladas, golpes de calor
          o temporales de viento y exportar los registros resultantes.
        </p>
      </article>

      <form id="explorer-form" class="controls-toolbar" onsubmit="return false;">
        <div class="control-group">
          <label for="exp-var">Variable meteorológica</label>
          <select id="exp-var" class="form-select">${varOptionsHtml}</select>
        </div>
        <div class="control-group">
          <label for="exp-year">Filtro rápido de año</label>
          <select id="exp-year" class="form-select">
            <option value="all" ${STATE.explorer.yearFilter === 'all' ? 'selected' : ''}>Toda la serie (2022–2026)</option>
            <option value="2026" ${STATE.explorer.yearFilter === '2026' ? 'selected' : ''}>2026 (Provisional)</option>
            <option value="2025" ${STATE.explorer.yearFilter === '2025' ? 'selected' : ''}>2025</option>
            <option value="2024" ${STATE.explorer.yearFilter === '2024' ? 'selected' : ''}>2024</option>
            <option value="2023" ${STATE.explorer.yearFilter === '2023' ? 'selected' : ''}>2023</option>
            <option value="2022" ${STATE.explorer.yearFilter === '2022' ? 'selected' : ''}>2022</option>
          </select>
        </div>
        <div class="control-group">
          <label for="exp-from">Desde fecha</label>
          <input type="date" id="exp-from" class="form-input" value="${STATE.explorer.dateFrom}" min="2022-01-01" max="2026-10-25">
        </div>
        <div class="control-group">
          <label for="exp-to">Hasta fecha</label>
          <input type="date" id="exp-to" class="form-input" value="${STATE.explorer.dateTo}" min="2022-01-01" max="2026-10-25">
        </div>
        <div class="control-group">
          <label for="exp-episode">Filtro de umbral / episodio</label>
          <select id="exp-episode" class="form-select">
            <option value="all">Todos los registros válidos</option>
            <option value="frost">Días de helada (T. mín. ≤ 0 °C)</option>
            <option value="heat30">Días de calor (T. máx. ≥ 30 °C)</option>
            <option value="heat35">Calor intenso (T. máx. ≥ 35 °C)</option>
            <option value="tropical">Noches tropicales (T. mín. ≥ 20 °C)</option>
            <option value="rain02">Días con lluvia (≥ 0,2 mm)</option>
            <option value="rain10">Lluvia abundante (≥ 10 mm)</option>
            <option value="rain30">Lluvia muy fuerte (≥ 30 mm)</option>
            <option value="wind40">Viento fuerte (Racha ≥ 40 km/h)</option>
            <option value="wind60">Temporal de viento (Racha ≥ 60 km/h)</option>
          </select>
        </div>
        <div class="control-group">
          <label for="exp-agg">Resolución gráfica</label>
          <select id="exp-agg" class="form-select">
            <option value="daily" ${STATE.explorer.aggregation === 'daily' ? 'selected' : ''}>Serie diaria</option>
            <option value="monthly" ${STATE.explorer.aggregation === 'monthly' ? 'selected' : ''}>Agregación mensual</option>
          </select>
        </div>
      </form>

      <div id="explorer-kpis" class="kpi-grid"></div>

      <div class="chart-panel" style="margin-bottom:28px">
        <div class="chart-panel-header">
          <div>
            <h3 id="explorer-chart-title" class="chart-panel-title">Serie temporal</h3>
            <p id="explorer-chart-sub" class="chart-panel-subtitle"></p>
          </div>
          <div class="btn-group">
            <button type="button" id="btn-exp-csv" class="btn">⬇ Exportar selección (CSV)</button>
            <button type="button" id="btn-exp-json" class="btn">⬇ Exportar selección (JSON)</button>
          </div>
        </div>
        <div class="chart-canvas-wrap tall">
          <canvas id="chart-explorer-main"></canvas>
        </div>
      </div>

      <section class="section-block">
        <div class="section-header">
          <div>
            <h3 class="section-title">Tabla de registros diarios filtrados</h3>
            <p id="explorer-table-summary" class="section-subtitle"></p>
          </div>
          <div class="btn-group">
            <button type="button" id="btn-exp-prev" class="btn">← Anterior</button>
            <span id="exp-page-indicator" class="mono" style="align-self:center;padding:0 10px;font-size:0.85rem"></span>
            <button type="button" id="btn-exp-next" class="btn">Siguiente →</button>
          </div>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th class="num">T. media (°C)</th>
                <th class="num">T. máx. (°C)</th>
                <th class="num">T. mín. (°C)</th>
                <th class="num">Amplitud (°C)</th>
                <th class="num">Lluvia (mm)</th>
                <th class="num">Viento med. (km/h)</th>
                <th class="num">Racha máx. (km/h)</th>
                <th class="num">Humedad (%)</th>
                <th class="num">Presión (hPa)</th>
              </tr>
            </thead>
            <tbody id="explorer-table-body"></tbody>
          </table>
        </div>
      </section>
    `;

    const updateFromControls = (resetPage = true) => {
      STATE.explorer.variable = document.getElementById('exp-var').value;
      STATE.explorer.dateFrom = document.getElementById('exp-from').value || '2022-01-01';
      STATE.explorer.dateTo = document.getElementById('exp-to').value || '2026-10-25';
      STATE.explorer.episodeFilter = document.getElementById('exp-episode').value;
      STATE.explorer.aggregation = document.getElementById('exp-agg').value;
      if (resetPage) STATE.explorer.page = 1;
      refreshExplorerResults();
    };

    document.getElementById('exp-year').addEventListener('change', (e) => {
      const val = e.target.value;
      STATE.explorer.yearFilter = val;
      if (val === 'all') {
        document.getElementById('exp-from').value = '2022-01-01';
        document.getElementById('exp-to').value = '2026-10-25';
      } else if (val === '2026') {
        document.getElementById('exp-from').value = '2026-01-01';
        document.getElementById('exp-to').value = '2026-10-25';
      } else {
        document.getElementById('exp-from').value = `${val}-01-01`;
        document.getElementById('exp-to').value = `${val}-12-31`;
      }
      updateFromControls(true);
    });

    ['exp-var', 'exp-from', 'exp-to', 'exp-episode', 'exp-agg'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', () => updateFromControls(true));
    });

    document.getElementById('btn-exp-prev')?.addEventListener('click', () => {
      if (STATE.explorer.page > 1) {
        STATE.explorer.page -= 1;
        refreshExplorerResults(false);
      }
    });
    document.getElementById('btn-exp-next')?.addEventListener('click', () => {
      STATE.explorer.page += 1;
      refreshExplorerResults(false);
    });

    refreshExplorerResults(true);
  }

  function getFilteredExplorerRows() {
    const rows = [];
    const years = Object.keys(STATE.cache.almanacs).map(Number).sort((a, b) => a - b);
    const { dateFrom, dateTo, episodeFilter } = STATE.explorer;

    years.forEach((y) => {
      const ds = STATE.cache.almanacs[y].daily_series;
      ds.dates.forEach((d, i) => {
        if (d < dateFrom || d > dateTo) return;
        const rec = {
          date: d,
          year: y,
          month: d.slice(0, 7),
          temp_mean: ds.temp_mean[i],
          temp_max: ds.temp_max[i],
          temp_min: ds.temp_min[i],
          temp_amp: ds.temp_amp[i],
          rain_daily: ds.rain_daily[i],
          wind_speed: ds.wind_speed[i],
          wind_gust: ds.wind_gust[i],
          humidity_mean: ds.humidity_mean[i],
          pressure_rel: ds.pressure_rel[i],
          solar_max: ds.solar_max[i],
        };
        if (rec.temp_mean === null && rec.rain_daily === null) return;

        if (episodeFilter === 'frost' && !(rec.temp_min !== null && rec.temp_min <= 0)) return;
        if (episodeFilter === 'heat30' && !(rec.temp_max !== null && rec.temp_max >= 30)) return;
        if (episodeFilter === 'heat35' && !(rec.temp_max !== null && rec.temp_max >= 35)) return;
        if (episodeFilter === 'tropical' && !(rec.temp_min !== null && rec.temp_min >= 20)) return;
        if (episodeFilter === 'rain02' && !(rec.rain_daily !== null && rec.rain_daily >= 0.2)) return;
        if (episodeFilter === 'rain10' && !(rec.rain_daily !== null && rec.rain_daily >= 10)) return;
        if (episodeFilter === 'rain30' && !(rec.rain_daily !== null && rec.rain_daily >= 30)) return;
        if (episodeFilter === 'wind40' && !(rec.wind_gust !== null && rec.wind_gust >= 40)) return;
        if (episodeFilter === 'wind60' && !(rec.wind_gust !== null && rec.wind_gust >= 60)) return;

        rows.push(rec);
      });
    });

    return rows;
  }

  function refreshExplorerResults(redrawChart = true) {
    const rows = getFilteredExplorerRows();
    const vKey = STATE.explorer.variable;
    const vMeta = EXPLORER_VARIABLES[vKey];
    const validRows = rows.filter((r) => r[vKey] !== null && r[vKey] !== undefined);

    let maxRec = null;
    let minRec = null;
    let sumVal = 0;

    validRows.forEach((r) => {
      const val = r[vKey];
      sumVal += val;
      if (!maxRec || val > maxRec[vKey]) maxRec = r;
      if (!minRec || val < minRec[vKey]) minRec = r;
    });

    const meanVal = validRows.length > 0 ? sumVal / validRows.length : null;

    const kpiBox = document.getElementById('explorer-kpis');
    if (kpiBox) {
      kpiBox.innerHTML = `
        <div class="kpi-card accent-forest">
          <div class="kpi-label">Jornadas en la selección</div>
          <div class="kpi-value">${fmtNum(validRows.length, 0)} <span class="kpi-unit">días</span></div>
          <div class="kpi-meta">Periodo: ${fmtDateES(STATE.explorer.dateFrom, false)} a ${fmtDateES(STATE.explorer.dateTo, false)}</div>
        </div>
        <div class="kpi-card accent-rain">
          <div class="kpi-label">${vMeta.agg === 'sum' ? 'Total acumulado del periodo' : 'Promedio del periodo'}</div>
          <div class="kpi-value">${fmtNum(vMeta.agg === 'sum' ? sumVal : meanVal, vMeta.dec)} <span class="kpi-unit">${vMeta.unit}</span></div>
          <div class="kpi-meta">${vMeta.agg === 'sum' ? `Media por día seleccionado: ${fmtNum(meanVal, 1)} ${vMeta.unit}` : escapeHtml(vMeta.label)}</div>
        </div>
        <div class="kpi-card accent-heat">
          <div class="kpi-label">Máximo en la selección</div>
          <div class="kpi-value">${maxRec ? fmtNum(maxRec[vKey], vMeta.dec) : '—'} <span class="kpi-unit">${vMeta.unit}</span></div>
          <div class="kpi-meta">${maxRec ? `Registrado el ${fmtDateES(maxRec.date)}` : 'Sin registros'}</div>
        </div>
        <div class="kpi-card accent-cold">
          <div class="kpi-label">Mínimo en la selección</div>
          <div class="kpi-value">${minRec ? fmtNum(minRec[vKey], vMeta.dec) : '—'} <span class="kpi-unit">${vMeta.unit}</span></div>
          <div class="kpi-meta">${minRec ? `Registrado el ${fmtDateES(minRec.date)}` : 'Sin registros'}</div>
        </div>
      `;
    }

    if (redrawChart) {
      const pal = chartPalette();
      const titleEl = document.getElementById('explorer-chart-title');
      const subEl = document.getElementById('explorer-chart-sub');
      if (titleEl) titleEl.textContent = `${vMeta.label} (${vMeta.unit})`;
      if (subEl) subEl.textContent = `${validRows.length} días con observación entre ${fmtDateES(STATE.explorer.dateFrom, false)} y ${fmtDateES(STATE.explorer.dateTo, false)}`;

      let chartLabels = [];
      let chartValues = [];

      if (STATE.explorer.aggregation === 'monthly') {
        const byMonth = {};
        validRows.forEach((r) => {
          if (!byMonth[r.month]) byMonth[r.month] = [];
          byMonth[r.month].push(r[vKey]);
        });
        chartLabels = Object.keys(byMonth).sort();
        chartValues = chartLabels.map((m) => {
          const arr = byMonth[m];
          if (vMeta.agg === 'sum') return Number(arr.reduce((a, b) => a + b, 0).toFixed(1));
          if (vMeta.agg === 'max') return Number(Math.max(...arr).toFixed(1));
          if (vMeta.agg === 'min') return Number(Math.min(...arr).toFixed(1));
          return Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1));
        });
      } else {
        chartLabels = validRows.map((r) => r.date);
        chartValues = validRows.map((r) => r[vKey]);
      }

      createChart('explorer_main', 'chart-explorer-main', {
        type: vMeta.type,
        data: {
          labels: chartLabels,
          datasets: [
            {
              label: `${vMeta.label} (${vMeta.unit})`,
              data: chartValues,
              borderColor: vMeta.color,
              backgroundColor: vMeta.type === 'bar' ? pal.rainBar : pal.forestFill,
              borderWidth: vMeta.type === 'bar' ? 1 : 1.5,
              pointRadius: validRows.length > 120 && STATE.explorer.aggregation === 'daily' ? 0 : 2.5,
              fill: vMeta.type === 'line',
              tension: 0.15,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { labels: { color: pal.text } } },
          scales: {
            x: { ticks: { color: pal.text, maxTicksLimit: 14 }, grid: { color: pal.grid } },
            y: {
              title: { display: true, text: `${vMeta.label} (${vMeta.unit})`, color: pal.text },
              ticks: { color: pal.text },
              grid: { color: pal.grid },
            },
          },
        },
      });
    }

    // Tabla paginada (ordenada de más reciente a más antigua)
    const sortedDesc = [...rows].sort((a, b) => (a.date < b.date ? 1 : -1));
    const totalPages = Math.max(1, Math.ceil(sortedDesc.length / STATE.explorer.pageSize));
    if (STATE.explorer.page > totalPages) STATE.explorer.page = totalPages;
    const startIdx = (STATE.explorer.page - 1) * STATE.explorer.pageSize;
    const pageRows = sortedDesc.slice(startIdx, startIdx + STATE.explorer.pageSize);

    const pageInd = document.getElementById('exp-page-indicator');
    if (pageInd) pageInd.textContent = `Página ${STATE.explorer.page} de ${totalPages}`;
    const summaryEl = document.getElementById('explorer-table-summary');
    if (summaryEl) summaryEl.textContent = `Mostrando ${pageRows.length} de ${sortedDesc.length} días seleccionados`;

    const tbody = document.getElementById('explorer-table-body');
    if (tbody) {
      tbody.innerHTML = pageRows.map((r) => `
        <tr>
          <td class="mono"><a href="#almanaque/${r.year}">${r.date}</a></td>
          <td class="num"><strong>${fmtNum(r.temp_mean, 1)}</strong></td>
          <td class="num" style="color:var(--accent-heat)">${fmtNum(r.temp_max, 1)}</td>
          <td class="num" style="color:var(--accent-cold)">${fmtNum(r.temp_min, 1)}</td>
          <td class="num">${fmtNum(r.temp_amp, 1)}</td>
          <td class="num" style="color:var(--accent-rain)"><strong>${fmtNum(r.rain_daily, 1)}</strong></td>
          <td class="num">${fmtNum(r.wind_speed, 1)}</td>
          <td class="num">${fmtNum(r.wind_gust, 1)}</td>
          <td class="num">${fmtNum(r.humidity_mean, 1)}%</td>
          <td class="num">${fmtNum(r.pressure_rel, 1)}</td>
        </tr>
      `).join('');
    }

    // Botones de exportación de la selección activa
    const btnCsv = document.getElementById('btn-exp-csv');
    if (btnCsv) {
      btnCsv.onclick = () => {
        const hdr = ['fecha', 'temp_media_c', 'temp_max_c', 'temp_min_c', 'amplitud_c', 'lluvia_mm', 'viento_medio_kmh', 'racha_max_kmh', 'humedad_pct', 'presion_hpa'];
        const csvLines = [hdr.join(',')];
        rows.forEach((r) => {
          csvLines.push([
            r.date, r.temp_mean ?? '', r.temp_max ?? '', r.temp_min ?? '', r.temp_amp ?? '',
            r.rain_daily ?? '', r.wind_speed ?? '', r.wind_gust ?? '', r.humidity_mean ?? '', r.pressure_rel ?? '',
          ].join(','));
        });
        triggerBlobDownload(csvLines.join('\n'), `meteoriotuerto_seleccion_${STATE.explorer.dateFrom}_${STATE.explorer.dateTo}.csv`, 'text/csv;charset=utf-8;');
      };
    }

    const btnJson = document.getElementById('btn-exp-json');
    if (btnJson) {
      btnJson.onclick = () => {
        triggerBlobDownload(JSON.stringify(rows, null, 2), `meteoriotuerto_seleccion_${STATE.explorer.dateFrom}_${STATE.explorer.dateTo}.json`, 'application/json;charset=utf-8;');
      };
    }
  }

  /* ------------------------------------------------------------------------
   * VISTA 4: RÉCORDS METEOROLÓGICOS
   * ------------------------------------------------------------------------ */
  async function renderRecords() {
    const rec = await ensureRecordsLoaded();
    const container = document.getElementById('view-records');
    const abs = rec.absolute_records;

    const absCards = [
      { item: abs.temp_max, accent: 'accent-heat' },
      { item: abs.temp_min, accent: 'accent-cold' },
      { item: abs.max_daily_rain, accent: 'accent-rain' },
      { item: { label: 'Mayor intensidad de precipitación', value: abs.max_rain_rate.value, unit: 'mm/h', date: abs.max_rain_rate.date, time: abs.max_rain_rate.time, context: `Máximo acumulado en 1 hora: ${fmtNum(abs.max_hourly_rain.value, 1)} mm (${fmtDateES(abs.max_hourly_rain.date, false)})` }, accent: 'accent-rain' },
      { item: abs.max_wind_gust, accent: 'accent-wind' },
      { item: abs.max_thermal_amplitude, accent: 'accent-solar' },
      { item: abs.coldest_day_max, accent: 'accent-cold' },
      { item: abs.warmest_night_min, accent: 'accent-heat' },
      { item: abs.pressure_max, accent: 'accent-forest' },
      { item: abs.pressure_min, accent: 'accent-forest' },
    ];

    const absHtml = absCards.map(({ item, accent }) => `
      <div class="kpi-card ${accent}">
        <div class="kpi-label">${escapeHtml(item.label)}</div>
        <div class="kpi-value">${fmtNum(item.value, 1)} <span class="kpi-unit">${escapeHtml(item.unit)}</span></div>
        <div class="kpi-meta">
          <strong>${fmtDateES(item.date)}</strong>${item.time ? ` (${item.time} h)` : ''}<br>
          <span>${escapeHtml(item.context || '')}</span>
        </div>
      </div>
    `).join('');

    const monthlyRecRows = rec.monthly_records.map((m) => `
      <tr>
        <td><strong>${m.name}</strong></td>
        <td class="num" style="color:var(--accent-heat)"><strong>${fmtNum(m.temp_max_abs, 1)} °C</strong> <small>(${fmtDateES(m.temp_max_date, false)})</small></td>
        <td class="num" style="color:var(--accent-cold)"><strong>${fmtNum(m.temp_min_abs, 1)} °C</strong> <small>(${fmtDateES(m.temp_min_date, false)})</small></td>
        <td class="num" style="color:var(--accent-rain)"><strong>${fmtNum(m.max_daily_rain, 1)} mm</strong> <small>(${fmtDateES(m.max_daily_rain_date, false)})</small></td>
        <td class="num">${fmtNum(m.max_wind_gust, 1)} km/h <small>(${fmtDateES(m.max_wind_gust_date, false)})</small></td>
        <td class="num">${m.wettest_edition ? `${m.wettest_edition.year} (${fmtNum(m.wettest_edition.rain_mm, 1)} mm)` : '—'}</td>
        <td class="num">${m.driest_edition ? `${m.driest_edition.year} (${fmtNum(m.driest_edition.rain_mm, 1)} mm)` : '—'}</td>
        <td class="num">${m.warmest_edition ? `${m.warmest_edition.year} (${fmtNum(m.warmest_edition.temp_mean, 1)} °C)` : '—'}</td>
      </tr>
    `).join('');

    container.innerHTML = `
      <article class="editorial-hero">
        <div class="editorial-kicker">EFEMÉRIDES Y EXTREMOS INSTRUMENTALES</div>
        <h2 id="records-heading" class="editorial-title">Récords meteorológicos de MeteoRiotuerto</h2>
        <p class="editorial-lead">${escapeHtml(rec.methodological_disclaimer)}</p>
      </article>

      <div class="callout callout-info" style="margin-bottom:24px">
        <strong>Periodo de referencia considerado:</strong> ${escapeHtml(rec.period_covered)} (${fmtNum(rec.total_observed_days, 0)} días con observación validada).
      </div>

      <section class="section-block">
        <div class="section-header">
          <div>
            <h3 class="section-title">Cuadro de extremos absolutos de la estación</h3>
            <p class="section-subtitle">Registros máximos y mínimos verificados y depurados de anomalías de transmisión</p>
          </div>
        </div>
        <div class="kpi-grid">
          ${absHtml}
        </div>
      </section>

      <!-- Rankings Top 10 -->
      <section class="section-block">
        <div class="section-header">
          <div>
            <h3 class="section-title">Clasificaciones históricas (Top 10 de toda la serie)</h3>
            <p class="section-subtitle">Los diez días más extremos observados en Riotuerto según cada indicador</p>
          </div>
          <div style="min-width:260px">
            <select id="select-ranking-cat" class="form-select" aria-label="Seleccionar categoría del ranking histórico">
              <option value="top_hottest_days">🔥 Top 10 días más cálidos (T. máx. absoluta)</option>
              <option value="top_coldest_days">❄️ Top 10 madrugadas más frías (T. mín. absoluta)</option>
              <option value="top_wettest_days">☔ Top 10 días más lluviosos (Precipitación en 24h)</option>
              <option value="top_windiest_days">💨 Top 10 mayores rachas de viento (km/h)</option>
              <option value="top_amplitude_days">↕️ Top 10 mayores amplitudes térmicas diarias</option>
              <option value="top_coldest_max_days">🧊 Top 10 días invernales más fríos (T. máx. más baja)</option>
              <option value="top_warmest_min_days">🌙 Top 10 noches más cálidas (T. mín. más alta)</option>
            </select>
          </div>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Pos.</th>
                <th>Fecha</th>
                <th>Año</th>
                <th class="num">Valor extremo</th>
                <th class="num">T. máx. (°C)</th>
                <th class="num">T. mín. (°C)</th>
                <th class="num">T. media (°C)</th>
                <th class="num">Lluvia 24h (mm)</th>
                <th class="num">Racha máx. (km/h)</th>
              </tr>
            </thead>
            <tbody id="ranking-table-body"></tbody>
          </table>
        </div>
      </section>

      <!-- Récords por mes del año -->
      <section class="section-block">
        <div class="section-header">
          <div>
            <h3 class="section-title">Efemérides y extremos por mes del calendario (Enero – Diciembre)</h3>
            <p class="section-subtitle">Comparativa del comportamiento extremo de cada mes a lo largo de todos los años observados</p>
          </div>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Mes</th>
                <th class="num">Techo térmico</th>
                <th class="num">Suelo térmico</th>
                <th class="num">Máxima lluvia 24h</th>
                <th class="num">Racha máxima</th>
                <th class="num">Edición más lluviosa</th>
                <th class="num">Edición más seca</th>
                <th class="num">Edición más cálida</th>
              </tr>
            </thead>
            <tbody>
              ${monthlyRecRows}
            </tbody>
          </table>
        </div>
      </section>
    `;

    const sel = document.getElementById('select-ranking-cat');
    if (sel) {
      sel.value = STATE.recordsRankingKey;
      sel.addEventListener('change', (e) => {
        STATE.recordsRankingKey = e.target.value;
        renderRankingRows(rec);
      });
    }
    renderRankingRows(rec);
  }

  function renderRankingRows(rec) {
    const key = STATE.recordsRankingKey;
    const list = rec.rankings[key] || [];
    const unitMap = {
      top_hottest_days: '°C',
      top_coldest_days: '°C',
      top_wettest_days: 'mm',
      top_windiest_days: 'km/h',
      top_amplitude_days: '°C',
      top_coldest_max_days: '°C',
      top_warmest_min_days: '°C',
    };
    const unit = unitMap[key] || '';
    const tbody = document.getElementById('ranking-table-body');
    if (!tbody) return;
    tbody.innerHTML = list.map((r) => `
      <tr>
        <td class="mono"><strong>#${r.rank}</strong></td>
        <td><strong>${fmtDateES(r.date)}</strong></td>
        <td class="mono"><a href="#almanaque/${r.year}">${r.year}</a></td>
        <td class="num"><strong>${fmtNum(r.value, 1)} ${unit}</strong></td>
        <td class="num">${fmtNum(r.temp_max, 1)}</td>
        <td class="num">${fmtNum(r.temp_min, 1)}</td>
        <td class="num">${fmtNum(r.temp_mean, 1)}</td>
        <td class="num">${fmtNum(r.rain_daily, 1)}</td>
        <td class="num">${fmtNum(r.wind_gust, 1)}</td>
      </tr>
    `).join('');
  }

  /* ------------------------------------------------------------------------
   * VISTA 5: COMPARATIVAS ENTRE AÑOS
   * ------------------------------------------------------------------------ */
  async function renderComparativas() {
    const comp = await ensureComparisonsLoaded();
    const container = document.getElementById('view-comparativas');
    const ref = comp.reference_baseline;
    const rows = comp.yearly_table;

    const tableRowsHtml = rows.map((r) => `
      <tr>
        <td class="mono"><a href="#almanaque/${r.year}"><strong>${r.year}</strong></a> ${r.is_provisional ? '<span class="badge badge-provisional">Prov.</span>' : ''}</td>
        <td>${escapeHtml(r.character)}</td>
        <td class="num"><strong>${fmtNum(r.temp_mean, 1)} °C</strong></td>
        <td class="num">${r.is_provisional ? '—' : fmtSignNum(r.temp_anomaly_vs_series, 2, '°C')}</td>
        <td class="num" style="color:var(--accent-heat)">${fmtNum(r.temp_max_abs, 1)} °C</td>
        <td class="num" style="color:var(--accent-cold)">${fmtNum(r.temp_min_abs, 1)} °C</td>
        <td class="num" style="color:var(--accent-rain)"><strong>${fmtNum(r.rain_total_mm, 1)} mm</strong></td>
        <td class="num">${r.is_provisional ? '—' : fmtSignNum(r.rain_anomaly_pct, 1, '%')}</td>
        <td class="num">${r.rain_days_02}</td>
        <td class="num">${r.rain_days_30}</td>
        <td class="num">${r.frost_days}</td>
        <td class="num">${r.hot_days_30}</td>
        <td class="num">${r.tropical_nights}</td>
        <td class="num">${fmtNum(r.wind_gust_max_kmh, 1)} km/h</td>
      </tr>
    `).join('');

    container.innerHTML = `
      <article class="editorial-hero">
        <div class="editorial-kicker">PERSPECTIVA INTERANUAL Y VARIABILIDAD CLIMÁTICA</div>
        <h2 id="comparativas-heading" class="editorial-title">Comparativas entre años (2022–2026)</h2>
        <p class="editorial-lead">
          Análisis comparativo del régimen térmico, pluviométrico y de extremos entre los años documentados por
          MeteoRiotuerto. Permite contrastar las anomalías respecto al promedio de la serie completa disponible
          y examinar la variabilidad interanual de cada mes.
        </p>
      </article>

      <div class="callout callout-warning" style="margin-bottom:24px">
        <strong>Nota metodológica sobre normales climatológicas y longitud de serie:</strong>
        ${escapeHtml(ref.note)}
        Promedio de los años completos (2022–2025): <strong>${fmtNum(ref.mean_annual_temp_c, 2)} °C</strong> y
        <strong>${fmtNum(ref.mean_annual_rain_mm, 1)} mm/año</strong>.
      </div>

      <div class="section-header">
        <div>
          <h3 class="section-title">Gráficos comparativos interanuales</h3>
          <p class="section-subtitle">Anomalías respecto a la media 2022–2025 y distribución mensual superpuesta</p>
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:0.88rem;font-weight:600;cursor:pointer">
          <input type="checkbox" id="chk-include-2026" ${STATE.include2026InComparisons ? 'checked' : ''}>
          <span>Incluir el año en curso 2026 (provisional) en los gráficos</span>
        </label>
      </div>

      <div class="charts-grid-2">
        <div class="chart-panel">
          <div class="chart-panel-header">
            <div>
              <h4 class="chart-panel-title">Anomalía pluviométrica anual respecto a la media 2022–2025</h4>
              <p class="chart-panel-subtitle">Diferencia en milímetros (mm) respecto a la referencia de ${fmtNum(ref.mean_annual_rain_mm, 1)} mm</p>
            </div>
          </div>
          <div class="chart-canvas-wrap">
            <canvas id="chart-comp-rain-anom"></canvas>
          </div>
        </div>

        <div class="chart-panel">
          <div class="chart-panel-header">
            <div>
              <h4 class="chart-panel-title">Comparativa de días de umbrales climáticos por año</h4>
              <p class="chart-panel-subtitle">Heladas (≤0 °C), calor (≥30 °C), lluvia intensa (≥30 mm) y viento fuerte (≥40 km/h)</p>
            </div>
          </div>
          <div class="chart-canvas-wrap">
            <canvas id="chart-comp-thresholds"></canvas>
          </div>
        </div>
      </div>

      <div class="charts-grid-2">
        <div class="chart-panel">
          <div class="chart-panel-header">
            <div>
              <h4 class="chart-panel-title">Precipitación mensual comparada (Enero – Diciembre)</h4>
              <p class="chart-panel-subtitle">Evolución mensual por año frente al promedio mensual 2022–2025</p>
            </div>
          </div>
          <div class="chart-canvas-wrap">
            <canvas id="chart-comp-monthly-rain"></canvas>
          </div>
        </div>

        <div class="chart-panel">
          <div class="chart-panel-header">
            <div>
              <h4 class="chart-panel-title">Temperatura media mensual comparada (Enero – Diciembre)</h4>
              <p class="chart-panel-subtitle">Curvas térmicas anuales superpuestas (°C)</p>
            </div>
          </div>
          <div class="chart-canvas-wrap">
            <canvas id="chart-comp-monthly-temp"></canvas>
          </div>
        </div>
      </div>

      <section class="section-block">
        <div class="section-header">
          <div>
            <h3 class="section-title">Cuadro sinóptico multianual (2022–2026)</h3>
            <p class="section-subtitle">Síntesis de todos los indicadores anuales y anomalías respecto al periodo cerrado 2022–2025</p>
          </div>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Año</th>
                <th>Carácter sinóptico</th>
                <th class="num">T. media</th>
                <th class="num">Anom. T.</th>
                <th class="num">T. máx. abs.</th>
                <th class="num">T. mín. abs.</th>
                <th class="num">Lluvia anual</th>
                <th class="num">Anom. lluvia</th>
                <th class="num">Días ≥0,2 mm</th>
                <th class="num">Días ≥30 mm</th>
                <th class="num">Heladas</th>
                <th class="num">Días ≥30 °C</th>
                <th class="num">Noches trop.</th>
                <th class="num">Racha máx.</th>
              </tr>
            </thead>
            <tbody>
              ${tableRowsHtml}
            </tbody>
            <tfoot>
              <tr>
                <td>Media 2022–2025</td>
                <td>Referencia interna (4 años cerrados)</td>
                <td class="num">${fmtNum(ref.mean_annual_temp_c, 2)} °C</td>
                <td class="num">0,00 °C</td>
                <td class="num">42,1 °C (máx.)</td>
                <td class="num">-3,1 °C (mín.)</td>
                <td class="num">${fmtNum(ref.mean_annual_rain_mm, 1)} mm</td>
                <td class="num">0,0 %</td>
                <td class="num">${fmtNum(ref.mean_annual_rain_days, 1)}</td>
                <td class="num">14,0</td>
                <td class="num">11,8</td>
                <td class="num">15,3</td>
                <td class="num">0,3</td>
                <td class="num">97,2 km/h (máx.)</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    `;

    document.getElementById('chk-include-2026')?.addEventListener('change', (e) => {
      STATE.include2026InComparisons = e.target.checked;
      renderComparisonCharts(comp);
    });

    renderComparisonCharts(comp);
  }

  function renderComparisonCharts(comp) {
    const pal = chartPalette();
    const ref = comp.reference_baseline;
    const rows = comp.yearly_table.filter((r) => STATE.include2026InComparisons || !r.is_provisional);
    const completeRows = comp.yearly_table.filter((r) => !r.is_provisional);

    // 1. Anomalías de lluvia (sobre años cerrados)
    createChart('comp_rain_anom', 'chart-comp-rain-anom', {
      type: 'bar',
      data: {
        labels: completeRows.map((r) => String(r.year)),
        datasets: [
          {
            label: 'Anomalía pluviométrica (mm vs media 2022–2025)',
            data: completeRows.map((r) => r.rain_anomaly_mm),
            backgroundColor: completeRows.map((r) => (r.rain_anomaly_mm >= 0 ? pal.rainBar : 'rgba(234, 88, 12, 0.72)')),
            borderRadius: 5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: pal.text } } },
        scales: {
          x: { ticks: { color: pal.text }, grid: { color: pal.grid } },
          y: {
            title: { display: true, text: 'Diferencia respecto a 1.875,0 mm', color: pal.text },
            ticks: { color: pal.text },
            grid: { color: pal.grid },
          },
        },
      },
    });

    // 2. Umbrales climáticos por año
    createChart('comp_thresholds', 'chart-comp-thresholds', {
      type: 'bar',
      data: {
        labels: rows.map((r) => (r.is_provisional ? `${r.year} (prov.)` : String(r.year))),
        datasets: [
          { label: 'Heladas (≤0 °C)', data: rows.map((r) => r.frost_days), backgroundColor: pal.cold },
          { label: 'Calor (≥30 °C)', data: rows.map((r) => r.hot_days_30), backgroundColor: pal.heat },
          { label: 'Lluvia muy fuerte (≥30 mm)', data: rows.map((r) => r.rain_days_30), backgroundColor: pal.rain },
          { label: 'Viento fuerte (≥40 km/h)', data: rows.map((r) => r.wind_days_40), backgroundColor: pal.wind },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: pal.text } } },
        scales: {
          x: { ticks: { color: pal.text }, grid: { color: pal.grid } },
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Número de días', color: pal.text },
            ticks: { color: pal.text },
            grid: { color: pal.grid },
          },
        },
      },
    });

    // Colores diferenciados por año para series mensuales
    const yearColors = {
      '2022': '#64748b',
      '2023': '#0284c7',
      '2024': '#dc2626',
      '2025': '#16a34a',
      '2026': '#d97706',
    };

    const yearsToPlot = rows.map((r) => String(r.year));
    const mat = comp.monthly_matrices;

    // 3. Lluvia mensual comparada
    const rainDatasets = yearsToPlot.map((y) => ({
      label: y === '2026' ? '2026 (prov.)' : y,
      data: mat.rain_total[y],
      backgroundColor: yearColors[y],
      borderRadius: 3,
    }));
    rainDatasets.push({
      label: 'Media 2022–2025',
      data: ref.monthly_mean_rain_mm,
      type: 'line',
      borderColor: pal.text,
      borderDash: [5, 5],
      borderWidth: 2,
      pointRadius: 3,
    });

    createChart('comp_monthly_rain', 'chart-comp-monthly-rain', {
      type: 'bar',
      data: { labels: mat.months, datasets: rainDatasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: pal.text } } },
        scales: {
          x: { ticks: { color: pal.text }, grid: { color: pal.grid } },
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Precipitación mensual (mm)', color: pal.text },
            ticks: { color: pal.text },
            grid: { color: pal.grid },
          },
        },
      },
    });

    // 4. Temperatura media mensual comparada
    const tempDatasets = yearsToPlot.map((y) => ({
      label: y === '2026' ? '2026 (prov.)' : y,
      data: mat.temp_mean[y],
      borderColor: yearColors[y],
      backgroundColor: yearColors[y],
      borderWidth: 2,
      pointRadius: 3,
      tension: 0.25,
    }));
    tempDatasets.push({
      label: 'Media 2022–2025',
      data: ref.monthly_mean_temp_c,
      borderColor: pal.text,
      borderDash: [5, 5],
      borderWidth: 2.5,
      pointRadius: 3,
      tension: 0.25,
    });

    createChart('comp_monthly_temp', 'chart-comp-monthly-temp', {
      type: 'line',
      data: { labels: mat.months, datasets: tempDatasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: pal.text } } },
        scales: {
          x: { ticks: { color: pal.text }, grid: { color: pal.grid } },
          y: {
            title: { display: true, text: 'Temperatura media (°C)', color: pal.text },
            ticks: { color: pal.text },
            grid: { color: pal.grid },
          },
        },
      },
    });
  }

  /* ------------------------------------------------------------------------
   * VISTA 6: METODOLOGÍA Y CALIDAD DE LOS DATOS
   * ------------------------------------------------------------------------ */
  async function renderMetodologia() {
    await ensureAllAlmanacsLoaded();
    const idx = await ensureIndexLoaded();
    const container = document.getElementById('view-metodologia');
    const st = idx.station;

    const auditRowsHtml = Object.keys(STATE.cache.almanacs).sort().map((y) => {
      const alm = STATE.cache.almanacs[y];
      const cov = alm.coverage;
      const m30 = cov.quality_audit.intraday_meta;
      const notes = [];
      if (!cov.has_30min_series) {
        notes.push('Solo serie diaria consolidada en repositorio público.');
      } else {
        if (m30.embedded_daily_removed > 0) notes.push(`Depuradas ${m30.embedded_daily_removed} filas diarias incrustadas.`);
        if (m30.duplicates_removed > 0) notes.push(`Eliminados ${fmtNum(m30.duplicates_removed, 0)} timestamps duplicados.`);
        if (m30.out_of_year_removed > 0) notes.push(`Excluidas ${m30.out_of_year_removed} filas fuera del año natural.`);
        if (m30.glitches_filtered && m30.glitches_filtered.length > 0) {
          notes.push(`Filtrado pico RF espurio (${m30.glitches_filtered.length}).`);
        }
      }
      if (cov.missing_days > 0) {
        notes.push(`${cov.missing_days} días sin observación.`);
      }
      if (alm.is_provisional) {
        notes.push(`Año en curso hasta ${alm.last_observed_date}.`);
      }

      return `
        <tr>
          <td class="mono"><strong>${alm.year}</strong></td>
          <td class="num">${cov.valid_days} / ${cov.observed_span_days}</td>
          <td class="num"><strong>${fmtNum(cov.coverage_pct, 1)} %</strong></td>
          <td class="num">${cov.has_30min_series ? `${fmtNum(cov.clean_30min_records, 0)} reg.` : 'No disp.'}</td>
          <td>${escapeHtml(notes.join(' ') || 'Serie íntegra sin incidencias.')}</td>
          <td class="num"><a href="./data/almanac_${alm.year}.json" download="meteoriotuerto_almanaque_${alm.year}.json" class="btn" style="padding:4px 10px;font-size:0.78rem">JSON ${alm.year}</a></td>
        </tr>
      `;
    }).join('');

    container.innerHTML = `
      <article class="editorial-hero">
        <div class="editorial-kicker">TRANSPARENCIA CIENTÍFICA, INSTRUMENTACIÓN Y CONTROL DE CALIDAD</div>
        <h2 id="metodologia-heading" class="editorial-title">Metodología, criterios estadísticos y fuentes de datos</h2>
        <p class="editorial-lead">
          Para que <strong>MeteoRiotuerto</strong> funcione como un archivo climático verificable y reutilizable,
          esta sección documenta las características geográficas del emplazamiento, el instrumental de medida,
          las definiciones matemáticas de cada indicador y los procedimientos de control de calidad aplicados.
        </p>
      </article>

      <div class="stats-two-col">
        <div class="chronicle-card">
          <h3>📍 Emplazamiento geográfico y microclima</h3>
          <p style="margin-bottom:10px">
            La estación está situada en la localidad de <strong>${escapeHtml(st.location.locality)}</strong>,
            perteneciente al municipio de <strong>${escapeHtml(st.location.municipality)} (${escapeHtml(st.location.region)})</strong>,
            en las coordenadas <a href="${idx.station.links.openstreetmap || 'https://www.openstreetmap.org/?mlat=43.341&mlon=-3.670#map=15/43.341/-3.670'}" target="_blank" rel="noopener noreferrer" title="Ver localización en OpenStreetMap"><code>43.341° N, 3.670° W</code></a> (WGS84: <code>43.341, -3.670</code>) y a una altitud de
            <strong>115 metros sobre el nivel del mar</strong>.
          </p>
          <p>
            Ubicada en el <strong>valle del río Covadal</strong> (afluente de la cuenca del Miera), a 14 km de la costa
            cantábrica y a 5 km del puerto de Alisas, presenta dos rasgos topográficos determinantes:
            <strong>1) Efecto de retención orográfica</strong> ante advecciones del noroeste, que dispara los acumulados
            anuales por encima de los 1.600–2.100 mm; y <strong>2) Efecto Foehn en situaciones de viento sur</strong>,
            que provoca subidas térmicas abruptas y caídas bruscas de la humedad relativa al descender el aire recalentado
            desde la divisoria cantábrica.
          </p>

          <div class="station-location-map-wrap" style="margin-top:14px">
            <iframe
              class="station-osm-map"
              style="height:260px"
              src="https://www.openstreetmap.org/export/embed.html?bbox=-3.770%2C43.295%2C-3.560%2C43.385&amp;layer=mapnik&amp;marker=43.341%2C-3.670"
              title="Mapa topográfico de localización de Barrio de Arriba (Riotuerto, Cantabria)"
              loading="lazy">
            </iframe>
            <div class="map-link-bar">
              <a href="https://www.openstreetmap.org/?mlat=43.341&mlon=-3.670#map=15/43.341/-3.670" target="_blank" rel="noopener noreferrer">
                Ver en OpenStreetMap con curvas de nivel ↗
              </a>
            </div>
          </div>
        </div>

        <div class="chronicle-card">
          <h3>⚙️ Instrumentación y adquisición verificada</h3>
          <p style="margin-bottom:10px">
            Las observaciones se realizan mediante una estación meteorológica automática <strong>${escapeHtml(st.hardware.station_model)}</strong>
            vinculada a una puerta de enlace <strong>${escapeHtml(st.hardware.gateway_model)}</strong>, instalada sobre un
            <strong>${escapeHtml(st.hardware.mounting.toLowerCase())}</strong>.
          </p>
          <p>
            La estación inició sus registros el <strong>29 de noviembre de 2020</strong> con una resolución de archivo de
            <strong>30 minutos</strong> referenciada a la zona horaria oficial <code>Europe/Madrid</code>. Los datos se
            consolidan periódicamente mediante el sistema automatizado <code>ecowitt_downloader</code> y se preservan
            en el repositorio público de datos abiertos <a href="${st.links.data_repo}" target="_blank" rel="noopener">egofer/meteoriotuerto</a>.
          </p>
        </div>
      </div>

      <!-- Tabla de auditoría de cobertura y calidad por año -->
      <section class="section-block">
        <div class="section-header">
          <div>
            <h3 class="section-title">Auditoría de cobertura temporal y depuración por año</h3>
            <p class="section-subtitle">Estado real comprobado de los archivos CSV originales y resultados del pipeline de validación</p>
          </div>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Año</th>
                <th class="num">Días válidos / posibles</th>
                <th class="num">Cobertura diaria</th>
                <th class="num">Registros 30 min limpios</th>
                <th>Incidencias documentadas y acciones de control de calidad</th>
                <th class="num">Datos procesados</th>
              </tr>
            </thead>
            <tbody>
              ${auditRowsHtml}
            </tbody>
          </table>
        </div>
      </section>

      <!-- Definiciones estadísticas y criterios metodológicos -->
      <section class="section-block">
        <div class="section-header">
          <div>
            <h3 class="section-title">Criterios científicos y definiciones estadísticas</h3>
            <p class="section-subtitle">Fórmulas, umbrales y reglas aplicadas en el procesamiento en Python (<code>scripts/build_data.py</code>)</p>
          </div>
        </div>

        <div class="chronicle-grid">
          <div class="chronicle-card">
            <h3>1. Termometría: medias y extremos</h3>
            <p>
              La <strong>temperatura media diaria</strong> se calcula como la media aritmética de las 48 lecturas
              semihorarias del día natural (00:00 a 23:59 hora local), método más preciso que la semisuma
              <code>(Tmáx + Tmín)/2</code> en valles con marcadas asimetrías por viento sur o inversión nocturna.
              La <strong>temperatura máxima y mínima diaria</strong> corresponden al extremo absoluto registrado en los
              intervalos del día. Las medias mensuales y anuales son el promedio de los días válidos observados.
            </p>
          </div>

          <div class="chronicle-card">
            <h3>2. Pluviometría e intensidades</h3>
            <p>
              Se considera <strong>día de precipitación apreciable</strong> aquel con un acumulado diario
              <code>≥ 0,2 mm</code> (resolución del pluvímetro de cazoletas). Se distinguen umbrales estandarizados de
              <code>≥ 1,0 mm</code>, <code>≥ 10,0 mm</code> (lluvia abundante) y <code>≥ 30,0 mm</code> (lluvia muy fuerte).
              Se diferencia estrictamente entre ausencia de lluvia (<code>0,0 mm</code>) y ausencia de observación
              (<code>null</code>), sin interpolar ni rellenar artificialmente los días sin datos.
            </p>
          </div>

          <div class="chronicle-card">
            <h3>3. Anemometría, rosa de vientos y Beaufort</h3>
            <p>
              La <strong>velocidad media diaria</strong> es el promedio de las lecturas del día y se clasifica mediante
              la escala internacional de Beaufort. La <strong>racha máxima</strong> recoge el pico instantáneo más alto
              del intervalo. La <strong>rosa de los vientos</strong> se divide en 16 sectores de 22,5° calculados sobre
              la serie semihoraria cuando está disponible (2023–2026) y sobre la moda diaria en 2022.
            </p>
          </div>

          <div class="chronicle-card">
            <h3>4. Radiación solar e insolación estimada</h3>
            <p>
              El piranómetro mide la <strong>irradiancia solar global horizontal (W/m²)</strong>. Siguiendo el criterio
              de la Organización Meteorológica Mundial (OMM), se estima la <strong>insolación directa (horas de sol)</strong>
              sumando los intervalos de 30 minutos cuya radiación supera el umbral de <code>120 W/m²</code>. Los valores
              brutos que exceden la constante solar extraterrestre (<code>1.361 W/m²</code>) o índices UV nocturnos se
              documentan y se filtran en los récords validados.
            </p>
          </div>

          <div class="chronicle-card">
            <h3>5. Control de calidad y no interpolación</h3>
            <p>
              Los archivos originales del repositorio de datos nunca se alteran destructivamente. El procesador en Python
              normaliza diferencias de cabeceras (25, 28 y 31 columnas) y separadores decimales, elimina bloques duplicados
              en las exportaciones brutas de 30 minutos (2023 y 2024) y anula paquetes de radiofrecuencia corruptos
              verificados (como el registro nocturno del <code>31/05/2024 04:30</code> con <code>-14,6 °C</code> y
              <code>1.655,2 W/m²</code>, que ya había sido corregido en la tabla diaria oficial).
            </p>
          </div>

          <div class="chronicle-card">
            <h3>6. Interpretación de anomalías y series cortas</h3>
            <p>
              Las comparativas interanuales utilizan como línea base interna el promedio de los años completos disponibles
              (<strong>2022–2025</strong>). Se advierte expresamente en toda la publicación que una serie de 4 a 5 años
              permite caracterizar la variabilidad interanual local, pero no sustituye a una normal climatológica oficial
              de 30 años ni permite atribuir por sí sola tendencias seculares de cambio climático.
            </p>
          </div>
        </div>
      </section>

      <!-- Descarga directa de todos los productos JSON -->
      <section class="section-block">
        <div class="section-header">
          <div>
            <h3 class="section-title">Descarga de productos de datos y repositorio fuente</h3>
            <p class="section-subtitle">Archivos JSON estáticos generados reproducibles y auditados</p>
          </div>
        </div>
        <div class="btn-group">
          <a href="./data/index.json" download="meteoriotuerto_index.json" class="btn btn-primary">⬇ Índice general (index.json)</a>
          <a href="./data/records.json" download="meteoriotuerto_records.json" class="btn">⬇ Récords e históricos (records.json)</a>
          <a href="./data/comparisons.json" download="meteoriotuerto_comparisons.json" class="btn">⬇ Comparativas (comparisons.json)</a>
          <a href="https://github.com/egofer/meteoriotuerto/" target="_blank" rel="noopener noreferrer" class="btn">Repositorio CSV original en GitHub ↗</a>
        </div>
      </section>
    `;
  }

  /* ------------------------------------------------------------------------
   * Enrutador SPA basado en Hash (#portada, #almanaque/2025, etc.)
   * ------------------------------------------------------------------------ */
  function parseHashRoute() {
    const raw = (window.location.hash || '#portada').replace(/^#/, '');
    const parts = raw.split('/');
    const route = parts[0] || 'portada';
    const param = parts[1] || null;
    const validRoutes = ['portada', 'almanaque', 'explorador', 'records', 'comparativas', 'metodologia'];
    return {
      route: validRoutes.includes(route) ? route : 'portada',
      param,
    };
  }

  async function handleRouteChange() {
    const { route, param } = parseHashRoute();
    STATE.route = route;

    // Actualizar pestaña activa en el menú principal
    document.querySelectorAll('#main-nav .nav-link').forEach((link) => {
      const r = link.getAttribute('data-route');
      link.classList.toggle('active', r === route);
      if (r === route) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    });

    // Ocultar todas las secciones y destruir gráficos previos
    destroyChartsInPrefix('');
    document.querySelectorAll('.view-section').forEach((sec) => {
      sec.hidden = true;
    });

    const loadingEl = document.getElementById('app-loading');
    const errorEl = document.getElementById('app-error');
    if (errorEl) errorEl.hidden = true;
    if (loadingEl) loadingEl.hidden = false;

    try {
      const idx = await ensureIndexLoaded();
      const totalDaysEl = document.getElementById('header-total-days');
      if (totalDaysEl) {
        totalDaysEl.textContent = `${fmtNum(idx.series_overview.total_observed_days, 0)} días observados · Act. ${fmtDateES(idx.series_overview.last_consolidated_date, false)}`;
      }
      const stampEl = document.getElementById('footer-build-stamp');
      if (stampEl) {
        stampEl.textContent = `Compilación de datos: ${idx.generated_at}`;
      }

      if (route === 'portada') {
        await renderPortada();
      } else if (route === 'almanaque') {
        const targetYear = param && [2022, 2023, 2024, 2025, 2026].includes(Number(param))
          ? Number(param)
          : STATE.selectedYear || 2025;
        await renderAlmanaque(targetYear);
      } else if (route === 'explorador') {
        await renderExplorador();
      } else if (route === 'records') {
        await renderRecords();
      } else if (route === 'comparativas') {
        await renderComparativas();
      } else if (route === 'metodologia') {
        await renderMetodologia();
      }

      if (loadingEl) loadingEl.hidden = true;
      const activeSection = document.getElementById(`view-${route}`);
      if (activeSection) {
        activeSection.hidden = false;
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      console.error('Error al renderizar vista:', err);
      if (loadingEl) loadingEl.hidden = true;
      if (errorEl) {
        errorEl.hidden = false;
        errorEl.innerHTML = `<strong>Error al cargar los datos del almanaque:</strong> ${escapeHtml(err.message)}. Asegúrese de servir la aplicación desde un servidor web HTTP local o GitHub Pages.`;
      }
    }
  }

  /* ------------------------------------------------------------------------
   * Conmutador de tema claro / oscuro
   * ------------------------------------------------------------------------ */
  function updateThemeButtonUI() {
    const icon = document.getElementById('theme-icon');
    const label = document.getElementById('theme-label');
    if (STATE.theme === 'dark') {
      if (icon) icon.textContent = '☀';
      if (label) label.textContent = 'Modo claro';
    } else {
      if (icon) icon.textContent = '☾';
      if (label) label.textContent = 'Modo oscuro';
    }
  }

  function toggleTheme() {
    STATE.theme = STATE.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', STATE.theme);
    try {
      localStorage.setItem('mr-theme', STATE.theme);
    } catch (e) {}
    updateThemeButtonUI();
    // Re-renderizar la ruta actual para actualizar los colores de los lienzos de Chart.js
    handleRouteChange();
  }

  /* ------------------------------------------------------------------------
   * Inicialización al cargar el DOM
   * ------------------------------------------------------------------------ */
  document.addEventListener('DOMContentLoaded', () => {
    updateThemeButtonUI();
    document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);
    window.addEventListener('hashchange', handleRouteChange);
    handleRouteChange();
  });
})();
