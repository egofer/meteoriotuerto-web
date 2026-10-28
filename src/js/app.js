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
    onThisDay: null, // { month: 1..12, day: 1..31 }
    calendarMode: 'rain', // 'rain' | 'temp'
    windRoseMode: 'polar', // 'polar' | 'bar'
    windRoseFilter: 'annual', // 'annual' | 'winter' | 'spring' | 'summer' | 'autumn' | '1'..'12'
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
    glossary: {
      categoryFilter: 'all',
      searchQuery: '',
    },
    headToHead: {
      mode: 'yearly', // 'yearly' | 'monthly'
      yearA: 2023,
      monthA: 8,
      yearB: 2025,
      monthB: 8,
    },
    seasonal: {
      seasonFilter: 'all', // 'all' | 'winter' | 'spring' | 'summer' | 'autumn'
      metric: 'temp', // 'temp' | 'rain' | 'extremes' | 'foehn'
    },
    episodes: {
      filterType: 'all', // 'all' | 'heatwave' | 'coldwave' | 'wet_spell' | 'dry_spell' | 'foehn_spell'
      yearFilter: 'all', // 'all' | '2022' | '2023' | '2024' | '2025' | '2026'
    },
    cotidianoTab: 'labores',
    cotidianoYear: 2025,
    festivalSelectedId: 'san_juan',
    liveWeather: null,
    liveWeatherLastFetch: 0,
    cache: {
      index: null,
      records: null,
      comparisons: null,
      glossary: null,
      almanacs: {}, // { 2022: {...}, ... }
    },
    charts: {}, // Instancias activas de Chart.js
  };

  const MONTH_NAMES_ES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ];
  const MONTH_FULL_ES = MONTH_NAMES_ES;
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

  function degToSector(deg) {
    if (deg === null || deg === undefined || Number.isNaN(Number(deg))) return '—';
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
    const idx = Math.round(((Number(deg) % 360) + 360) % 360 / 45) % 8;
    return dirs[idx];
  }

  /* ------------------------------------------------------------------------
   * Catálogo y cálculo del calendario fenológico y agroclimático de Riotuerto
   * ------------------------------------------------------------------------ */
  const PHENOLOGY_EVENTS = [
    {
      key: 'robot_start',
      icon: '🤖',
      name: 'Puesta en marcha del robot cortacésped',
      subtitle: 'Reactivación del crecimiento vegetal',
      criteria: '5 días consecutivos con T. med. ≥ 10,0 °C (cero vegetativo) desde el 1 de marzo',
      typicalDate: '7 de marzo',
      refDayOfYear: 66,
    },
    {
      key: 'boiler_acs_mode',
      icon: '♨️',
      name: 'Paso de caldera a modo solo ACS (fin calefacción regular)',
      subtitle: 'Cese de la demanda térmica continuada en viviendas',
      criteria: '5 días consecutivos con HDD < 2,0 (T. med. ≥ 13,5 °C) entre abril y mayo',
      typicalDate: '28 de abril',
      refDayOfYear: 118,
    },
    {
      key: 'fungal_alert',
      icon: '🍅',
      name: 'Alerta de primer sulfatado preventivo en huerta',
      subtitle: 'Riesgo fúngico de mildiu y oídio tras calor y lluvia',
      criteria: 'Primer episodio en mayo/junio con T. med. ≥ 13,0 °C, lluvia ≥ 5 mm y HR ≥ 80 %',
      typicalDate: '9 de mayo',
      refDayOfYear: 129,
    },
    {
      key: 'first_hay_cut',
      icon: '🚜',
      name: 'Primer corte de hierba / forraje para ensilado',
      subtitle: 'Ventana de siega y oreo de praderas',
      criteria: 'Acumulación de ≥ 200 GDD (base 10 °C) desde marzo + ventana seca ≥ 3 días (< 1 mm)',
      typicalDate: '18 de mayo',
      refDayOfYear: 138,
    },
    {
      key: 'mushroom_flush',
      icon: '🍄',
      name: 'Primera eclosión de setas de otoño en el monte',
      subtitle: 'Fructificación de boletus, cantarelas y senderuelas',
      criteria: 'Lluvia en 7 días ≥ 35 mm seguida de 5 días templados (11–18 °C) a partir de septiembre',
      typicalDate: '29 de septiembre',
      refDayOfYear: 272,
    },
    {
      key: 'heating_season_start',
      icon: '🔥',
      name: 'Arranque regular de caldera en otoño',
      subtitle: 'Inicio de la temporada de calefacción doméstica',
      criteria: 'Primer episodio otoñal con 4 días consecutivos con HDD ≥ 4,0 (T. med. < 11,5 °C)',
      typicalDate: '18 de noviembre',
      refDayOfYear: 322,
    },
    {
      key: 'robot_wintering',
      icon: '❄️',
      name: 'Retirada e invernada a resguardo de robots cortacésped',
      subtitle: 'Letargo invernal y protección contra heladas y barro',
      criteria: '4 días seguidos con T. med. < 10,0 °C o primera helada nocturna (T. mín. ≤ 0 °C)',
      typicalDate: '30 de noviembre',
      refDayOfYear: 334,
    },
  ];

  function computePhenologicalCalendar(ds) {
    if (!ds || !ds.dates) return {};
    const dates = ds.dates;
    const tmed = ds.temp_mean;
    const tmin = ds.temp_min;
    const rain = ds.rain_daily;
    const hum = ds.humidity_mean;
    const n = dates.length;

    let robot_start = null;
    let streak = 0;
    for (let i = 0; i < n; i++) {
      const m = parseInt(dates[i].slice(5, 7), 10);
      if (m >= 3 && m <= 6 && tmed[i] !== null && tmed[i] !== undefined) {
        if (tmed[i] >= 10.0) {
          streak++;
          if (streak === 5 && !robot_start) robot_start = dates[i - 4];
        } else {
          streak = 0;
        }
      }
    }

    let robot_end = null;
    streak = 0;
    for (let i = 0; i < n; i++) {
      const m = parseInt(dates[i].slice(5, 7), 10);
      if (m >= 10 && tmed[i] !== null && tmed[i] !== undefined) {
        if (tmed[i] < 10.0 || (tmin[i] !== null && tmin[i] <= 0.0)) {
          streak++;
          if (streak === 4 && !robot_end) robot_end = dates[i - 3];
        } else {
          streak = 0;
        }
      }
    }

    let caldera_acs = null;
    streak = 0;
    for (let i = 0; i < n; i++) {
      const m = parseInt(dates[i].slice(5, 7), 10);
      const day = parseInt(dates[i].slice(8, 10), 10);
      if ((m > 4 || (m === 4 && day >= 15)) && m <= 6 && tmed[i] !== null && tmed[i] !== undefined) {
        const hdd = Math.max(0, 15.5 - tmed[i]);
        if (hdd < 2.0) {
          streak++;
          if (streak === 5 && !caldera_acs) caldera_acs = dates[i - 4];
        } else {
          streak = 0;
        }
      }
    }

    let caldera_start = null;
    streak = 0;
    for (let i = 0; i < n; i++) {
      const m = parseInt(dates[i].slice(5, 7), 10);
      const day = parseInt(dates[i].slice(8, 10), 10);
      if ((m > 9 || (m === 9 && day >= 15)) && tmed[i] !== null && tmed[i] !== undefined) {
        const hdd = Math.max(0, 15.5 - tmed[i]);
        if (hdd >= 4.0) {
          streak++;
          if (streak === 4 && !caldera_start) caldera_start = dates[i - 3];
        } else {
          streak = 0;
        }
      }
    }

    let gdd_cum = 0;
    let siega_date = null;
    for (let i = 0; i < n; i++) {
      const m = parseInt(dates[i].slice(5, 7), 10);
      if (m >= 3 && tmed[i] !== null && tmed[i] !== undefined) {
        gdd_cum += Math.max(0, tmed[i] - 10.0);
        if (gdd_cum >= 200.0 && !siega_date) {
          if (i + 2 < n && (rain[i] || 0) < 1.0 && (rain[i + 1] || 0) < 1.0 && (rain[i + 2] || 0) < 1.0) {
            siega_date = dates[i];
          }
        }
      }
    }

    let sulfato_date = null;
    for (let i = 0; i < n; i++) {
      const m = parseInt(dates[i].slice(5, 7), 10);
      if ((m === 5 || m === 6) && tmed[i] !== null && tmed[i] !== undefined) {
        if (tmed[i] >= 13.0 && (rain[i] || 0) >= 5.0 && (hum[i] || 0) >= 80) {
          sulfato_date = dates[i];
          break;
        }
      }
    }

    let setas_date = null;
    for (let i = 6; i < n; i++) {
      const m = parseInt(dates[i].slice(5, 7), 10);
      if ((m === 9 || m === 10 || m === 11) && !setas_date) {
        let r7 = 0;
        for (let k = i - 6; k <= i; k++) r7 += (rain[k] || 0);
        if (r7 >= 35.0 && i + 5 < n) {
          let ok = true;
          for (let k = i + 1; k <= i + 5; k++) {
            if (tmed[k] === null || tmed[k] < 11.0 || tmed[k] > 18.0) ok = false;
          }
          if (ok) setas_date = dates[i + 5];
        }
      }
    }

    return {
      robot_start,
      first_hay_cut: siega_date,
      fungal_alert: sulfato_date,
      boiler_acs_mode: caldera_acs,
      mushroom_flush: setas_date,
      heating_season_start: caldera_start,
      robot_wintering: robot_end,
    };
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

  async function ensureGlossaryLoaded() {
    if (!STATE.cache.glossary) {
      STATE.cache.glossary = await fetchJson('glossary.json');
    }
    return STATE.cache.glossary;
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
   * EVO-034: Datos meteorológicos en tiempo real desde Weather Underground (PWS IRIOTU1)
   * ------------------------------------------------------------------------ */
  const WU_STATION_ID = 'IRIOTU1';
  const WU_PUBLIC_TOKEN = 'ff90f212a6984a7390f212a698ea73cc';

  function degToSector16(deg) {
    if (deg === null || deg === undefined || isNaN(deg)) return '—';
    const sectors = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const idx = Math.floor(((Number(deg) + 11.25) % 360) / 22.5);
    return sectors[idx] || '—';
  }

  async function fetchWeatherUndergroundLive() {
    const currentUrl = `https://api.weather.com/v2/pws/observations/current?apiKey=${WU_PUBLIC_TOKEN}&stationId=${WU_STATION_ID}&numericPrecision=decimal&format=json&units=m`;
    const summaryUrl = `https://api.weather.com/v2/pws/dailysummary/1day?apiKey=${WU_PUBLIC_TOKEN}&stationId=${WU_STATION_ID}&numericPrecision=decimal&format=json&units=m`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    try {
      const [respCurrent, respSummary] = await Promise.allSettled([
        fetch(currentUrl, { signal: controller.signal }),
        fetch(summaryUrl, { signal: controller.signal }),
      ]);
      clearTimeout(timeoutId);

      if (respCurrent.status !== 'fulfilled' || !respCurrent.value.ok) {
        throw new Error('Fallo al obtener observación actual de Weather Underground');
      }

      const jsonCurrent = await respCurrent.value.json();
      const obs = jsonCurrent?.observations?.[0];
      if (!obs || !obs.metric) {
        throw new Error('Estructura de observación inválida de Weather Underground');
      }

      let summaryData = null;
      if (respSummary.status === 'fulfilled' && respSummary.value.ok) {
        try {
          const jsonSummary = await respSummary.value.json();
          summaryData = jsonSummary?.summaries?.[0];
        } catch (_) {}
      }

      const m = obs.metric;
      const sm = summaryData?.metric || {};
      const deg = obs.winddir !== null && obs.winddir !== undefined ? Number(obs.winddir) : null;
      const cardinal = deg !== null ? degToSector16(deg) : '—';
      const cardinalName = SECTOR_NAMES_ES[cardinal] ? ` (${SECTOR_NAMES_ES[cardinal]})` : '';

      const localTimeStr = obs.obsTimeLocal || '';
      const [datePart, timePart] = localTimeStr.includes(' ') ? localTimeStr.split(' ') : ['', ''];

      return {
        source: 'Weather Underground (PWS IRIOTU1)',
        source_type: 'live_api',
        station_id: WU_STATION_ID,
        neighborhood: obs.neighborhood || 'Barrio de Arriba (Riotuerto)',
        timestamp: obs.epoch ? obs.epoch * 1000 : Date.now(),
        timestamp_str: localTimeStr,
        date: datePart,
        time: timePart ? timePart.substring(0, 5) : '',
        temperature_c: m.temp !== undefined ? m.temp : null,
        feels_like_c: m.heatIndex !== undefined && m.heatIndex !== m.temp ? m.heatIndex : (m.windChill !== undefined ? m.windChill : m.temp),
        dew_point_c: m.dewpt !== undefined ? m.dewpt : null,
        temp_min_c: sm.tempLow !== undefined ? sm.tempLow : null,
        temp_max_c: sm.tempHigh !== undefined ? sm.tempHigh : null,
        humidity_pct: obs.humidity !== undefined ? obs.humidity : null,
        humidity_min_pct: summaryData?.humidityLow !== undefined ? summaryData.humidityLow : null,
        humidity_max_pct: summaryData?.humidityHigh !== undefined ? summaryData.humidityHigh : null,
        rain_daily_mm: m.precipTotal !== undefined ? m.precipTotal : (sm.precipTotal !== undefined ? sm.precipTotal : 0),
        rain_rate_mm_h: m.precipRate !== undefined ? m.precipRate : 0,
        wind_speed_kmh: m.windSpeed !== undefined ? m.windSpeed : null,
        wind_gust_kmh: m.windGust !== undefined ? m.windGust : null,
        wind_gust_day_max_kmh: sm.windgustHigh !== undefined ? sm.windgustHigh : (m.windGust || null),
        wind_direction_deg: deg,
        wind_direction_cardinal: cardinal,
        wind_direction_name: cardinalName,
        pressure_relative_hpa: m.pressure !== undefined ? m.pressure : null,
        pressure_trend_hpa: sm.pressureTrend !== undefined ? sm.pressureTrend : null,
        solar_radiation_wm2: obs.solarRadiation !== undefined ? obs.solarRadiation : null,
        solar_radiation_max_wm2: summaryData?.solarRadiationHigh !== undefined ? summaryData.solarRadiationHigh : null,
        uv_index: obs.uv !== undefined ? obs.uv : null,
        uv_max_index: summaryData?.uvHigh !== undefined ? summaryData.uvHigh : null,
        dashboard_url: 'https://www.wunderground.com/dashboard/pws/IRIOTU1',
      };
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  async function ensureLiveWeatherLoaded(forceRefresh = false) {
    const now = Date.now();
    // Cache de 30 segundos para evitar llamadas redundantes
    if (!forceRefresh && STATE.liveWeather && (now - STATE.liveWeatherLastFetch < 30000)) {
      return STATE.liveWeather;
    }

    // Nivel 1: Consulta directa en tiempo real a Weather Underground (PWS IRIOTU1)
    try {
      const wuLive = await fetchWeatherUndergroundLive();
      STATE.liveWeather = wuLive;
      STATE.liveWeatherLastFetch = now;
      return STATE.liveWeather;
    } catch (err) {
      console.warn('Weather Underground no disponible o sin conexión. Recurriendo a snapshot local data/live.json:', err);
    }

    // Nivel 2: Contingencia mediante snapshot estático local data/live.json
    try {
      const snap = await fetchJson(`live.json?_=${now}`);
      snap.source_type = 'fallback_json';
      snap.source = snap.source || 'Estación Barrio de Arriba (archivo estático)';
      STATE.liveWeather = snap;
      STATE.liveWeatherLastFetch = now;
      return STATE.liveWeather;
    } catch (e) {
      console.warn('No se pudo cargar live.json, recurriendo a último registro en memoria:', e);
      if (STATE.liveWeather) return STATE.liveWeather;
      throw e;
    }
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
    const [idx, comparisons, almanacs, recordsData, liveData] = await Promise.all([
      ensureIndexLoaded(),
      ensureComparisonsLoaded(),
      ensureAllAlmanacsLoaded(),
      ensureRecordsLoaded(),
      ensureLiveWeatherLoaded().catch(() => null),
    ]);

    const container = document.getElementById('view-portada');
    const overview = idx.series_overview;
    const ref = overview.reference_2022_2025;
    const rec = idx.headline_records;
    const yearsSummary = [...idx.years_summary].sort((a, b) => b.year - a.year);

    // EVO-029: Titulares sinópticos de autor y efemérides destacadas por año
    const YEAR_EDITORIAL_HEADLINES = {
      2022: 'Año cálido y seco con estío prolongado y marcadas suradas otoñales',
      2023: 'Grandes contrastes: el temporal Fien (509,8 mm en enero) y acusada sequía estival',
      2024: 'Récord absoluto de calor (42,1 °C) y temporales atlánticos de viento sur',
      2025: 'Pluviosidad abundante y gran regularidad estacional en el valle',
      2026: 'Avance provisional del año en curso (registro consolidado hasta octubre)',
    };

    const YEAR_EDITORIAL_HIGHLIGHTS = {
      2022: 'Mes más húmedo: Noviembre (261,1 mm) · 35 días de Surada / Foehn · Racha máx.: 73,4 km/h',
      2023: 'Temporal Fien: 125,9 mm en 24 h y enero récord (509,8 mm) · Máxima de 40,4 °C en agosto',
      2024: 'Récord histórico de 42,1 °C (11 ago.) · Vendaval Karlotta de 97,2 km/h · 2.047,9 mm anuales',
      2025: 'Descarga torrencial récord de 145,2 mm/h en junio · 1.706,9 mm anuales con 218 días de lluvia',
      2026: '300 días observados hasta octubre · Récord de amplitud de 25,2 °C (julio) · 1.505,2 mm acumulados',
    };

    const almanacCardsHtml = yearsSummary.map((y) => {
      const headline = YEAR_EDITORIAL_HEADLINES[y.year] || y.character;
      const highlight = YEAR_EDITORIAL_HIGHLIGHTS[y.year] || `Mes más húmedo: ${escapeHtml(y.wettest_month)} (${fmtNum(y.wettest_month_mm, 1)} mm)`;
      const badgeHtml = y.is_provisional
        ? `<span class="badge badge-provisional">Avance provisional · ${fmtNum(y.valid_days, 0)} días</span>`
        : `<span class="badge badge-complete">Anuario consolidado · ${fmtNum(y.coverage_pct, 1)}%</span>`;

      return `
        <a href="#almanaque/${y.year}" class="almanac-card" aria-label="Abrir almanaque meteorológico de ${y.year}">
          <div>
            <div class="almanac-card-top">
              <span class="almanac-year-num">${y.year}</span>
              ${badgeHtml}
            </div>
            <div class="almanac-character">${escapeHtml(headline)}</div>
            <p class="almanac-headline">
              ${escapeHtml(highlight)}
            </p>
          </div>
          <div>
            <div class="almanac-mini-stats">
              <div>
                <span>Precipitación anual</span>
                <strong>${fmtNum(y.rain_total_mm, 1)} mm</strong>
                <small>${fmtNum(y.rain_days_02, 0)} días de lluvia</small>
              </div>
              <div>
                <span>Temperatura media</span>
                <strong>${fmtNum(y.temp_mean, 1)} °C</strong>
                <small>${fmtNum(y.temp_min_abs, 1)} / ${fmtNum(y.temp_max_abs, 1)} °C</small>
              </div>
              <div>
                <span>Techo eólico</span>
                <strong>${fmtNum(y.wind_gust_max_kmh, 1)} km/h</strong>
                <small>${fmtDateES(y.wind_gust_max_date, false)}</small>
              </div>
              <div>
                <span>Surada (Foehn)</span>
                <strong>${y.foehn_days !== undefined ? fmtNum(y.foehn_days, 0) + ' días' : '—'}</strong>
                <small>Compresión adiabática</small>
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
      <!-- Bloque editorial de bienvenida simplificado y de carga ágil (EVO-026) -->
      <article class="editorial-hero">
        <div class="editorial-kicker">NOTARIO DEL CLIMA DE RIOTUERTO · ARCHIVO HISTÓRICO VERIFICADO</div>
        <h2 id="portada-heading" class="editorial-title">
          La memoria meteorológica y climatológica de Riotuerto
        </h2>
        <p class="editorial-lead">
          <strong>MeteoRiotuerto</strong> documenta, analiza y conserva el registro instrumental de las condiciones
          atmosféricas observadas en <strong>Barrio de Arriba (municipio de Riotuerto, Cantabria)</strong>.
          Concebido como un almanaque anual riguroso y abierto, transforma las lecturas de la estación automática
          en crónicas sinópticas, efemérides y series históricas al servicio del vecindario, aficionados e investigadores.
        </p>

        <!-- Pastilla de localización geográfica sintética -->
        <div class="hero-geo-pill mono" aria-label="Emplazamiento de la estación">
          <span>📍 Barrio de Arriba · Riotuerto (Cantabria)</span>
          <span class="geo-divider" aria-hidden="true">·</span>
          <span><a href="${idx.station.links.openstreetmap || 'https://www.openstreetmap.org/?mlat=43.341&mlon=-3.670#map=15/43.341/-3.670'}" target="_blank" rel="noopener noreferrer" style="text-decoration:underline" title="Ver coordenadas en OpenStreetMap">43.341° N, 3.670° W</a></span>
          <span class="geo-divider" aria-hidden="true">·</span>
          <span>115 m s. n. m.</span>
        </div>

        <!-- Fila de accesos directos principales -->
        <div class="hero-actions">
          <a href="#almanaque/2025" class="btn btn-primary hero-btn" data-scroll-to="sec-almanaques-title">
            <span>📖 Explorar almanaques anuales</span>
            <span aria-hidden="true">↓</span>
          </a>
          <a href="#sec-featured-episodes" class="btn btn-secondary hero-btn" data-scroll-to="sec-featured-episodes">
            <span>⚡ Grandes acontecimientos</span>
            <span aria-hidden="true">↓</span>
          </a>
          <a href="${idx.station.links.weathercloud || 'https://app.weathercloud.net/d6619283754'}" target="_blank" rel="noopener noreferrer" class="hero-btn-live" title="Consultar lecturas instantáneas en Weathercloud">
            <span class="pulse-dot" aria-hidden="true"></span>
            <span>Tiempo actual en vivo (Weathercloud) ↗</span>
          </a>
        </div>
      </article>

      <!-- EVO-032: Píldora de tiempo actual en directo desde la API de Ecowitt / snapshot de la estación -->
      <section id="sec-live-weather" class="live-weather-card" aria-labelledby="live-weather-heading">
        <!-- Renderizado dinámico por renderLiveWeatherWidget() -->
      </section>

      <!-- Síntesis cuantitativa del archivo (Indicadores generales en primer plano) -->
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

      <!-- EVO-027: Escaparate editorial de Grandes Acontecimientos Meteorológicos en Portada -->
      <section class="section-block" id="sec-featured-episodes" aria-labelledby="sec-featured-episodes-title">
        <div class="section-header">
          <div>
            <div class="editorial-kicker">HISTORIA Y MEMORIA CLIMÁTICA DEL MUNICIPIO</div>
            <h2 id="sec-featured-episodes-title" class="section-title">Acontecimientos meteorológicos que marcaron Riotuerto</h2>
            <p class="section-subtitle">Episodios extraordinarios, temporales y récords documentados por la estación en Barrio de Arriba</p>
          </div>
          <a href="#records" class="btn">Explorar catálogo de 91 episodios extremos →</a>
        </div>
        <div class="featured-episodes-grid">
          <!-- Episodio 1: Borrasca Fien (2023) -->
          <article class="episode-featured-card episode-card-rain">
            <div class="episode-card-header">
              <div class="episode-badge-wrap">
                <span class="episode-badge episode-badge-wet_spell">🌧️ Récord de precipitación</span>
                <span class="episode-tag">Temporal invernal del noroeste</span>
              </div>
              <span class="episode-date mono">16–18 ene. 2023</span>
            </div>
            <div class="episode-card-body">
              <h3 class="episode-title">
                Borrasca Fien: 125,9 mm en 24 h y el mes más lluvioso del registro histórico
              </h3>
              <div class="episode-kpis-strip">
                <div class="episode-kpi">
                  <span class="kpi-label">Lluvia en 24 h</span>
                  <strong class="kpi-val val-rain">125,9 mm</strong>
                  <span class="kpi-sub">16 de enero (récord absoluto)</span>
                </div>
                <div class="episode-kpi">
                  <span class="kpi-label">Racha máx. viento</span>
                  <strong class="kpi-val">82,1 km/h</strong>
                  <span class="kpi-sub">NW temporal marítimo</span>
                </div>
                <div class="episode-kpi">
                  <span class="kpi-label">Mes de enero</span>
                  <strong class="kpi-val val-rain">509,8 mm</strong>
                  <span class="kpi-sub">Mes récord de la serie</span>
                </div>
              </div>
              <p class="episode-narrative">
                Durante la tercera semana de enero de 2023, una sucesión de borrascas atlánticas canalizó un flujo marítimo polar directo contra la cornisa cantábrica. La orografía del valle del Covadal actuó como barrera de retención, descargando 125,9 mm en un solo día en Barrio de Arriba y provocando la crecida de la cuenca del río Miera.
              </p>
            </div>
            <div class="episode-card-footer">
              <a href="#almanaque/2023" class="btn btn-sm btn-primary">Almanaque 2023 →</a>
              <a href="#almanaque/2023/mes-01" class="btn btn-sm btn-secondary">📅 Ver enero 2023</a>
              <a href="#records/episodio/wet-2023-01-11" class="btn btn-sm btn-subtle">⚡ Episodio extremo ↗</a>
              <a href="#explorador/2023-01-14/2023-01-20/rain" class="btn btn-sm btn-subtle" title="Ver registros brutos de lluvia en el Explorador">🔍 Datos en Explorador</a>
            </div>
          </article>

          <!-- Episodio 2: Ola de calor sahariana y Foehn (2024) -->
          <article class="episode-featured-card episode-card-heat">
            <div class="episode-card-header">
              <div class="episode-badge-wrap">
                <span class="episode-badge episode-badge-heatwave">🔥 Récord histórico térmico</span>
                <span class="episode-tag">Efecto Foehn / Viento sur</span>
              </div>
              <span class="episode-date mono">11 ago. 2024</span>
            </div>
            <div class="episode-card-body">
              <h3 class="episode-title">
                42,1 °C en Barrio de Arriba: el pico térmico de la serie meteorológica
              </h3>
              <div class="episode-kpis-strip">
                <div class="episode-kpi">
                  <span class="kpi-label">Temperatura máx.</span>
                  <strong class="kpi-val val-heat">42,1 °C</strong>
                  <span class="kpi-sub">Registrado a las 14:30 h</span>
                </div>
                <div class="episode-kpi">
                  <span class="kpi-label">Humedad relativa</span>
                  <strong class="kpi-val">18 %</strong>
                  <span class="kpi-sub">Desplome por compresión</span>
                </div>
                <div class="episode-kpi">
                  <span class="kpi-label">Racha de viento sur</span>
                  <strong class="kpi-val">68,4 km/h</strong>
                  <span class="kpi-sub">Descolgado desde Alisas</span>
                </div>
              </div>
              <p class="episode-narrative">
                Una advección de aire cálido de origen norteafricano combinada con un marcado flujo de viento sur descolgándose ladera abajo desde la divisoria cordillerana provocó un recalentamiento adiabático extremo en el fondo del valle. La temperatura pulverizó el récord de la estación bajo aviso meteorológico rojo en toda Cantabria.
              </p>
            </div>
            <div class="episode-card-footer">
              <a href="#almanaque/2024" class="btn btn-sm btn-primary">Almanaque 2024 →</a>
              <a href="#almanaque/2024/mes-08" class="btn btn-sm btn-secondary">📅 Ver agosto 2024</a>
              <a href="#records/rankings/top_hottest_days" class="btn btn-sm btn-subtle">🔥 Top 10 de calor ↗</a>
              <a href="#explorador/2024-08-09/2024-08-13/temp_max" class="btn btn-sm btn-subtle" title="Ver serie de temperaturas en el Explorador">🔍 Datos en Explorador</a>
            </div>
          </article>

          <!-- Episodio 3: Vendaval de la borrasca Karlotta (2024) -->
          <article class="episode-featured-card episode-card-wind">
            <div class="episode-card-header">
              <div class="episode-badge-wrap">
                <span class="episode-badge episode-badge-foehn_spell">💨 Techo eólico histórico</span>
                <span class="episode-tag">Vendaval atlántico de sur</span>
              </div>
              <span class="episode-date mono">8 feb. 2024</span>
            </div>
            <div class="episode-card-body">
              <h3 class="episode-title">
                Borrasca Karlotta: vendaval de 97,2 km/h encajonado en el valle del Covadal
              </h3>
              <div class="episode-kpis-strip">
                <div class="episode-kpi">
                  <span class="kpi-label">Racha máx. eólica</span>
                  <strong class="kpi-val val-wind">97,2 km/h</strong>
                  <span class="kpi-sub">16:00 h (récord absoluto)</span>
                </div>
                <div class="episode-kpi">
                  <span class="kpi-label">Viento medio sost.</span>
                  <strong class="kpi-val">38,5 km/h</strong>
                  <span class="kpi-sub">Fuerza 5–6 Beaufort</span>
                </div>
                <div class="episode-kpi">
                  <span class="kpi-label">Sector dominante</span>
                  <strong class="kpi-val">SSW (Sur)</strong>
                  <span class="kpi-sub">Canalizado desde Alisas</span>
                </div>
              </div>
              <p class="episode-narrative">
                El paso de la profunda ciclogénesis atlántica Karlotta generó un fortísimo gradiente bárico sobre el norte peninsular. En Riotuerto, el viento sur aceleró bruscamente al encajonarse por el valle hacia La Cavada, registrando la racha más violenta de toda la serie observada (97,2 km/h).
              </p>
            </div>
            <div class="episode-card-footer">
              <a href="#almanaque/2024" class="btn btn-sm btn-primary">Almanaque 2024 →</a>
              <a href="#almanaque/2024/mes-02" class="btn btn-sm btn-secondary">📅 Ver febrero 2024</a>
              <a href="#records/rankings/top_windiest_days" class="btn btn-sm btn-subtle">💨 Top 10 eólico ↗</a>
              <a href="#explorador/2024-02-06/2024-02-10/wind_gust_max" class="btn btn-sm btn-subtle" title="Ver rachas de viento en el Explorador">🔍 Datos en Explorador</a>
            </div>
          </article>

          <!-- Episodio 4: Tormenta torrencial convectiva (2025) -->
          <article class="episode-featured-card episode-card-storm">
            <div class="episode-card-header">
              <div class="episode-badge-wrap">
                <span class="episode-badge episode-badge-coldwave">⚡ Diluvio torrencial estival</span>
                <span class="episode-tag">Convección vespertina severa</span>
              </div>
              <span class="episode-date mono">10 jun. 2025</span>
            </div>
            <div class="episode-card-body">
              <h3 class="episode-title">
                Descarga torrencial récord: 44,2 mm en una hora y tasa instantánea de 145,2 mm/h
              </h3>
              <div class="episode-kpis-strip">
                <div class="episode-kpi">
                  <span class="kpi-label">Intensidad máxima</span>
                  <strong class="kpi-val val-rain">145,2 mm/h</strong>
                  <span class="kpi-sub">Tasa instantánea récord</span>
                </div>
                <div class="episode-kpi">
                  <span class="kpi-label">Precipitación 1 h</span>
                  <strong class="kpi-val val-rain">44,2 mm</strong>
                  <span class="kpi-sub">20:00–21:00 h</span>
                </div>
                <div class="episode-kpi">
                  <span class="kpi-label">Total en la jornada</span>
                  <strong class="kpi-val">62,4 mm</strong>
                  <span class="kpi-sub">En solo 3 horas</span>
                </div>
              </div>
              <p class="episode-narrative">
                Tras una tarde calurosa con más de 27 °C, la entrada de aire frío en capas altas desató una violenta célula tormentosa vespertina anclada sobre el relieve de Riotuerto. La estación registró la mayor intensidad horaria de su historia, descargando 44,2 mm en apenas sesenta minutos.
              </p>
            </div>
            <div class="episode-card-footer">
              <a href="#almanaque/2025" class="btn btn-sm btn-primary">Almanaque 2025 →</a>
              <a href="#almanaque/2025/mes-06" class="btn btn-sm btn-secondary">📅 Ver junio 2025</a>
              <a href="#records/absolutos" class="btn btn-sm btn-subtle">⚡ Extremos absolutos ↗</a>
              <a href="#explorador/2025-06-08/2025-06-12/rain" class="btn btn-sm btn-subtle" title="Ver datos de precipitación en el Explorador">🔍 Datos en Explorador</a>
            </div>
          </article>
        </div>
      </section>

      <!-- EVO-004: Bloque interactivo «Un día como hoy en MeteoRiotuerto» -->
      <section class="section-block on-this-day-section" id="sec-on-this-day" aria-labelledby="sec-otd-title">
        <div id="on-this-day-widget"></div>
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

      <!-- Banner costumbrista y vecinal: Riotuerto cotidiano -->
      <section class="section-block" style="background: linear-gradient(135deg, rgba(16,185,129,0.07), rgba(37,99,235,0.06)); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 22px;">
        <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px;">
          <div style="max-width: 720px;">
            <span class="guide-badge">🚜 Información práctica para el vecindario</span>
            <h3 style="font-family: var(--font-serif); font-size: 1.35rem; margin: 6px 0; color: var(--txt-primary);">
              Riotuerto cotidiano: labores del campo, el hogar y fiestas locales
            </h3>
            <p style="color: var(--txt-secondary); margin: 0; font-size: 0.92rem; line-height: 1.55;">
              Información clara y sin tecnicismos para el día a día en el municipio: orientación para el encendido de calderas, fechas de siega de praderas, alertas de mildiu en la huerta, temporada de setas y la memoria meteorológica de nuestras 8 fiestas y tradiciones.
            </p>
          </div>
          <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            <a href="#cotidiano" class="btn btn-primary" style="white-space: nowrap;">Abrir Riotuerto cotidiano →</a>
            <a href="#cotidiano/fiestas" class="btn btn-secondary" style="white-space: nowrap;">Ver fiestas locales</a>
          </div>
        </div>
      </section>

      <!-- Archivo y Análisis de la serie histórica (EVO-030) -->
      <section class="section-block" aria-labelledby="sec-analisis-archive-title" style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 24px;">
        <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px;">
          <div style="max-width: 680px;">
            <span class="guide-badge">📊 Series históricas y herramientas analíticas</span>
            <h3 id="sec-analisis-archive-title" style="font-family: var(--font-serif); font-size: 1.35rem; margin: 6px 0; color: var(--txt-primary);">
              Archivo analítico, comparador interanual y metodología
            </h3>
            <p style="color: var(--txt-secondary); margin: 0; font-size: 0.92rem; line-height: 1.55;">
              Consulte la evolución de las series diarias desde 2022, enfrente años cara a cara (<em>head-to-head</em>), examine los balances hídricos, audite la instrumentación técnica y descargue los registros en formatos abiertos (CSV, JSON y GeoJSON).
            </p>
          </div>
          <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            <a href="#comparativas" class="btn btn-primary" style="white-space: nowrap;">Comparativas entre años →</a>
            <a href="#explorador" class="btn btn-secondary" style="white-space: nowrap;">Explorador de series</a>
            <a href="#metodologia" class="btn btn-secondary" style="white-space: nowrap;">Metodología y datos</a>
          </div>
        </div>
      </section>
    `;

    // Renderizar píldora de tiempo actual en directo (EVO-032)
    if (liveData) {
      renderLiveWeatherWidget(liveData, ref);
    }

    // Renderizar bloque «Un día como hoy en MeteoRiotuerto» (EVO-004 y EVO-028)
    renderOnThisDayWidget(idx, almanacs, recordsData);
  }

  /* ------------------------------------------------------------------------
   * EVO-034: Renderizado del widget de tiempo actual en directo (Weather Underground + Ecowitt)
   * ------------------------------------------------------------------------ */
  function renderLiveWeatherWidget(live, ref) {
    const wrap = document.getElementById('sec-live-weather');
    if (!wrap || !live) return;

    const isLive = live.source_type === 'live_api';
    const badgeText = isLive
      ? `Tiempo real · Weather Underground (${live.station_id || 'IRIOTU1'})`
      : 'Última observación · Estación Barrio de Arriba';
    const badgeClass = isLive ? 'live-badge' : 'live-badge badge-offline';
    const liveTime = live.time || (live.timestamp_str ? (live.timestamp_str.includes(' ') ? live.timestamp_str.split(' ')[1].substring(0, 5) : live.timestamp_str) : '—');
    const liveDate = live.date || (live.timestamp_str ? (live.timestamp_str.includes(' ') ? live.timestamp_str.split(' ')[0] : '') : '');

    // Contraste climatológico con la referencia histórica del mes en curso
    let contrastHtml = '';
    if (ref && ref.monthly_mean_temp_c && liveDate) {
      const parts = liveDate.split('-');
      const mIdx = parts.length > 1 ? parseInt(parts[1], 10) - 1 : 9;
      const mName = MONTH_NAMES_ES[mIdx] || '';
      const refMonthTemp = ref.monthly_mean_temp_c[mIdx];
      const refMonthRain = ref.monthly_mean_rain_mm[mIdx];

      if (refMonthTemp !== undefined && live.temperature_c !== null) {
        const diffT = live.temperature_c - refMonthTemp;
        const diffTStr = diffT >= 0 ? `+${fmtNum(diffT, 1)} °C por encima` : `${fmtNum(diffT, 1)} °C por debajo`;
        contrastHtml = `
          <div class="live-climatology-contrast" role="note">
            <span aria-hidden="true" style="font-size:1.1rem;line-height:1">📊</span>
            <div>
              <strong>Contraste con el archivo climatológico:</strong>
              La temperatura actual de <strong>${fmtNum(live.temperature_c, 1)} °C</strong> se sitúa <strong>${diffTStr}</strong> del promedio histórico de ${mName.toLowerCase()} en Barrio de Arriba (${fmtNum(refMonthTemp, 1)} °C).
              La lluvia registrada hoy suma <strong>${fmtNum(live.rain_daily_mm, 1)} mm</strong> (frente a la media mensual de ${fmtNum(refMonthRain, 1)} mm).
            </div>
          </div>
        `;
      }
    }

    // Subtítulos dinámicos enriquecidos con extremos del día
    const tempExtremesStr = (live.temp_min_c !== null && live.temp_max_c !== null)
      ? `Mín: <strong>${fmtNum(live.temp_min_c, 1)} °C</strong> · Máx: <strong>${fmtNum(live.temp_max_c, 1)} °C</strong>`
      : 'Extremo térmico en consolidación';

    const humRangeStr = (live.humidity_min_pct !== null && live.humidity_max_pct !== null)
      ? `Rango hoy: <strong>${fmtNum(live.humidity_min_pct, 0)}%</strong> – <strong>${fmtNum(live.humidity_max_pct, 0)}%</strong>`
      : 'Condensación sobre pastos y follaje';

    const windRachaStr = live.wind_gust_day_max_kmh !== null
      ? `Racha máx hoy: <strong>${fmtNum(live.wind_gust_day_max_kmh, 1)} km/h</strong>`
      : (live.wind_gust_kmh ? `Racha: <strong>${fmtNum(live.wind_gust_kmh, 1)} km/h</strong>` : 'Racha del momento');

    const windDirStr = live.wind_direction_deg !== null
      ? `Rumbo: <strong>${live.wind_direction_deg}° (${live.wind_direction_cardinal})</strong>${live.wind_direction_name || ''}`
      : 'Rumbo: —';

    const baroTrendStr = live.pressure_trend_hpa !== null
      ? `Tendencia: <strong>${live.pressure_trend_hpa >= 0 ? '+' : ''}${fmtNum(live.pressure_trend_hpa, 2)} hPa</strong>`
      : 'Presión relativa a nivel del mar';

    wrap.innerHTML = `
      <div class="live-weather-header">
        <div class="live-weather-title-wrap">
          <span class="${badgeClass}">
            <span class="live-pulse-dot" aria-hidden="true"></span>
            <span>${badgeText}</span>
          </span>
          <h3 id="live-weather-heading" class="live-weather-title">Tiempo actual en Barrio de Arriba</h3>
          <span class="live-weather-time">Observación del <strong>${fmtDateES(liveDate, false)}</strong> a las <strong>${escapeHtml(liveTime)} h</strong></span>
        </div>
        <div class="live-weather-actions">
          <button type="button" id="btn-live-refresh" class="btn-live-action" title="Actualizar lectura instantánea desde Weather Underground">
            <span class="spin-icon" aria-hidden="true">🔄</span>
            <span>Actualizar</span>
          </button>
          <a href="${escapeHtml(live.dashboard_url || 'https://www.wunderground.com/dashboard/pws/IRIOTU1')}" target="_blank" rel="noopener noreferrer" class="btn-live-action" title="Abrir estación IRIOTU1 en Weather Underground">
            <span aria-hidden="true">↗</span>
            <span>Wunderground</span>
          </a>
          <a href="https://www.ecowitt.net/home/index?id=33161" target="_blank" rel="noopener noreferrer" class="btn-live-action" title="Abrir monitor completo en Ecowitt.net">
            <span aria-hidden="true">↗</span>
            <span>Ecowitt.net</span>
          </a>
        </div>
      </div>

      <div class="live-kpi-grid" aria-label="Condiciones meteorológicas actuales">
        <div class="live-kpi-card">
          <div class="live-kpi-card-header">
            <span>🌡️ Temperatura</span>
            <span class="live-kpi-unit">Extremos del día</span>
          </div>
          <div class="live-kpi-main-val">
            ${live.temperature_c !== null ? fmtNum(live.temperature_c, 1) : '—'} <span class="live-kpi-unit">°C</span>
          </div>
          <div class="live-kpi-subdetail">
            Sensación: <strong>${live.feels_like_c !== null ? fmtNum(live.feels_like_c, 1) : '—'} °C</strong><br>
            ${tempExtremesStr}
          </div>
        </div>

        <div class="live-kpi-card">
          <div class="live-kpi-card-header">
            <span>💧 Humedad relativa</span>
            <span class="live-kpi-unit">Higrometría</span>
          </div>
          <div class="live-kpi-main-val">
            ${live.humidity_pct !== null ? fmtNum(live.humidity_pct, 0) : '—'} <span class="live-kpi-unit">%</span>
          </div>
          <div class="live-kpi-subdetail">
            Punto de rocío: <strong>${live.dew_point_c !== null ? fmtNum(live.dew_point_c, 1) : '—'} °C</strong><br>
            ${humRangeStr}
          </div>
        </div>

        <div class="live-kpi-card">
          <div class="live-kpi-card-header">
            <span>🌧️ Precipitación hoy</span>
            <span class="live-kpi-unit">Pluviometría</span>
          </div>
          <div class="live-kpi-main-val">
            ${live.rain_daily_mm !== null ? fmtNum(live.rain_daily_mm, 1) : '0,0'} <span class="live-kpi-unit">mm</span>
          </div>
          <div class="live-kpi-subdetail">
            Intensidad actual: <strong>${live.rain_rate_mm_h !== null ? fmtNum(live.rain_rate_mm_h, 1) : '0,0'} mm/h</strong><br>
            Acumulador balancín calibrado WH40
          </div>
        </div>

        <div class="live-kpi-card">
          <div class="live-kpi-card-header">
            <span>💨 Viento y racha</span>
            <span class="live-kpi-unit">Anemometría</span>
          </div>
          <div class="live-kpi-main-val">
            ${live.wind_speed_kmh !== null ? fmtNum(live.wind_speed_kmh, 1) : '0,0'} <span class="live-kpi-unit">km/h</span>
          </div>
          <div class="live-kpi-subdetail">
            ${windRachaStr}<br>
            ${windDirStr}
          </div>
        </div>

        <div class="live-kpi-card">
          <div class="live-kpi-card-header">
            <span>🧭 Barometría y Sol</span>
            <span class="live-kpi-unit">Atmósfera</span>
          </div>
          <div class="live-kpi-main-val">
            ${live.pressure_relative_hpa !== null ? fmtNum(live.pressure_relative_hpa, 1) : '—'} <span class="live-kpi-unit">hPa</span>
          </div>
          <div class="live-kpi-subdetail">
            Radiación: <strong>${live.solar_radiation_wm2 !== null ? fmtNum(live.solar_radiation_wm2, 0) : '0'} W/m²</strong> · UV: <strong>${live.uv_index !== null ? fmtNum(live.uv_index, 0) : '0'}</strong><br>
            ${baroTrendStr}
          </div>
        </div>
      </div>

      ${contrastHtml}
    `;

    // Conectar evento de actualización inmediata
    const refreshBtn = document.getElementById('btn-live-refresh');
    refreshBtn?.addEventListener('click', async () => {
      refreshBtn.classList.add('btn-refreshing');
      try {
        const fresh = await ensureLiveWeatherLoaded(true);
        renderLiveWeatherWidget(fresh, ref);
      } catch (err) {
        console.error('Error actualizando tiempo en vivo:', err);
      } finally {
        refreshBtn.classList.remove('btn-refreshing');
      }
    });
  }

  /* ------------------------------------------------------------------------
   * EVO-028: Evaluador algorítmico del titular divulgativo para «Tal día como hoy»
   * Prioriza en orden:
   *  1. Récord absoluto de la serie registrado en la fecha (MM-DD)
   *  2. Coincidencia con pico o ventana de episodio extremo catalogado
   *  3. Anomalía acusada del día (lluvia ≥25mm, calor ≥27°C, viento ≥60km/h, helada ≤1°C, oscilación)
   *  4. Veredicto descriptivo apacible y representativo (fallback meteorológico)
   * ------------------------------------------------------------------------ */
  function evaluateOnThisDayHeadline(month, day, dayLabel, validEntries, recordsData) {
    if (!validEntries || validEntries.length === 0) {
      return {
        boxClass: 'verdict-mild',
        badgeClass: 'badge-mild',
        badgeIcon: 'ℹ️',
        badgeText: 'Sin registros consolidados',
        levelLabel: 'Información del archivo',
        title: `Sin observaciones disponibles para el ${dayLabel}`,
        description: 'No constan observaciones validadas en esta fecha. Seleccione cualquier otro día del calendario mediante el selector superior.',
        linkHtml: '',
      };
    }

    const mmdd = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    // NIVEL 1: Récord absoluto de la serie en esta fecha
    if (recordsData && recordsData.absolute_records) {
      const absRecs = recordsData.absolute_records;
      for (const [k, r] of Object.entries(absRecs)) {
        if (r && r.date && r.date.endsWith(`-${mmdd}`)) {
          const recTitle = `Efeméride destacada: Récord absoluto de ${r.label || k} (${fmtNum(r.value, 1)} ${r.unit || ''})`;
          const recDesc = r.context || `El ${dayLabel} de ${r.year} la estación registró el valor extremo histórico de ${fmtNum(r.value, 1)} ${r.unit || ''} en Barrio de Arriba.`;
          return {
            boxClass: 'verdict-record',
            badgeClass: 'badge-record',
            badgeIcon: '🏆',
            badgeText: 'Récord histórico de la serie',
            levelLabel: `Récord absoluto (${r.year})`,
            title: recTitle,
            description: recDesc,
            linkHtml: `<a href="#almanaque/${r.year}">Consultar crónica sinóptica del año ${r.year} →</a> · <a href="#records">Ver todos los récords ↗</a>`,
          };
        }
      }
    }

    // NIVEL 2: Coincidencia con episodio extremo catalogado
    if (recordsData && recordsData.extreme_episodes && recordsData.extreme_episodes.episodes) {
      const episodes = recordsData.extreme_episodes.episodes;
      for (const ep of episodes) {
        if (ep.peak_date && ep.peak_date.endsWith(`-${mmdd}`)) {
          return {
            boxClass: 'verdict-extreme',
            badgeClass: 'badge-extreme',
            badgeIcon: ep.type_icon || '⚠️',
            badgeText: `${ep.type_label || 'Episodio extremo'} (${ep.year})`,
            levelLabel: 'Pico de episodio catalogado',
            title: `Pico álgido de ${ep.type_label?.toLowerCase() || 'episodio'}: ${ep.summary || ''}`,
            description: `El ${dayLabel} de ${ep.year} registró el momento culminante de este episodio extremo en el valle, alcanzando ${fmtNum(ep.peak_value, 1)} ${ep.peak_value_unit || ''}.`,
            linkHtml: `<a href="#almanaque/${ep.year}">Ver crónica anual de ${ep.year} →</a> · <a href="#records">Explorar catálogo de 91 extremos ↗</a>`,
          };
        }
      }
    }

    // NIVEL 3: Anomalías acusadas del día observadas en los datos
    let maxRain = null;
    let maxTemp = null;
    let minTemp = null;
    let maxGust = null;

    validEntries.forEach((e) => {
      if (!maxRain || e.rain > maxRain.rain) maxRain = e;
      if (!maxTemp || e.tmax > maxTemp.tmax) maxTemp = e;
      if (!minTemp || e.tmin < minTemp.tmin) minTemp = e;
      if (!maxGust || (e.gust || 0) > (maxGust.gust || 0)) maxGust = e;
    });

    if (maxRain && maxRain.rain >= 25) {
      return {
        boxClass: 'verdict-anomaly',
        badgeClass: 'badge-anomaly',
        badgeIcon: '🌧️',
        badgeText: 'Jornada de temporal de lluvia',
        levelLabel: `Anomalía pluviométrica (${maxRain.year})`,
        title: `Temporal lluvioso en ${maxRain.year}: se acumularon ${fmtNum(maxRain.rain, 1)} mm en 24 horas`,
        description: `Con una racha máxima de viento de ${fmtNum(maxRain.gust, 1)} km/h (${maxRain.sector}), el ${dayLabel} de ${maxRain.year} fue con diferencia el más húmedo del registro reciente en Barrio de Arriba.`,
        linkHtml: `<a href="#almanaque/${maxRain.year}">Abrir anuario de ${maxRain.year} →</a>`,
      };
    }

    if (maxTemp && maxTemp.tmax >= 27) {
      return {
        boxClass: 'verdict-anomaly',
        badgeClass: 'badge-anomaly',
        badgeIcon: '🔥',
        badgeText: 'Surada / Temperatura anómala',
        levelLabel: `Anomalía térmica cálida (${maxTemp.year})`,
        title: `Calor anómalo en ${maxTemp.year}: el termómetro trepó hasta los ${fmtNum(maxTemp.tmax, 1)} °C`,
        description: `Un marcado flujo de componente sur (${maxTemp.sector}) descolgado desde la divisoria de Alisas disparó la temperatura y hundió la humedad relativa en el fondo del valle.`,
        linkHtml: `<a href="#almanaque/${maxTemp.year}">Abrir anuario de ${maxTemp.year} →</a>`,
      };
    }

    if (maxGust && maxGust.gust >= 60) {
      return {
        boxClass: 'verdict-anomaly',
        badgeClass: 'badge-anomaly',
        badgeIcon: '💨',
        badgeText: 'Vendaval destacado en el valle',
        levelLabel: `Racha eólica notable (${maxGust.year})`,
        title: `Fuerte vendaval en ${maxGust.year}: racha máxima registrada de ${fmtNum(maxGust.gust, 1)} km/h`,
        description: `Viento impetuoso de componente ${maxGust.sector} encajonado por el relieve del Covadal hacia La Cavada.`,
        linkHtml: `<a href="#almanaque/${maxGust.year}">Abrir anuario de ${maxGust.year} →</a>`,
      };
    }

    if (minTemp && minTemp.tmin <= 1.0) {
      return {
        boxClass: 'verdict-anomaly',
        badgeClass: 'badge-anomaly',
        badgeIcon: '❄️',
        badgeText: 'Madrugada gélida / Helada',
        levelLabel: `Helada en el valle (${minTemp.year})`,
        title: `Madrugada gélida en ${minTemp.year}: el termómetro bajó hasta los ${fmtNum(minTemp.tmin, 1)} °C`,
        description: `Inversión térmica nocturna bajo cielo despejado que provocó escarcha y temperaturas mínimas bajo cero o al borde del punto de congelación en Barrio de Arriba.`,
        linkHtml: `<a href="#almanaque/${minTemp.year}">Abrir anuario de ${minTemp.year} →</a>`,
      };
    }

    if (maxTemp && minTemp && (maxTemp.tmax - minTemp.tmin) >= 14) {
      return {
        boxClass: 'verdict-anomaly',
        badgeClass: 'badge-anomaly',
        badgeIcon: '🌡️',
        badgeText: 'Marcado contraste interanual',
        levelLabel: 'Variabilidad climática reciente',
        title: `Gran disparidad entre años: de ${fmtNum(minTemp.tmin, 1)} °C en ${minTemp.year} a ${fmtNum(maxTemp.tmax, 1)} °C en ${maxTemp.year}`,
        description: `Una oscilación de más de ${fmtNum(maxTemp.tmax - minTemp.tmin, 0)} °C en la misma fecha del calendario refleja la acusada alternancia entre advecciones marítimas húmedas y suradas en Riotuerto.`,
        linkHtml: `<a href="#comparativas">Comparar todos los años en detalle →</a>`,
      };
    }

    // NIVEL 4: Día meteorológicamente apacible y típico (Fallback descriptivo)
    const validCount = validEntries.length;
    const meanTempAll = validEntries.reduce((acc, e) => acc + e.tmean, 0) / validCount;
    const rainyYearsCount = validEntries.filter((e) => e.rain >= 0.2).length;

    if (rainyYearsCount >= Math.ceil(validCount * 0.6)) {
      return {
        boxClass: 'verdict-mild',
        badgeClass: 'badge-mild',
        badgeIcon: '🌦️',
        badgeText: 'Fecha frecuentemente lluviosa',
        levelLabel: 'Comportamiento habitual',
        title: `Jornada típicamente húmeda: ha llovido en ${rainyYearsCount} de los ${validCount} años observados`,
        description: `En esta fecha predominan las precipitaciones moderadas o lloviznas en el valle, con una temperatura media típica de ${fmtNum(meanTempAll, 1)} °C, sin que consten temporales destructivos.`,
        linkHtml: `<a href="#comparativas">Ver comparativa pluviométrica interanual →</a>`,
      };
    }

    return {
      boxClass: 'verdict-mild',
      badgeClass: 'badge-mild',
      badgeIcon: '🌤️',
      badgeText: 'Jornada apacible en el histórico',
      levelLabel: 'Comportamiento habitual',
      title: `Valores suaves y estables: un ${dayLabel} habitualmente tranquilo en el valle`,
      description: `Sin registros de temporales de viento, precipitaciones torrenciales ni picos de calor extremo entre 2022 y 2026. Temperatura media habitual de ${fmtNum(meanTempAll, 1)} °C y predominio de ambiente templado.`,
      linkHtml: `<a href="#comparativas">Ver comparativas entre años →</a>`,
    };
  }

  function renderOnThisDayWidget(idx, almanacs, recordsData = STATE.cache.records) {
    const wrap = document.getElementById('on-this-day-widget');
    if (!wrap) return;

    const now = new Date();
    const todayMonth = now.getMonth() + 1;
    const todayDay = now.getDate();

    if (!STATE.onThisDay) {
      STATE.onThisDay = { month: todayMonth, day: todayDay };
    }

    const maxDaysPerMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let { month, day } = STATE.onThisDay;
    if (month < 1 || month > 12) month = todayMonth;
    const maxDay = maxDaysPerMonth[month - 1];
    if (day < 1) day = 1;
    if (day > maxDay) day = maxDay;
    STATE.onThisDay = { month, day };

    const isToday = month === todayMonth && day === todayDay;
    const mmdd = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayLabel = `${day} de ${MONTH_NAMES_ES[month - 1].toLowerCase()}`;
    const years = [...idx.series_overview.years_available].sort((a, b) => a - b);
    const lastObsDate = idx.series_overview.last_observation_date || '2026-10-25';

    // Extraer registros diarios para cada año en la fecha MM-DD
    const yearEntries = years.map((y) => {
      const alm = almanacs[y];
      const ds = alm?.daily_series;
      const isoTarget = `${y}-${mmdd}`;
      const pos = ds ? ds.dates.indexOf(isoTarget) : -1;

      if (pos === -1 || ds.temp_mean[pos] === null || ds.temp_mean[pos] === undefined) {
        let missingReason = 'Sin registro disponible en esta fecha.';
        const isLeapYear = (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
        if (mmdd === '02-29' && !isLeapYear) {
          missingReason = `Año no bisiesto (febrero de ${y} tuvo 28 días).`;
        } else if (y === 2023 && month >= 9) {
          missingReason = 'Laguna instrumental documentada por parada de la estación (sep.–dic. 2023).';
        } else if (isoTarget > lastObsDate) {
          missingReason = `Fecha aún no alcanzada en el año en curso (cierre actual: ${fmtDateES(lastObsDate, false)}).`;
        }
        return { year: y, hasData: false, missingReason, isoDate: isoTarget };
      }

      const tmean = ds.temp_mean[pos];
      const tmax = ds.temp_max[pos];
      const tmin = ds.temp_min[pos];
      const tamp = ds.temp_amp[pos];
      const rain = ds.rain_daily[pos] ?? 0;
      const rainRate = ds.rain_rate[pos] ?? 0;
      const gust = ds.wind_gust[pos];
      const wdir = ds.wind_dir[pos];
      const hum = ds.humidity_mean[pos];
      const press = ds.pressure_rel[pos];

      // Clasificación sinóptica rápida del día
      let badgeText = '⛅ Seco y templado';
      let badgeClass = 'otd-badge-mild';
      if (rain >= 20) {
        badgeText = '🌧️ Lluvia abundante';
        badgeClass = 'otd-badge-heavy-rain';
      } else if (rain >= 2) {
        badgeText = '🌦️ Día lluvioso';
        badgeClass = 'otd-badge-rain';
      } else if (rain >= 0.2) {
        badgeText = '💧 Lluvia débil';
        badgeClass = 'otd-badge-light-rain';
      } else if (tmax >= 28) {
        badgeText = '🔥 Muy cálido / Surada';
        badgeClass = 'otd-badge-hot';
      } else if (tmin <= 0) {
        badgeText = '❄️ Helada nocturna';
        badgeClass = 'otd-badge-frost';
      } else if (gust >= 50) {
        badgeText = '💨 Racha fuerte';
        badgeClass = 'otd-badge-wind';
      } else if (tmax >= 23) {
        badgeText = '☀️ Cálido y seco';
        badgeClass = 'otd-badge-warm';
      } else if (tmean <= 8) {
        badgeText = '🧣 Frío y seco';
        badgeClass = 'otd-badge-cold';
      }

      return {
        year: y,
        hasData: true,
        isoDate: isoTarget,
        tmean,
        tmax,
        tmin,
        tamp,
        rain,
        rainRate,
        gust,
        sector: degToSector(wdir),
        hum,
        press,
        badgeText,
        badgeClass,
      };
    });

    const validEntries = yearEntries.filter((e) => e.hasData);
    const validCount = validEntries.length;

    // EVO-028: Evaluación algorítmica del veredicto del día
    const verdict = evaluateOnThisDayHeadline(month, day, dayLabel, validEntries, recordsData);

    // Estadísticas interanuales del día seleccionado
    const meanTempAll = validCount > 0
      ? validEntries.reduce((acc, e) => acc + e.tmean, 0) / validCount
      : null;

    let maxTempEntry = null;
    let minTempEntry = null;
    let maxRainEntry = null;
    let rainyYearsCount = 0;

    validEntries.forEach((e) => {
      if (!maxTempEntry || e.tmax > maxTempEntry.tmax) maxTempEntry = e;
      if (!minTempEntry || e.tmin < minTempEntry.tmin) minTempEntry = e;
      if (!maxRainEntry || e.rain > maxRainEntry.rain) maxRainEntry = e;
      if (e.rain >= 0.2) rainyYearsCount += 1;
    });

    const monthOptionsHtml = MONTH_NAMES_ES.map((mName, idxM) => {
      const mVal = idxM + 1;
      return `<option value="${mVal}" ${mVal === month ? 'selected' : ''}>${mName}</option>`;
    }).join('');

    const dayOptionsHtml = Array.from({ length: maxDay }, (_, idxD) => {
      const dVal = idxD + 1;
      return `<option value="${dVal}" ${dVal === day ? 'selected' : ''}>${dVal}</option>`;
    }).join('');

    const yearCardsHtml = yearEntries.map((e) => {
      if (!e.hasData) {
        return `
          <div class="otd-year-card otd-year-missing">
            <div class="otd-year-header">
              <a href="#almanaque/${e.year}" class="otd-year-num">${e.year}</a>
              <span class="otd-badge otd-badge-missing">Sin dato</span>
            </div>
            <p class="otd-missing-text">${escapeHtml(e.missingReason)}</p>
            <div class="otd-year-footer">
              <a href="#almanaque/${e.year}">Abrir almanaque ${e.year} →</a>
            </div>
          </div>
        `;
      }

      return `
        <div class="otd-year-card">
          <div class="otd-year-header">
            <a href="#almanaque/${e.year}" class="otd-year-num" title="Abrir almanaque de ${e.year}">${e.year}</a>
            <span class="otd-badge ${e.badgeClass}">${e.badgeText}</span>
          </div>
          <div class="otd-temp-hero">
            <div class="otd-temp-main">
              <span class="otd-temp-label">T. media</span>
              <strong class="otd-temp-val">${fmtNum(e.tmean, 1)} °C</strong>
            </div>
            <div class="otd-temp-ext">
              <span class="val-cold" title="Temperatura mínima">↓ ${fmtNum(e.tmin, 1)}°</span>
              <span class="val-heat" title="Temperatura máxima">↑ ${fmtNum(e.tmax, 1)}°</span>
            </div>
          </div>
          <dl class="otd-metrics-list">
            <div>
              <dt>Precipitación</dt>
              <dd class="${e.rain >= 0.2 ? 'val-rain' : ''}">${fmtNum(e.rain, 1)} mm</dd>
            </div>
            <div>
              <dt>Racha máx.</dt>
              <dd>${fmtNum(e.gust, 1)} km/h (${e.sector})</dd>
            </div>
            <div>
              <dt>Amplitud / Hum.</dt>
              <dd>Δ ${fmtNum(e.tamp, 1)} °C · ${fmtNum(e.hum, 0)}%</dd>
            </div>
            <div>
              <dt>Presión media</dt>
              <dd>${fmtNum(e.press, 1)} hPa</dd>
            </div>
          </dl>
          <div class="otd-year-footer">
            <a href="#almanaque/${e.year}">Ver almanaque ${e.year} →</a>
            <a href="#explorador/${e.isoDate}/${e.isoDate}" class="otd-exp-link" title="Consultar las observaciones de este día en el Explorador">🔍 Datos del día ↗</a>
          </div>
        </div>
      `;
    }).join('');

    wrap.innerHTML = `
      <div class="otd-panel">
        <div class="otd-header">
          <div>
            <div class="otd-kicker">
              <span>EFEMÉRIDE DIARIA INTERANUAL (2022–2026)</span>
              <span class="otd-status-pill ${isToday ? 'is-today' : ''}">
                ${isToday ? '📅 Efeméride de hoy' : '🔎 Fecha seleccionada'}
              </span>
            </div>
            <h2 id="sec-otd-title" class="section-title" style="margin-top:4px">
              Un día como hoy en MeteoRiotuerto: <span class="otd-highlight-date">${dayLabel}</span>
            </h2>
            <p class="section-subtitle">
              Comparativa directa de las condiciones registradas cada <strong>${dayLabel}</strong> en Barrio de Arriba.
              Puede consultar cualquier otra fecha del calendario mediante el selector.
            </p>
          </div>
          <div class="otd-controls" aria-label="Selector de fecha para consultar efeméride diaria">
            <button type="button" class="btn btn-sm" id="btn-otd-prev" title="Día anterior">← Día ant.</button>
            <div class="otd-select-group">
              <label for="sel-otd-day" class="sr-only">Día</label>
              <select id="sel-otd-day" class="otd-select" aria-label="Día del mes">${dayOptionsHtml}</select>
              <label for="sel-otd-month" class="sr-only">Mes</label>
              <select id="sel-otd-month" class="otd-select" aria-label="Mes del año">${monthOptionsHtml}</select>
            </div>
            <button type="button" class="btn btn-sm" id="btn-otd-next" title="Día siguiente">Día sig. →</button>
            <button type="button" class="btn btn-sm ${isToday ? '' : 'btn-primary'}" id="btn-otd-today" ${isToday ? 'disabled' : ''}>Hoy</button>
          </div>
        </div>

        <!-- Tarjeta cabecera con el veredicto y titular del día (EVO-028 y EVO-031) -->
        <div class="otd-verdict-box ${verdict.boxClass}">
          <div class="otd-verdict-header">
            <span class="otd-verdict-badge ${verdict.badgeClass}">
              <span>${verdict.badgeIcon}</span>
              <span>${verdict.badgeText}</span>
            </span>
            <span class="otd-verdict-level-tag">${verdict.levelLabel}</span>
          </div>
          <h3 class="otd-verdict-title">${verdict.title}</h3>
          <p class="otd-verdict-desc">${verdict.description}</p>
          <div class="otd-verdict-actions" style="display:flex; flex-wrap:wrap; gap:8px; margin-top:10px;">
            ${verdict.linkHtml ? `<span class="otd-verdict-link">${verdict.linkHtml}</span>` : ''}
            <a href="#explorador?from=2022-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}&to=2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}" class="btn btn-sm btn-subtle" title="Buscar registros de este día en la serie histórica en el Explorador">🔍 Explorar este día en la serie histórica ↗</a>
          </div>
        </div>

        <div class="otd-summary-strip">
          <div class="otd-sum-item">
            <span class="otd-sum-label">Promedio térmico del ${dayLabel}</span>
            <strong class="otd-sum-val">${meanTempAll !== null ? fmtNum(meanTempAll, 1) + ' °C' : '—'}</strong>
            <span class="otd-sum-meta">Media de ${validCount} de ${years.length} años con dato</span>
          </div>
          <div class="otd-sum-item">
            <span class="otd-sum-label">Techo térmico en esta fecha</span>
            <strong class="otd-sum-val val-heat">${maxTempEntry ? fmtNum(maxTempEntry.tmax, 1) + ' °C' : '—'}</strong>
            <span class="otd-sum-meta">${maxTempEntry ? `Registrado en ${maxTempEntry.year} (mín. ese día: ${fmtNum(maxTempEntry.tmin, 1)} °C)` : 'Sin datos'}</span>
          </div>
          <div class="otd-sum-item">
            <span class="otd-sum-label">Suelo térmico en esta fecha</span>
            <strong class="otd-sum-val val-cold">${minTempEntry ? fmtNum(minTempEntry.tmin, 1) + ' °C' : '—'}</strong>
            <span class="otd-sum-meta">${minTempEntry ? `Registrado en ${minTempEntry.year} (máx. ese día: ${fmtNum(minTempEntry.tmax, 1)} °C)` : 'Sin datos'}</span>
          </div>
          <div class="otd-sum-item">
            <span class="otd-sum-label">Frecuencia de lluvia el ${dayLabel}</span>
            <strong class="otd-sum-val val-rain">${validCount > 0 ? `${rainyYearsCount} de ${validCount} años` : '—'}</strong>
            <span class="otd-sum-meta">${maxRainEntry && maxRainEntry.rain > 0 ? `Máximo: ${fmtNum(maxRainEntry.rain, 1)} mm en ${maxRainEntry.year}` : 'Sin lluvia registrada en esta fecha'}</span>
          </div>
        </div>

        <div class="otd-years-grid">
          ${yearCardsHtml}
        </div>
      </div>
    `;

    // Eventos de cambio de fecha en el bloque «Un día como hoy»
    const shiftDay = (delta) => {
      // Usamos el año bisiesto 2024 como calendario canónico de 366 días
      const refDate = new Date(Date.UTC(2024, month - 1, day + delta));
      STATE.onThisDay = {
        month: refDate.getUTCMonth() + 1,
        day: refDate.getUTCDate(),
      };
      renderOnThisDayWidget(idx, almanacs, recordsData);
    };

    document.getElementById('btn-otd-prev')?.addEventListener('click', () => shiftDay(-1));
    document.getElementById('btn-otd-next')?.addEventListener('click', () => shiftDay(1));
    document.getElementById('btn-otd-today')?.addEventListener('click', () => {
      const current = new Date();
      STATE.onThisDay = { month: current.getMonth() + 1, day: current.getDate() };
      renderOnThisDayWidget(idx, almanacs, recordsData);
    });
    document.getElementById('sel-otd-month')?.addEventListener('change', (ev) => {
      const newMonth = parseInt(ev.target.value, 10);
      const maxD = maxDaysPerMonth[newMonth - 1];
      STATE.onThisDay = { month: newMonth, day: Math.min(day, maxD) };
      renderOnThisDayWidget(idx, almanacs, recordsData);
    });
    document.getElementById('sel-otd-day')?.addEventListener('change', (ev) => {
      const newDay = parseInt(ev.target.value, 10);
      STATE.onThisDay = { month, day: newDay };
      renderOnThisDayWidget(idx, almanacs, recordsData);
    });
  }

  function renderHomeCharts(comparisons) {
    if (!document.getElementById('chart-home-rain')) return;
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
  function getSeasonColor(sId) {
    switch (sId) {
      case 'winter': return '#0284c7';
      case 'spring': return '#10b981';
      case 'summer': return '#ea580c';
      case 'autumn': return '#d97706';
      default: return '#64748b';
    }
  }

  function renderAlmanacSeasonsHtml(alm) {
    const seasons = alm.seasons || [];
    if (!seasons.length) return '';

    const cardsHtml = seasons.map((s) => {
      const anomTStr = s.temp_anomaly !== null && s.temp_anomaly !== undefined ? fmtSignNum(s.temp_anomaly, 2, '°C') : '—';
      const anomRStr = s.rain_anomaly_pct !== null && s.rain_anomaly_pct !== undefined ? fmtSignNum(s.rain_anomaly_pct, 1, '%') : (s.is_provisional ? '<span class="badge badge-provisional">Prov.</span>' : '—');

      let keyIndHtml = '';
      if (s.season_id === 'winter') {
        keyIndHtml = `
          <div class="seasonal-indicator-row"><span>Días de helada (&le;0 °C):</span> <span class="seasonal-indicator-val">${s.frost_days} días</span></div>
          <div class="seasonal-indicator-row"><span>Demanda calefacción:</span> <span class="seasonal-indicator-val">${fmtNum(s.hdd_15_5, 1)} HDD</span></div>
          <div class="seasonal-indicator-row"><span>Lluvia máx. 24h:</span> <span class="seasonal-indicator-val">${fmtNum(s.max_daily_rain_mm, 1)} mm</span></div>
        `;
      } else if (s.season_id === 'spring') {
        keyIndHtml = `
          <div class="seasonal-indicator-row"><span>Crecimiento vegetal:</span> <span class="seasonal-indicator-val">${fmtNum(s.gdd_10_0, 1)} GDD</span></div>
          <div class="seasonal-indicator-row"><span>Días de lluvia (&ge;0,2 mm):</span> <span class="seasonal-indicator-val">${s.rain_days_02} días</span></div>
          <div class="seasonal-indicator-row"><span>Días cálidos (&ge;25 °C):</span> <span class="seasonal-indicator-val">${s.warm_days_25} días</span></div>
        `;
      } else if (s.season_id === 'summer') {
        keyIndHtml = `
          <div class="seasonal-indicator-row"><span>Días de calor (&ge;30 °C):</span> <span class="seasonal-indicator-val" style="color:var(--accent-heat)">${s.hot_days_30} días</span></div>
          <div class="seasonal-indicator-row"><span>Noches tropicales (&ge;20 °C):</span> <span class="seasonal-indicator-val">${s.tropical_nights} noches</span></div>
          <div class="seasonal-indicator-row"><span>Racha máx. viento:</span> <span class="seasonal-indicator-val">${fmtNum(s.wind_gust_max_kmh, 1)} km/h</span></div>
        `;
      } else {
        keyIndHtml = `
          <div class="seasonal-indicator-row"><span>Días Foehn (surada):</span> <span class="seasonal-indicator-val" style="color:var(--accent-heat)">${s.foehn_days} días</span></div>
          <div class="seasonal-indicator-row"><span>Lluvia abundante (&ge;10 mm):</span> <span class="seasonal-indicator-val">${s.rain_days_10} días</span></div>
          <div class="seasonal-indicator-row"><span>Lluvia máx. 24h:</span> <span class="seasonal-indicator-val">${fmtNum(s.max_daily_rain_mm, 1)} mm</span></div>
        `;
      }

      return `
        <div class="seasonal-card season-${s.season_id}">
          <div class="seasonal-card-header">
            <div class="seasonal-card-title-wrap">
              <span class="seasonal-card-icon">${s.season_icon}</span>
              <div>
                <h4 class="seasonal-card-name">${escapeHtml(s.season_name)}</h4>
                <div class="seasonal-card-months">${escapeHtml(s.months_label)}</div>
              </div>
            </div>
            <span class="seasonal-card-code">${s.season_code}</span>
          </div>

          <div class="seasonal-card-main-stats">
            <div class="seasonal-stat-item">
              <span class="seasonal-stat-lbl">T. Media</span>
              <span class="seasonal-stat-val">${fmtNum(s.temp_mean, 1)} °C</span>
              <span class="seasonal-stat-sub">Anom: ${anomTStr}</span>
            </div>
            <div class="seasonal-stat-item">
              <span class="seasonal-stat-lbl">Lluvia Total</span>
              <span class="seasonal-stat-val" style="color:var(--accent-rain)">${fmtNum(s.rain_total_mm, 1)} mm</span>
              <span class="seasonal-stat-sub">Anom: ${anomRStr}</span>
            </div>
          </div>

          <div class="seasonal-indicators-list">
            <div class="seasonal-indicator-row">
              <span>Extremos térmicos:</span>
              <span class="seasonal-indicator-val">${fmtNum(s.temp_max_abs, 1)} / ${fmtNum(s.temp_min_abs, 1)} °C</span>
            </div>
            ${keyIndHtml}
          </div>
          ${s.notes ? `<div style="font-size:0.75rem; color:var(--txt-muted); font-style:italic">${escapeHtml(s.notes)}</div>` : ''}
        </div>
      `;
    }).join('');

    return `
      <section class="section-block">
        <div class="section-header">
          <div>
            <h3 class="section-title">🍂 Balance por trimestres canónicos OMM (${alm.year})</h3>
            <p class="section-subtitle">
              Síntesis de las 4 estaciones climatológicas estándar: Invierno (DJF), Primavera (MAM), Verano (JJA) y Otoño (SON)
            </p>
          </div>
        </div>
        <div class="seasonal-cards-grid">
          ${cardsHtml}
        </div>
      </section>
    `;
  }

  function renderAlmanacExtremeEpisodesHtml(alm) {
    const ee = alm.extreme_episodes;
    if (!ee) return '';
    const counts = ee.counts || {};
    const maxDur = ee.max_durations || {};
    const episodes = ee.episodes || [];

    const chips = [
      {
        icon: '🔥',
        label: 'Olas de calor',
        count: counts.heatwaves || 0,
        sub: maxDur.heatwave_days ? `máx. ${maxDur.heatwave_days} d.` : 'ninguna'
      },
      {
        icon: '❄️',
        label: 'Olas de frío',
        count: counts.coldwaves || 0,
        sub: maxDur.coldwave_days ? `máx. ${maxDur.coldwave_days} d.` : 'ninguna'
      },
      {
        icon: '🌧️',
        label: 'Rachas lluvia (≥7 d.)',
        count: counts.wet_spells || 0,
        sub: maxDur.wet_spell_days ? `máx. ${maxDur.wet_spell_days} d.` : 'ninguna'
      },
      {
        icon: '☀️',
        label: 'Rachas secas (≥7 d.)',
        count: counts.dry_spells || 0,
        sub: maxDur.dry_spell_days ? `máx. ${maxDur.dry_spell_days} d.` : 'ninguna'
      },
      {
        icon: '💨',
        label: 'Suradas (≥2 d.)',
        count: counts.foehn_spells || 0,
        sub: maxDur.foehn_spell_days ? `máx. ${maxDur.foehn_spell_days} d.` : 'ninguna'
      }
    ];

    const chipsHtml = chips.map((c) => `
      <div class="almanac-episode-chip">
        <span>${c.icon}</span>
        <span><strong>${c.count}</strong> ${escapeHtml(c.label)}</span>
        <span style="font-size:0.75rem; color:var(--txt-muted); margin-left:2px">(${escapeHtml(c.sub)})</span>
      </div>
    `).join('');

    const recentItems = episodes.slice(0, 4).map((e) => `
      <li style="font-size:0.83rem; color:var(--txt-secondary); margin-bottom:4px">
        <span class="episode-badge episode-badge-${e.type}" style="padding:1px 6px; font-size:0.72rem; margin-right:5px">
          ${e.type_icon} ${escapeHtml(e.type_label)}
        </span>
        <strong>${fmtDateES(e.start_date, false)} al ${fmtDateES(e.end_date, false)}</strong> (${e.duration_days} días):
        <span>${escapeHtml(e.summary)}</span>
      </li>
    `).join('');

    return `
      <div class="almanac-episodes-box">
        <div class="almanac-episodes-header">
          <h4 class="almanac-episodes-title">⚡ Episodios climáticos extremos observados en ${alm.year}</h4>
          <a href="#records" class="btn btn-secondary" style="font-size:0.78rem; padding:4px 10px">
            Ver catálogo completo histórico →
          </a>
        </div>
        <div class="almanac-episodes-chips">
          ${chipsHtml}
        </div>
        ${recentItems ? `
          <ul style="margin: 12px 0 0 0; padding-left: 18px; list-style-type: disc">
            ${recentItems}
          </ul>
        ` : ''}
      </div>
    `;
  }

  function renderAlmanacWaterBalanceHtml(alm) {
    const wb = alm.stats?.water_balance;
    if (!wb) return '';

    const netVal = wb.water_balance_mm;
    const isSurplus = netVal >= 0;
    const netFormatted = `${isSurplus ? '+' : ''}${fmtNum(netVal, 1)} mm`;

    const totalDays = (wb.deficit_days || 0) + (wb.surplus_days || 0);
    const defPct = totalDays > 0 ? Math.round((wb.deficit_days / totalDays) * 100) : 0;
    const surPct = 100 - defPct;

    const summerDef = wb.summer_deficit_mm;
    const summerFmt = summerDef !== null && summerDef !== undefined ? `${summerDef > 0 ? '+' : ''}${fmtNum(summerDef, 1)} mm` : '—';

    return `
      <section class="section-block water-balance-section" aria-labelledby="wb-title-${alm.year}">
        <div class="section-header">
          <div>
            <div class="editorial-kicker">RÉGIMEN AGROCLIMÁTICO Y DEMANDA EVAPORATIVA</div>
            <h3 id="wb-title-${alm.year}" class="section-title">💧 Balance hídrico y Evapotranspiración de referencia (ET₀) · ${alm.year}</h3>
            <p class="section-subtitle">
              Demanda atmosférica según formulación FAO-56 Hargreaves-Samani (Lat. 43,341° N) y balance neto del suelo (P &minus; ET₀)
            </p>
          </div>
          <div>
            <span class="badge" style="background:var(--accent-forest-soft); color:var(--accent-forest); font-weight:700">
              FAO-56 Penman-Monteith / Hargreaves
            </span>
          </div>
        </div>

        <div class="water-balance-kpis-grid">
          <div class="wb-kpi-card wb-eto">
            <div class="wb-kpi-header">
              <span class="wb-kpi-title">Evapotranspiración ET₀</span>
              <span class="wb-kpi-icon">☀️</span>
            </div>
            <div class="wb-kpi-val neutral">${fmtNum(wb.eto_total_mm, 1)} mm</div>
            <div class="wb-kpi-sub">Demanda evaporativa de referencia acumulada anual</div>
          </div>

          <div class="wb-kpi-card ${isSurplus ? 'wb-surplus' : 'wb-deficit'}">
            <div class="wb-kpi-header">
              <span class="wb-kpi-title">Balance neto (P &minus; ET₀)</span>
              <span class="wb-kpi-icon">${isSurplus ? '💧' : '⚠️'}</span>
            </div>
            <div class="wb-kpi-val ${isSurplus ? 'surplus' : 'deficit'}">${netFormatted}</div>
            <div class="wb-kpi-sub">${isSurplus ? 'Superávit hídrico cantábrico para recarga del valle' : 'Déficit hídrico global acumulado'}</div>
          </div>

          <div class="wb-kpi-card wb-deficit">
            <div class="wb-kpi-header">
              <span class="wb-kpi-title">Balance estival (JJA)</span>
              <span class="wb-kpi-icon">🌾</span>
            </div>
            <div class="wb-kpi-val deficit">${summerFmt}</div>
            <div class="wb-kpi-sub">Déficit estival (Jun–Ago): estrés en praderas sobre sustrato kárstico</div>
          </div>

          <div class="wb-kpi-card wb-ratio">
            <div class="wb-kpi-header">
              <span class="wb-kpi-title">Días déficit vs recarga</span>
              <span class="wb-kpi-icon">⚖️</span>
            </div>
            <div class="wb-kpi-val" style="font-size:1.35rem">
              <span style="color:#ea580c">${wb.deficit_days} d.</span> / <span style="color:#059669">${wb.surplus_days} d.</span>
            </div>
            <div class="wb-days-bar-container">
              <div class="wb-days-bar" title="Días con P < ET₀ (${defPct}%) vs P ≥ ET₀ (${surPct}%)">
                <div class="wb-bar-deficit" style="width:${defPct}%"></div>
                <div class="wb-bar-surplus" style="width:${surPct}%"></div>
              </div>
              <div class="wb-days-legend">
                <span>Déficit (${defPct}%)</span>
                <span>Recarga (${surPct}%)</span>
              </div>
            </div>
          </div>

          <div class="wb-kpi-card wb-neutral">
            <div class="wb-kpi-header">
              <span class="wb-kpi-title">Meses extremos de balance</span>
              <span class="wb-kpi-icon">📊</span>
            </div>
            <div style="font-size:0.88rem; margin-top:4px">
              <div style="margin-bottom:6px">
                <span style="color:var(--txt-muted)">Mayor déficit:</span><br>
                <strong style="color:#ea580c">${escapeHtml(wb.driest_balance_month || '—')} (${fmtNum(wb.driest_balance_month_mm, 1)} mm)</strong>
              </div>
              <div>
                <span style="color:var(--txt-muted)">Mayor recarga:</span><br>
                <strong style="color:#059669">${escapeHtml(wb.wettest_balance_month || '—')} (+${fmtNum(wb.wettest_balance_month_mm, 1)} mm)</strong>
              </div>
            </div>
          </div>
        </div>

        <div class="chart-panel" style="margin-bottom:24px">
          <div class="chart-panel-header">
            <div>
              <h4 class="chart-panel-title">Distribución mensual: Precipitación vs Evapotranspiración ET₀ (${alm.year})</h4>
              <p class="chart-panel-subtitle">
                Aporte pluviométrico (barras azules) frente a la demanda evapotranspirativa de referencia (barras naranjas) y balance neto mensual P &minus; ET₀ (línea verde/roja)
              </p>
            </div>
          </div>
          <div class="chart-canvas-wrap" style="height:350px">
            <canvas id="chart-alm-waterbalance"></canvas>
          </div>
        </div>

        <div class="wb-assessment-callout">
          <h4>🌱 Interpretación agroclimática de Riotuerto</h4>
          <p>
            A pesar del marcado superávit anual (${netFormatted}) propio del clima oceánico hiperhúmedo de la comarca de Trasmiera,
            el valle de Riotuerto experimenta una acusada estacionalidad hídrica: en el trimestre estival (JJA) la evapotranspiración de referencia
            supera habitualmente a las precipitaciones estivales, agotando la reserva útil de los suelos someros desarrollados sobre el macizo calizo.
            Este contraste condiciona los ritmos del pastoreo, el agostamiento de praderas y la oscilación de caudales en las surgencias kársticas del Miera y Covadal.
          </p>
        </div>
      </section>
    `;
  }

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
    const dd = alm.stats.degree_days || { hdd_15_5: 0, cdd_21_0: 0, gdd_10_0: 0 };
    const cov = alm.coverage;
    const ed = alm.editorial || {};

    const validMonths = (alm.monthly || []).filter((m) => m.valid_days > 0);
    const maxHddMonthObj = validMonths.reduce((prev, curr) => (curr.hdd_15_5 || 0) > (prev?.hdd_15_5 || 0) ? curr : prev, null);
    const maxHddStr = maxHddMonthObj && maxHddMonthObj.hdd_15_5 > 0 ? `${maxHddMonthObj.name} (${fmtNum(maxHddMonthObj.hdd_15_5, 1)} HDD)` : '—';

    const maxCddMonthObj = validMonths.reduce((prev, curr) => (curr.cdd_21_0 || 0) > (prev?.cdd_21_0 || 0) ? curr : prev, null);
    const maxCddStr = maxCddMonthObj && maxCddMonthObj.cdd_21_0 > 0 ? `${maxCddMonthObj.name} (${fmtNum(maxCddMonthObj.cdd_21_0, 1)} CDD)` : 'Sin demanda apreciable';

    const maxGddMonthObj = validMonths.reduce((prev, curr) => (curr.gdd_10_0 || 0) > (prev?.gdd_10_0 || 0) ? curr : prev, null);
    const maxGddStr = maxGddMonthObj && maxGddMonthObj.gdd_10_0 > 0 ? `${maxGddMonthObj.name} (${fmtNum(maxGddMonthObj.gdd_10_0, 1)} GDD)` : '—';

    // EVO-007: Percentiles térmicos y bandas de confort
    const tp = alm.stats.thermal_percentiles || {
      temp_mean: { P05: 0, P10: 0, P25: 0, P50: 0, P75: 0, P90: 0, P95: 0 },
      temp_max: { P05: 0, P10: 0, P25: 0, P50: 0, P75: 0, P90: 0, P95: 0 },
      temp_min: { P05: 0, P10: 0, P25: 0, P50: 0, P75: 0, P90: 0, P95: 0 },
    };
    const tBands = alm.stats.thermal_comfort_bands || [];
    const comfortDays = tBands
      .filter((b) => b.key === 'comfort_mild' || b.key === 'pleasant_warm')
      .reduce((sum, b) => sum + b.days, 0);
    const comfortPct = tBands
      .filter((b) => b.key === 'comfort_mild' || b.key === 'pleasant_warm')
      .reduce((sum, b) => sum + b.pct, 0);

    const thermalBarHtml = tBands.map((b) => {
      const showPct = b.pct >= 5.5 ? `${fmtNum(b.pct, 1)}%` : '';
      return `<div class="thermal-bar-segment" style="width:${b.pct}%;background-color:${b.color}" title="${escapeHtml(b.name)} (${b.range}): ${b.days} días (${fmtNum(b.pct, 1)}%)">${showPct}</div>`;
    }).join('');

    const thermalCardsHtml = tBands.map((b) => `
      <div class="thermal-band-card" style="border-top-color:${b.color}">
        <div class="thermal-band-icon" aria-hidden="true">${b.icon}</div>
        <div class="thermal-band-body">
          <h4 class="thermal-band-name">${escapeHtml(b.name)}</h4>
          <span class="thermal-band-range">${escapeHtml(b.range)}</span>
          <div class="thermal-band-count">
            <strong>${b.days}</strong> <span class="unit">d</span>
            <span class="thermal-band-pct">(${fmtNum(b.pct, 1)}%)</span>
          </div>
        </div>
      </div>
    `).join('');

    const curIdx = yearsAvailable.indexOf(alm.year);
    const prevYear = curIdx > 0 ? yearsAvailable[curIdx - 1] : null;
    const nextYear = curIdx >= 0 && curIdx < yearsAvailable.length - 1 ? yearsAvailable[curIdx + 1] : null;
    const prevSum = prevYear ? (idx.years_summary || []).find((s) => s.year === prevYear) : null;
    const nextSum = nextYear ? (idx.years_summary || []).find((s) => s.year === nextYear) : null;

    const prevBtnHtml = prevYear
      ? `<a href="#almanaque/${prevYear}" class="year-step-btn" title="Ir al almanaque de ${prevYear} (Atajo: Alt + ←)" aria-label="Año anterior ${prevYear}">← ${prevYear}</a>`
      : `<span class="year-step-btn disabled" aria-disabled="true" title="Primer año disponible de la serie">← Inicio</span>`;

    const nextBtnHtml = nextYear
      ? `<a href="#almanaque/${nextYear}" class="year-step-btn" title="Ir al almanaque de ${nextYear} (Atajo: Alt + →)" aria-label="Año siguiente ${nextYear}">${nextYear === 2026 ? '2026 (Prov.)' : nextYear} →</a>`
      : `<span class="year-step-btn disabled" aria-disabled="true" title="Último año disponible de la serie">Actual →</span>`;

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
            <td class="num" colspan="14" style="text-align:center;color:var(--txt-muted)">Mes aún no observado o sin registros</td>
          </tr>
        `;
      }
      const incTag = m.valid_days < m.calendar_days
        ? ` <span title="${m.valid_days} de ${m.calendar_days} días observados" style="color:var(--accent-solar);font-size:0.75rem">(${m.valid_days}/${m.calendar_days} d)</span>`
        : '';
      return `
        <tr id="mes-${alm.year}-${String(m.month).padStart(2, '0')}" class="almanac-month-row">
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
          <td class="num">${fmtNum(m.foehn_days ?? 0, 0)}</td>
          <td class="num">${m.hdd_15_5 !== null && m.hdd_15_5 !== undefined ? fmtNum(m.hdd_15_5, 1) : '—'}</td>
          <td class="num">${m.cdd_21_0 !== null && m.cdd_21_0 !== undefined ? fmtNum(m.cdd_21_0, 1) : '—'}</td>
          <td class="num">${m.gdd_10_0 !== null && m.gdd_10_0 !== undefined ? fmtNum(m.gdd_10_0, 1) : '—'}</td>
          <td class="num">${fmtNum(m.humidity_mean, 1)}%</td>
        </tr>
      `;
    }).join('');

    const foehn = alm.foehn_analysis || {
      total_foehn_days: 0,
      wind_foehn_days: 0,
      thermal_foehn_days: 0,
      top_episodes: [],
      criteria_summary: '',
    };
    const foehnRowsHtml = (foehn.top_episodes || []).map((ep) => {
      const jumpStr = ep.jump_3h_c !== null && ep.jump_3h_c !== undefined
        ? `${fmtSignNum(ep.jump_3h_c, 1, '°C')} / ${fmtSignNum(ep.hum_drop_3h_pct, 0, '%')}`
        : '— (serie diaria)';
      return `
        <tr>
          <td><strong>${fmtDateES(ep.date, false)}</strong></td>
          <td><span class="badge" style="background:var(--accent-heat-soft);color:var(--accent-heat)">${escapeHtml(ep.subtype)}</span></td>
          <td class="num" style="color:var(--accent-heat)"><strong>${fmtNum(ep.temp_max, 1)} °C</strong></td>
          <td class="num">${fmtNum(ep.temp_min, 1)} °C</td>
          <td class="num">${fmtNum(ep.temp_amp, 1)} °C</td>
          <td class="num"><strong>${fmtNum(ep.humidity_min, 0)} %</strong></td>
          <td class="num"><strong>${fmtNum(ep.wind_gust, 1)} km/h</strong></td>
          <td class="num">${escapeHtml(ep.sector)} (${fmtNum(ep.wind_dir, 0)}°)</td>
          <td class="num mono">${jumpStr}</td>
        </tr>
      `;
    }).join('');

    container.innerHTML = `
      <!-- Cabecera exclusiva para edición impresa / PDF A4 (EVO-003) -->
      <header class="print-only-header" aria-hidden="true">
        <div>
          <div class="print-kicker">ARCHIVO CLIMATOLÓGICO MUNICIPAL · NOTARIO DEL CLIMA DE RIOTUERTO</div>
          <h1 class="print-title">MeteoRiotuerto — Almanaque meteorológico anual ${alm.year}</h1>
          <div class="print-sub">Estación automática (${escapeHtml(idx.station.hardware.station_model)}) · Barrio de Arriba, Riotuerto (Cantabria) · 43.341° N, 3.670° W · 115 m s. n. m.</div>
        </div>
        <div class="print-stamp">
          <div><strong>Año ${alm.year}</strong> (${alm.is_provisional ? 'Provisional' : 'Consolidado'})</div>
          <div>Cobertura: ${cov.valid_days}/${cov.observed_span_days} días (${fmtNum(cov.coverage_pct, 1)}%)</div>
        </div>
      </header>

      <!-- Selector de edición anual -->
      <div class="year-switcher-bar" role="navigation" aria-label="Selector de año del almanaque">
        <div>
          <span class="editorial-kicker" style="margin:0">EDICIÓN ANUAL DEL ALMANAQUE</span>
          <h2 id="almanaque-heading" class="section-title" style="margin:0">
            Almanaque meteorológico ${alm.year} · Barrio de Arriba, Riotuerto
          </h2>
        </div>
        <div class="year-pills">
          ${prevBtnHtml}
          <span class="year-pills-sep" aria-hidden="true"></span>
          ${pillsHtml}
          <span class="year-pills-sep" aria-hidden="true"></span>
          ${nextBtnHtml}
          <span class="year-pills-sep" aria-hidden="true"></span>
          <button type="button" id="btn-print-almanac-top" class="btn btn-print" title="Imprimir o guardar como informe PDF en formato A4">🖨️ Imprimir / PDF</button>
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
          <div class="calendar-event-legend" aria-label="Leyenda de acontecimientos">
            <span class="legend-item"><span class="legend-dot"></span> <strong>Punto rojo:</strong> día parte de un episodio catalogado</span>
            <span class="legend-item"><span class="legend-box"></span> <strong>Borde dorado:</strong> día pico de intensidad</span>
            <span class="legend-item"><em>(Pase el cursor por cualquier celda para ver el detalle y el badge del episodio)</em></span>
          </div>
        </div>

        <!-- Hietograma diario y rachas máximas -->
        <div class="charts-grid-2">
          <div class="chart-panel">
            <div class="chart-panel-header">
              <div>
                <h4 class="chart-panel-title">Precipitación diaria y curva de lluvia acumulada (${alm.year})</h4>
                <p class="chart-panel-subtitle">Hietograma diario (barras, mm) y progresión acumulada anual (línea continua, mm)</p>
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
                <h4 class="chart-panel-title">Rosa de los vientos (16 rumbos)</h4>
                <p class="chart-panel-subtitle" id="windrose-subtitle-${alm.year}">Rumbo predominante: <strong>${alm.wind_analysis?.predominant_sector || stW.predominant_sector}</strong> · Basado en ${fmtNum(alm.wind_analysis?.total_direction_observations || 0, 0)} observaciones (${alm.wind_analysis?.source_resolution || '30 min'})</p>
              </div>
              <div class="windrose-toggle-group" id="windrose-tools-${alm.year}">
                <button type="button" class="windrose-toggle-btn active" id="btn-windrose-polar-${alm.year}" title="Rosa náutica polar 360°">🧭 Circular</button>
                <button type="button" class="windrose-toggle-btn" id="btn-windrose-bar-${alm.year}" title="Histograma de frecuencias en barras">📊 Barras</button>
              </div>
            </div>

            <!-- EVO-033: Filtro interactivo estacional y mensual -->
            <div class="windrose-filter-bar">
              <div class="windrose-period-group" role="group" aria-label="Filtro temporal de la rosa de los vientos">
                <button type="button" class="btn-windrose-filter ${(!STATE.windRoseFilter || STATE.windRoseFilter === 'annual') ? 'active' : ''}" data-period="annual" data-year="${alm.year}">Anual</button>
                <button type="button" class="btn-windrose-filter ${STATE.windRoseFilter === 'winter' ? 'active' : ''}" data-period="winter" data-year="${alm.year}">❄️ Invierno</button>
                <button type="button" class="btn-windrose-filter ${STATE.windRoseFilter === 'spring' ? 'active' : ''}" data-period="spring" data-year="${alm.year}">🌱 Primavera</button>
                <button type="button" class="btn-windrose-filter ${STATE.windRoseFilter === 'summer' ? 'active' : ''}" data-period="summer" data-year="${alm.year}">☀️ Verano</button>
                <button type="button" class="btn-windrose-filter ${STATE.windRoseFilter === 'autumn' ? 'active' : ''}" data-period="autumn" data-year="${alm.year}">🍂 Otoño</button>
              </div>
              <div class="windrose-month-selector">
                <label for="sel-windrose-month-${alm.year}" class="windrose-month-label">Mes:</label>
                <select id="sel-windrose-month-${alm.year}" class="select-windrose-month" data-year="${alm.year}">
                  <option value="">Seleccionar mes...</option>
                  ${MONTH_NAMES_ES.map((mName, idx) => {
                    const mVal = String(idx + 1);
                    const isSel = String(STATE.windRoseFilter) === mVal;
                    return `<option value="${mVal}" ${isSel ? 'selected' : ''}>${mName}</option>`;
                  }).join('')}
                </select>
              </div>
            </div>

            <div class="chart-canvas-wrap tall">
              <canvas id="chart-alm-windrose"></canvas>
            </div>
            <div class="windrose-pattern-note" id="windrose-pattern-note-${alm.year}"></div>
            <div class="windrose-legend-bar">
              <span class="windrose-leg-item"><span class="windrose-dot dot-south"></span> <strong>Surada / Foehn</strong> (S, SSW, SW, SSE)</span>
              <span class="windrose-leg-item"><span class="windrose-dot dot-north"></span> <strong>Cantábrico</strong> (NW, WNW, N, NNW)</span>
              <span class="windrose-leg-item"><span class="windrose-dot dot-east"></span> <strong>Brisas este</strong> (NE, ENE, E, ESE)</span>
              <span class="windrose-leg-item"><span class="windrose-dot dot-other"></span> <strong>Otros cuadrantes</strong> (W, WSW)</span>
            </div>
          </div>

          <div class="chart-panel">
            <div class="chart-panel-header">
              <div>
                <h4 class="chart-panel-title">Clasificación de días según la escala de Beaufort</h4>
                <p class="chart-panel-subtitle">Distribución del viento medio diario en el fondo del valle del Covadal</p>
              </div>
            </div>
            <div class="chart-canvas-wrap tall">
              <canvas id="chart-alm-beaufort"></canvas>
            </div>
          </div>
        </div>
      </section>

      <!-- EVO-005: Análisis algorítmico de patrones compatibles con «suradas» y efecto Foehn -->
      <section class="section-block" aria-labelledby="sec-foehn-title">
        <div class="section-header">
          <div>
            <h3 id="sec-foehn-title" class="section-title">🔥 Patrones compatibles con episodios de «surada» y efecto Foehn (${alm.year})</h3>
            <p class="section-subtitle">
              El algoritmo identifica en los registros en superficie patrones termohigrométricos y eólicos compatibles con este fenómeno (umbral empírico de veleta 120°–245°, recalentamiento y caída brusca de humedad)
            </p>
          </div>
        </div>

        <div class="kpi-grid" style="margin-bottom:18px">
          <div class="kpi-card accent-heat">
            <div class="kpi-label">Días con patrón compatible (${alm.year})</div>
            <div class="kpi-value">${fmtNum(foehn.total_foehn_days, 0)} <span class="kpi-unit">días</span></div>
            <div class="kpi-meta">${foehn.wind_foehn_days} de perfil eólico (≥35 km/h) · ${foehn.thermal_foehn_days} de perfil térmico</div>
          </div>
          <div class="kpi-card accent-wind">
            <div class="kpi-label">Racha máxima en estos episodios</div>
            <div class="kpi-value">${foehn.max_gust_kmh !== null ? fmtNum(foehn.max_gust_kmh, 1) : '—'} <span class="kpi-unit">km/h</span></div>
            <div class="kpi-meta">${foehn.max_gust_date ? `Registrada el ${fmtDateES(foehn.max_gust_date)}` : 'Sin registros'}</div>
          </div>
          <div class="kpi-card accent-heat">
            <div class="kpi-label">Techo térmico en patrón Foehn</div>
            <div class="kpi-value">${foehn.max_temp_c !== null ? fmtNum(foehn.max_temp_c, 1) : '—'} <span class="kpi-unit">°C</span></div>
            <div class="kpi-meta">${foehn.max_temp_date ? `Alcanzado el ${fmtDateES(foehn.max_temp_date)}` : 'Sin registros'}</div>
          </div>
          <div class="kpi-card accent-solar">
            <div class="kpi-label">Mínimo de humedad en estos días</div>
            <div class="kpi-value">${foehn.min_humidity_pct !== null ? fmtNum(foehn.min_humidity_pct, 0) : '—'} <span class="kpi-unit">%</span></div>
            <div class="kpi-meta">${foehn.min_humidity_date ? `Resecamiento máximo el ${fmtDateES(foehn.min_humidity_date)}` : 'Sin registros'}</div>
          </div>
        </div>

        <div class="callout callout-info" style="margin-bottom:16px;font-size:0.86rem">
          <strong>Nota metodológica — Identificación de patrones compatibles:</strong>
          Dado que una estación meteorológica en superficie registra variables locales en un único punto del valle y no el campo barométrico sinóptico en altura, <strong>este algoritmo identifica patrones instrumentales compatibles con el fenómeno de «surada» / efecto Foehn</strong>. ${escapeHtml(foehn.criteria_summary || '')}
        </div>

        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Modalidad sinóptica</th>
                <th class="num">T. máx.</th>
                <th class="num">T. mín.</th>
                <th class="num">Amplitud (ΔT)</th>
                <th class="num">HR mín.</th>
                <th class="num">Racha máx.</th>
                <th class="num">Rumbo</th>
                <th class="num">Salto máx. 3 h (ΔT / ΔHR)</th>
              </tr>
            </thead>
            <tbody>
              ${foehnRowsHtml || '<tr><td colspan="9" style="text-align:center">No se detectaron episodios bajo este umbral.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>

      <!-- EVO-006: Grados día de calefacción, refrigeración y desarrollo agrícola -->
      <section class="section-block" aria-labelledby="sec-degree-days-title">
        <div class="section-header">
          <div>
            <h3 id="sec-degree-days-title" class="section-title">🌱 Grados día: Energía, confort en el hogar y ciclo agrícola (${alm.year})</h3>
            <p class="section-subtitle">
              Indicadores agroclimáticos y energéticos calculados día a día: cuantifican la demanda de calefacción doméstica, el confort estival y la energía térmica acumulada para praderas y huertas
            </p>
          </div>
        </div>

        <div class="degree-days-grid">
          <div class="degree-card accent-hdd">
            <div class="degree-card-header">
              <span class="degree-icon">🏠</span>
              <div>
                <h4 class="degree-title">Calefacción en el hogar (<abbr class="glossary-term" data-term="hdd">HDD</abbr>)</h4>
                <span class="degree-base">Base de confort térmico: 15,5 °C</span>
              </div>
            </div>
            <div class="degree-value">${fmtNum(dd.hdd_15_5, 1)} <span class="degree-unit">HDD</span></div>
            <div class="degree-meta">
              <div><strong>Mes de mayor demanda:</strong> ${maxHddStr}</div>
            </div>
            <p class="degree-desc">
              Cuantifica la necesidad real de calentar las viviendas. Cuando la temperatura media diaria en Riotuerto desciende de 15,5 °C, las edificaciones pierden calor hacia el exterior y precisan calefacción. Cada grado por debajo suma un grado día. Refleja de forma fidedigna el gasto en leña, pellets o combustible en los hogares del municipio.
            </p>
          </div>

          <div class="degree-card accent-cdd">
            <div class="degree-card-header">
              <span class="degree-icon">❄️</span>
              <div>
                <h4 class="degree-title">Demanda de refrigeración (<abbr class="glossary-term" data-term="cdd">CDD</abbr>)</h4>
                <span class="degree-base">Base de sobrecalentamiento: 21,0 °C</span>
              </div>
            </div>
            <div class="degree-value">${fmtNum(dd.cdd_21_0, 1)} <span class="degree-unit">CDD</span></div>
            <div class="degree-meta">
              <div><strong>Mes de mayor demanda:</strong> ${maxCddStr}</div>
            </div>
            <p class="degree-desc">
              Evalúa el sobrecalentamiento interior en verano. En el fondo de valle de Riotuerto, las casas disfrutan de refrigeración pasiva natural gracias al clima oceánico; cifras elevadas señalan tardes de bochorno o <abbr class="glossary-term" data-term="noche_tropical">noches tropicales</abbr> en las que abrir ventanas no basta para disipar el calor acumulado en las estancias.
            </p>
          </div>

          <div class="degree-card accent-gdd">
            <div class="degree-card-header">
              <span class="degree-icon">🌾</span>
              <div>
                <h4 class="degree-title">Desarrollo agrícola y praderas (<abbr class="glossary-term" data-term="gdd">GDD</abbr>)</h4>
                <span class="degree-base"><abbr class="glossary-term" data-term="cero_vegetativo">Cero vegetativo</abbr>: 10,0 °C</span>
              </div>
            </div>
            <div class="degree-value">${fmtNum(dd.gdd_10_0, 1)} <span class="degree-unit">GDD</span></div>
            <div class="degree-meta">
              <div><strong>Pico de actividad biológica:</strong> ${maxGddStr}</div>
            </div>
            <p class="degree-desc">
              Mide la energía térmica útil acumulada para el desarrollo vegetal. Por encima de 10 °C, el pasto de las praderas y los cultivos despiertan e impulsan su fotosíntesis. Permite a ganaderos y hortelanos seguir el ritmo de rebrote de la hierba, los cortes de forraje y las cosechas de huerta.
            </p>
          </div>
        </div>

        <!-- Enlace a la sección Riotuerto cotidiano (EVO-013) -->
        <div class="callout callout-info" style="margin-top:20px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px;">
          <div>
            <strong>🚜 Aplicación en la vida práctica de Riotuerto:</strong>
            Las recomendaciones cotidianas basadas en estos indicadores bioclimáticos (calefacción, huerta, siega, robots cortacésped y fenología de ${alm.year}) se encuentran agrupadas para todos los vecinos en la sección dedicada.
          </div>
          <a href="#cotidiano" class="btn btn-sm btn-primary" style="white-space:nowrap">Consultar Riotuerto cotidiano →</a>
        </div>
      </section>

      <!-- EVO-007: Matriz de percentiles térmicos y distribución de días por bandas de confort -->
      <section class="section-block" aria-labelledby="sec-thermal-bands-title">
        <div class="section-header">
          <div>
            <h3 id="sec-thermal-bands-title" class="section-title">📊 Estructura térmica, percentiles y bandas de confort (${alm.year})</h3>
            <p class="section-subtitle">
              Distribución de los ${cov.valid_days} días observados en categorías de confort según la temperatura máxima diaria y umbrales no paramétricos estándar
            </p>
          </div>
        </div>

        <!-- Barra apilada continua 100% -->
        <div class="thermal-bar-container">
          <div class="thermal-stacked-bar" role="progressbar" aria-label="Distribución térmica anual">
            ${thermalBarHtml}
          </div>
        </div>

        <!-- Tarjetas de las 6 bandas -->
        <div class="thermal-bands-grid">
          ${thermalCardsHtml}
        </div>

        <!-- Indicadores de percentiles y rango central -->
        <div class="kpi-grid">
          <div class="kpi-card accent-forest">
            <div class="kpi-label">Mediana anual (P50)</div>
            <div class="kpi-value">${fmtNum(tp.temp_mean.P50, 1)} <span class="kpi-unit">°C</span></div>
            <div class="kpi-meta">Media aritmética: ${fmtNum(stT.mean, 1)} °C · Insensible a valores atípicos</div>
          </div>
          <div class="kpi-card accent-solar">
            <div class="kpi-label">Rango central del 50 % (P25 – P75)</div>
            <div class="kpi-value">${fmtNum(tp.temp_mean.P25, 1)} <span class="kpi-unit">a</span> ${fmtNum(tp.temp_mean.P75, 1)} <span class="kpi-unit">°C</span></div>
            <div class="kpi-meta">Amplitud intercuartílica (IQR): ${fmtNum(tp.temp_mean.P75 - tp.temp_mean.P25, 1)} °C</div>
          </div>
          <div class="kpi-card accent-forest">
            <div class="kpi-label">Zona de confort (15 a 25 °C)</div>
            <div class="kpi-value">${comfortDays} <span class="kpi-unit">días</span></div>
            <div class="kpi-meta">${fmtNum(comfortPct, 1)} % del año en temperaturas óptimas</div>
          </div>
          <div class="kpi-card accent-heat">
            <div class="kpi-label">Extremos no paramétricos (P05 / P95)</div>
            <div class="kpi-value">${fmtNum(tp.temp_mean.P05, 1)} <span class="kpi-unit">/</span> ${fmtNum(tp.temp_mean.P95, 1)} <span class="kpi-unit">°C</span></div>
            <div class="kpi-meta">Solo el 5 % fue más frío que P05 o más cálido que P95</div>
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
            <button type="button" id="btn-print-almanac" class="btn btn-print">🖨️ Imprimir ficha / Guardar PDF</button>
            <button type="button" id="btn-dl-year-xlsx" class="btn btn-excel">📊 Descargar libro del año (${alm.year}.xlsx)</button>
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
                <tr><td>Grados día de calefacción (HDD 15,5 °C)</td><td class="num"><strong>${fmtNum(dd.hdd_15_5, 1)} HDD</strong></td><td>Demanda térmica · Pico: ${maxHddStr}</td></tr>
                <tr><td>Grados día de refrigeración (CDD 21,0 °C)</td><td class="num"><strong>${fmtNum(dd.cdd_21_0, 1)} CDD</strong></td><td>Estrés estival · Pico: ${maxCddStr}</td></tr>
                <tr><td>Grados día desarrollo agrícola (GDD 10,0 °C)</td><td class="num"><strong>${fmtNum(dd.gdd_10_0, 1)} GDD</strong></td><td>Energía biológica · Pico: ${maxGddStr}</td></tr>
                <tr><td>Mediana térmica del año (P50)</td><td class="num"><strong>${fmtNum(tp.temp_mean.P50, 1)} °C</strong></td><td>P25: ${fmtNum(tp.temp_mean.P25, 1)} °C · P75: ${fmtNum(tp.temp_mean.P75, 1)} °C</td></tr>
                <tr><td>Días en zona de confort (15 a 25 °C)</td><td class="num"><strong>${comfortDays} días</strong></td><td>${fmtNum(comfortPct, 1)} % de los días observados</td></tr>
                <tr><td>Extremos del 5 % (P05 / P95)</td><td class="num">${fmtNum(tp.temp_mean.P05, 1)} / ${fmtNum(tp.temp_mean.P95, 1)} °C</td><td>P10: ${fmtNum(tp.temp_mean.P10, 1)} °C · P90: ${fmtNum(tp.temp_mean.P90, 1)} °C</td></tr>
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
                <tr><td>Días con patrón compatible con «surada» / Foehn</td><td class="num"><strong>${foehn.total_foehn_days} días</strong></td><td>Perfil eólico: ${foehn.wind_foehn_days} d · Perfil térmico: ${foehn.thermal_foehn_days} d</td></tr>
                <tr><td>Humedad relativa media / mínima</td><td class="num">${fmtNum(stA.humidity_mean_pct, 1)} %</td><td>Mín.: ${fmtNum(stA.humidity_min_pct, 0)} % (${fmtDateShortMonth(stA.humidity_min_date)})</td></tr>
                <tr><td>Presión atmosférica máx. / mín.</td><td class="num">${fmtNum(stA.pressure_max_hpa, 1)} hPa</td><td>Mín.: ${fmtNum(stA.pressure_min_hpa, 1)} hPa (${fmtDateShortMonth(stA.pressure_min_date)})</td></tr>
                <tr><td>Radiación solar máx. / Horas sol est.</td><td class="num">${fmtNum(stA.solar_max_wm2 || stA.solar_max_raw_wm2, 1)} W/m²</td><td>${stA.estimated_sunshine_hours !== null ? `${fmtNum(stA.estimated_sunshine_hours, 1)} h (≥120 W/m²)` : 'Serie 30 min no disponible'}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- Desglose estacional en 4 trimestres canónicos OMM (EVO-019 / EVO-C) -->
      ${renderAlmanacSeasonsHtml(alm)}

      <!-- Balance hídrico del suelo y Evapotranspiración ET0 (EVO-022 / EVO-A) -->
      ${renderAlmanacWaterBalanceHtml(alm)}

      <!-- Catálogo de episodios climáticos extremos del año (EVO-020 / EVO-D) -->
      ${renderAlmanacExtremeEpisodesHtml(alm)}

      <!-- Desglose mensual en tabla -->
      <section class="section-block">
        <div class="section-header">
          <div>
            <h3 class="section-title">Resumen climatológico mensual (${alm.year})</h3>
            <p class="section-subtitle">Valores mensuales de temperatura, extremos absolutos, precipitación, rachas de viento y humedad</p>
          </div>
          <div>
            <button type="button" id="btn-export-monthly-xlsx" class="btn btn-excel">
              📊 Exportar resumen a Excel (.xlsx)
            </button>
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
                <th class="num">Días Foehn</th>
                <th class="num" title="Grados día de calefacción base 15,5 °C">HDD (15,5 °C)</th>
                <th class="num" title="Grados día de refrigeración base 21,0 °C">CDD (21 °C)</th>
                <th class="num" title="Grados día de desarrollo agrícola base 10,0 °C">GDD (10 °C)</th>
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
                <td class="num">${fmtNum(foehn.total_foehn_days, 0)}</td>
                <td class="num"><strong>${fmtNum(dd.hdd_15_5, 1)}</strong></td>
                <td class="num"><strong>${fmtNum(dd.cdd_21_0, 1)}</strong></td>
                <td class="num"><strong>${fmtNum(dd.gdd_10_0, 1)}</strong></td>
                <td class="num">${fmtNum(stA.humidity_mean_pct, 1)}%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <!-- Navegación inferior entre almanaques consecutivos (EVO-002) -->
      <nav class="almanac-pager" aria-label="Navegación entre ediciones anuales del almanaque">
        ${prevYear ? `
          <a href="#almanaque/${prevYear}" class="almanac-pager-card prev">
            <span class="pager-dir">← Edición anual anterior</span>
            <strong class="pager-title">Almanaque meteorológico ${prevYear}</strong>
            <span class="pager-meta">${escapeHtml(prevSum?.character || '')}${prevSum ? ` · ${fmtNum(prevSum.temp_mean, 1)} °C · ${fmtNum(prevSum.rain_total_mm, 1)} mm` : ''}</span>
          </a>
        ` : `
          <a href="#portada" class="almanac-pager-card prev">
            <span class="pager-dir">← Inicio de la serie consolidada</span>
            <strong class="pager-title">Portada del almanaque digital</strong>
            <span class="pager-meta">Síntesis general, récords y mapa de Riotuerto</span>
          </a>
        `}
        <a href="#comparativas" class="almanac-pager-card center">
          <span class="pager-dir">Perspectiva interanual</span>
          <strong class="pager-title">Comparar años (2022–2026)</strong>
          <span class="pager-meta">Curva espagueti de lluvia, anomalías y matrices</span>
        </a>
        ${nextYear ? `
          <a href="#almanaque/${nextYear}" class="almanac-pager-card next">
            <span class="pager-dir">Edición anual siguiente →</span>
            <strong class="pager-title">Almanaque meteorológico ${nextYear}${nextSum?.is_provisional ? ' (Avance)' : ''}</strong>
            <span class="pager-meta">${escapeHtml(nextSum?.character || '')}${nextSum ? ` · ${fmtNum(nextSum.temp_mean, 1)} °C · ${fmtNum(nextSum.rain_total_mm, 1)} mm` : ''}</span>
          </a>
        ` : `
          <a href="#explorador" class="almanac-pager-card next">
            <span class="pager-dir">Consulta avanzada →</span>
            <strong class="pager-title">Explorador de series históricas</strong>
            <span class="pager-meta">Filtrado diario por fechas, umbrales y descarga CSV</span>
          </a>
        `}
      </nav>
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
    document.getElementById('btn-export-monthly-xlsx')?.addEventListener('click', () => {
      exportAlmanacMonthlyToExcel(alm);
    });
    document.getElementById('btn-dl-year-xlsx')?.addEventListener('click', () => {
      exportAlmanacFullYearToExcel(alm);
    });
    document.getElementById('btn-dl-year-csv')?.addEventListener('click', () => {
      downloadYearDailyCSV(alm);
    });
    const triggerPrint = () => {
      const wasDark = STATE.theme === 'dark';
      if (wasDark) {
        STATE.theme = 'light';
        document.documentElement.setAttribute('data-theme', 'light');
        renderAlmanacCharts(alm);
      }
      setTimeout(() => {
        window.print();
        if (wasDark) {
          STATE.theme = 'dark';
          document.documentElement.setAttribute('data-theme', 'dark');
          renderAlmanacCharts(alm);
        }
      }, 180);
    };
    document.getElementById('btn-print-almanac-top')?.addEventListener('click', triggerPrint);
    document.getElementById('btn-print-almanac')?.addEventListener('click', triggerPrint);

    // Controles interactivos de la rosa de los vientos (EVO-017 y EVO-033)
    const btnPolar = document.getElementById(`btn-windrose-polar-${alm.year}`);
    const btnBar = document.getElementById(`btn-windrose-bar-${alm.year}`);
    if (btnPolar && btnBar) {
      if ((STATE.windRoseMode || 'polar') === 'bar') {
        btnBar.classList.add('active');
        btnPolar.classList.remove('active');
      } else {
        btnPolar.classList.add('active');
        btnBar.classList.remove('active');
      }
      btnPolar.addEventListener('click', () => {
        STATE.windRoseMode = 'polar';
        btnPolar.classList.add('active');
        btnBar.classList.remove('active');
        renderAlmanacWindRose(alm, 'polar', STATE.windRoseFilter || 'annual');
      });
      btnBar.addEventListener('click', () => {
        STATE.windRoseMode = 'bar';
        btnBar.classList.add('active');
        btnPolar.classList.remove('active');
        renderAlmanacWindRose(alm, 'bar', STATE.windRoseFilter || 'annual');
      });
    }

    // Filtros estacionales y mensuales de la rosa de los vientos (EVO-033)
    const filterBtns = document.querySelectorAll(`.btn-windrose-filter[data-year="${alm.year}"]`);
    const monthSelect = document.getElementById(`sel-windrose-month-${alm.year}`);

    filterBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const period = btn.getAttribute('data-period') || 'annual';
        STATE.windRoseFilter = period;
        filterBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        if (monthSelect) monthSelect.value = '';
        renderAlmanacWindRose(alm, STATE.windRoseMode || 'polar', period);
      });
    });

    if (monthSelect) {
      monthSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val) {
          STATE.windRoseFilter = val;
          filterBtns.forEach((b) => b.classList.remove('active'));
          renderAlmanacWindRose(alm, STATE.windRoseMode || 'polar', val);
        } else {
          STATE.windRoseFilter = 'annual';
          filterBtns.forEach((b) => {
            if (b.getAttribute('data-period') === 'annual') b.classList.add('active');
            else b.classList.remove('active');
          });
          renderAlmanacWindRose(alm, STATE.windRoseMode || 'polar', 'annual');
        }
      });
    }

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

    // EVO-031: Catálogo de episodios para marcar distintivos en días destacados
    const episodesList = (alm.extreme_episodes && alm.extreme_episodes.episodes) || [];

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

        const epForDay = episodesList.find((e) => e.start_date <= iso && iso <= e.end_date);
        const isPeak = epForDay && epForDay.peak_date === iso;
        let eventClasses = '';
        if (epForDay) {
          eventClasses = isPeak ? ' has-episode cal-peak-event' : ' has-episode';
        }

        const style = getCalendarCellStyle(val, mode);
        const disp = val === 0 && mode === 'rain' ? '0' : fmtNum(val, val >= 10 || val <= -1 ? 0 : 1);
        let tooltip = `${fmtDateES(iso, false)} · T.med: ${fmtNum(rec.tmean, 1)} °C (${fmtNum(rec.tmin, 1)} / ${fmtNum(rec.tmax, 1)} °C) · Lluvia: ${fmtNum(rec.rain, 1)} mm · Racha: ${fmtNum(rec.gust, 1)} km/h`;
        if (epForDay) {
          tooltip += ` · ⚡ [Episodio: ${epForDay.type_label} (${fmtNum(epForDay.peak_value, 1)} ${epForDay.peak_value_unit})]`;
        }
        bodyRows += `<td id="cal-cell-${iso}" class="cal-cell${eventClasses}" style="${style}" title="${escapeHtml(tooltip)}" data-date="${iso}">${disp}</td>`;
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

    // 3. Lluvia diaria y curva acumulada anual (EVO-001)
    const almRainDatasets = [
      {
        type: 'bar',
        label: 'Precipitación diaria (mm)',
        data: ds.rain_daily,
        backgroundColor: pal.rainBar,
        borderColor: pal.rain,
        borderWidth: 1,
        yAxisID: 'y',
        order: 2,
      },
    ];
    if (ds.rain_accum) {
      almRainDatasets.push({
        type: 'line',
        label: `Lluvia acumulada anual (${alm.year})`,
        data: ds.rain_accum,
        borderColor: '#0284c7',
        borderWidth: 2.5,
        pointRadius: 0,
        pointHoverRadius: 5,
        yAxisID: 'y1',
        order: 1,
      });
    }

    createChart('alm_dailyrain', 'chart-alm-dailyrain', {
      type: 'bar',
      data: {
        labels: shortDates,
        datasets: almRainDatasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: pal.text } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${fmtNum(ctx.parsed.y, 1)} mm`,
            },
          },
        },
        scales: {
          x: { ticks: { color: pal.text, maxTicksLimit: 12 }, grid: { color: pal.grid } },
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Lluvia diaria (mm)', color: pal.text },
            ticks: { color: pal.text },
            grid: { color: pal.grid },
          },
          y1: {
            position: 'right',
            beginAtZero: true,
            title: { display: true, text: 'Acumulado anual (mm)', color: pal.text },
            ticks: { color: pal.text },
            grid: { drawOnChartArea: false },
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

    // 5. Rosa de los vientos (16 sectores: modo polar circular náutico o histograma de barras con filtro estacional/mensual)
    renderAlmanacWindRose(alm, STATE.windRoseMode || 'polar', STATE.windRoseFilter || 'annual');

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

    // 7. Balance Hídrico Mensual: Lluvia vs ET0 vs Balance neto (EVO-022 / EVO-A)
    const wbEl = document.getElementById('chart-alm-waterbalance');
    if (wbEl && alm.stats?.water_balance) {
      createChart('alm_waterbalance', 'chart-alm-waterbalance', {
        type: 'bar',
        data: {
          labels: mLabels,
          datasets: [
            {
              type: 'bar',
              label: 'Precipitación mensual (mm)',
              data: alm.monthly.map((m) => m.rain_total),
              backgroundColor: 'rgba(37, 99, 235, 0.65)',
              borderColor: '#2563eb',
              borderWidth: 1.5,
              borderRadius: 4,
              order: 2,
              yAxisID: 'yRain',
            },
            {
              type: 'bar',
              label: 'Evapotranspiración ET₀ (mm)',
              data: alm.monthly.map((m) => m.eto_mm),
              backgroundColor: 'rgba(234, 88, 12, 0.65)',
              borderColor: '#ea580c',
              borderWidth: 1.5,
              borderRadius: 4,
              order: 2,
              yAxisID: 'yRain',
            },
            {
              type: 'line',
              label: 'Balance neto P - ET₀ (mm)',
              data: alm.monthly.map((m) => m.water_balance_mm),
              borderColor: '#059669',
              backgroundColor: '#059669',
              borderWidth: 2.5,
              pointRadius: 4.5,
              pointBackgroundColor: alm.monthly.map((m) => (m.water_balance_mm !== null && m.water_balance_mm < 0 ? '#dc2626' : '#059669')),
              pointBorderColor: '#ffffff',
              pointBorderWidth: 1.5,
              tension: 0.25,
              order: 1,
              yAxisID: 'yRain',
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { labels: { color: pal.text } },
            tooltip: {
              callbacks: {
                label: function (ctx) {
                  const val = ctx.parsed.y;
                  if (val === null || val === undefined) return '';
                  const prefix = ctx.dataset.label.includes('Balance') && val > 0 ? '+' : '';
                  return `${ctx.dataset.label}: ${prefix}${fmtNum(val, 1)} mm`;
                },
              },
            },
          },
          scales: {
            x: { ticks: { color: pal.text }, grid: { color: pal.grid } },
            yRain: {
              beginAtZero: false,
              title: { display: true, text: 'Milímetros (mm)', color: pal.text },
              ticks: { color: pal.text },
              grid: { color: pal.grid },
            },
          },
        },
      });
    }
  }

  const SECTOR_NAMES_ES = {
    N: 'Norte (Tramontana)',
    NNE: 'Nor-Nordeste',
    NE: 'Nordeste (Gris)',
    ENE: 'Este-Nordeste',
    E: 'Este (Levante)',
    ESE: 'Este-Sudeste',
    SE: 'Sudeste (Siroco)',
    SSE: 'Sur-Sudeste',
    S: 'Sur (Surada / Ábrego)',
    SSW: 'Sur-Sudoeste (Surada)',
    SW: 'Sudoeste (Vendaval / Foehn)',
    WSW: 'Oeste-Sudoeste',
    W: 'Oeste (Poniente)',
    WNW: 'Oeste-Noroeste',
    NW: 'Noroeste (Gallego / Galerna)',
    NNW: 'Nor-Noroeste',
  };

  function getWindSectorColor(sector, isDark, alpha = 0.78) {
    if (['S', 'SSW'].includes(sector)) return `rgba(234, 88, 12, ${alpha})`;
    if (['SW', 'SSE'].includes(sector)) return `rgba(249, 115, 22, ${alpha})`;
    if (['NW', 'NNW'].includes(sector)) return `rgba(2, 132, 199, ${alpha})`;
    if (['WNW', 'N'].includes(sector)) return `rgba(14, 165, 233, ${alpha})`;
    if (['NNE', 'NE'].includes(sector)) return `rgba(6, 182, 212, ${alpha})`;
    if (['ENE', 'E', 'ESE'].includes(sector)) return `rgba(20, 184, 166, ${alpha})`;
    return `rgba(99, 102, 241, ${alpha})`;
  }

  function getWindSectorBorder(sector) {
    if (['S', 'SSW', 'SW', 'SSE'].includes(sector)) return '#ea580c';
    if (['NW', 'NNW', 'WNW', 'N'].includes(sector)) return '#0284c7';
    if (['NNE', 'NE'].includes(sector)) return '#0891b2';
    if (['ENE', 'E', 'ESE'].includes(sector)) return '#0d9488';
    return '#4f46e5';
  }

  function renderAlmanacWindRose(alm, mode, period) {
    const chosenMode = mode || STATE.windRoseMode || 'polar';
    const chosenPeriod = period || STATE.windRoseFilter || 'annual';
    const pal = chartPalette();
    const isDark = STATE.theme === 'dark';

    // Determinar conjunto de datos según filtro (EVO-033)
    let rose = alm.wind_analysis?.rose_16 || [];
    let totalObs = alm.wind_analysis?.total_direction_observations || 0;
    let predSector = alm.wind_analysis?.predominant_sector || '—';
    let periodLabel = `Año completo ${alm.year}`;

    if (['winter', 'spring', 'summer', 'autumn'].includes(chosenPeriod)) {
      const seasonData = alm.wind_analysis?.seasons?.[chosenPeriod];
      if (seasonData) {
        rose = seasonData.rose_16 || [];
        totalObs = seasonData.total_obs || 0;
        predSector = seasonData.predominant_sector || '—';
      }
      const seasonNames = {
        winter: 'Invierno (DJF)',
        spring: 'Primavera (MAM)',
        summer: 'Verano (JJA)',
        autumn: 'Otoño (SON)',
      };
      periodLabel = `${seasonNames[chosenPeriod]} ${alm.year}`;
    } else if (chosenPeriod && chosenPeriod !== 'annual') {
      const mNum = String(Number(chosenPeriod));
      const monthData = alm.wind_analysis?.monthly?.[mNum];
      if (monthData) {
        rose = monthData.rose_16 || [];
        totalObs = monthData.total_obs || 0;
        predSector = monthData.predominant_sector || '—';
      }
      const mIdx = Number(chosenPeriod) - 1;
      periodLabel = `${MONTH_NAMES_ES[mIdx] || ('Mes ' + mNum)} de ${alm.year}`;
    }

    // Calcular pesos de cuadrantes para la nota sinóptica
    const southSectors = ['S', 'SSW', 'SW', 'SSE'];
    const northSectors = ['NW', 'NNW', 'WNW', 'N'];
    const eastSectors = ['NE', 'ENE', 'E', 'ESE'];

    let southPct = 0;
    let northPct = 0;
    let eastPct = 0;

    rose.forEach((r) => {
      const f = Number(r.frequency_pct) || 0;
      if (southSectors.includes(r.sector)) southPct += f;
      if (northSectors.includes(r.sector)) northPct += f;
      if (eastSectors.includes(r.sector)) eastPct += f;
    });

    southPct = Math.round(southPct * 10) / 10;
    northPct = Math.round(northPct * 10) / 10;
    eastPct = Math.round(eastPct * 10) / 10;

    // Actualizar subtítulo y nota sinóptica en el DOM
    const subEl = document.getElementById(`windrose-subtitle-${alm.year}`);
    if (subEl) {
      const predName = SECTOR_NAMES_ES[predSector] ? ` (${SECTOR_NAMES_ES[predSector]})` : '';
      subEl.innerHTML = `Período: <strong>${periodLabel}</strong> · Rumbo dominante: <strong>${predSector}</strong>${predName} · Basado en <strong>${fmtNum(totalObs, 0)}</strong> observaciones (${alm.wind_analysis?.source_resolution || '30 min'})`;
    }

    const noteEl = document.getElementById(`windrose-pattern-note-${alm.year}`);
    if (noteEl) {
      if (totalObs === 0) {
        noteEl.innerHTML = `<em>Sin registros anemométricos suficientes para este intervalo temporal en ${alm.year}.</em>`;
      } else {
        let patternDesc = '';
        if (southPct >= 35) {
          patternDesc = `Dominio marcado del cuadrante <strong>Sur / Foehn (${southPct}%)</strong>. Los vientos descendentes de la Cordillera Cantábrica canalizados por el valle generan calentamiento adiabático, desecación ambiental e intensas rachas características en Riotuerto.`;
        } else if (northPct >= 30) {
          patternDesc = `Predominio de advecciones marítimas del <strong>Cantábrico y Noroeste (${northPct}%)</strong>. Aportan aire oceánico húmedo, nubosidad orográfica estratiforme y un régimen térmico contenido.`;
        } else if (eastPct >= 25 && eastPct >= southPct && eastPct >= northPct) {
          patternDesc = `Prevalencia de <strong>brisas del Este / Nordeste (${eastPct}%)</strong>. Típicas de situaciones de estabilidad anticiclónica estival o régimen de brisas marinas de retorno.`;
        } else {
          patternDesc = `Régimen mixto de transición: <strong>${southPct}%</strong> componentes de Sur/Suroeste frente a <strong>${northPct}%</strong> de procedencia Cantábrico/Noroeste y <strong>${eastPct}%</strong> brisas del Este.`;
        }
        noteEl.innerHTML = `🧭 <strong>Análisis sinóptico local:</strong> ${patternDesc}`;
      }
    }

    if (chosenMode === 'polar') {
      createChart('alm_windrose', 'chart-alm-windrose', {
        type: 'polarArea',
        data: {
          labels: rose.map((r) => r.sector),
          datasets: [
            {
              label: 'Frecuencia relativa (%)',
              data: rose.map((r) => r.frequency_pct),
              backgroundColor: rose.map((r) => getWindSectorColor(r.sector, isDark, isDark ? 0.82 : 0.72)),
              borderColor: rose.map(() => (isDark ? 'rgba(15, 23, 42, 0.9)' : '#ffffff')),
              borderWidth: 1.5,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          startAngle: -11.25,
          animation: { duration: 500 },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: isDark ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.96)',
              titleColor: isDark ? '#f8fafc' : '#0f172a',
              bodyColor: isDark ? '#e2e8f0' : '#334155',
              borderColor: isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.12)',
              borderWidth: 1,
              padding: 11,
              callbacks: {
                title: (items) => {
                  const idx = items[0].dataIndex;
                  const r = rose[idx];
                  return `${r.sector} · ${SECTOR_NAMES_ES[r.sector] || r.sector}`;
                },
                label: (context) => {
                  const r = rose[context.dataIndex];
                  return [
                    ` Frecuencia: ${fmtNum(r.frequency_pct, 1)} % (${fmtNum(r.count, 0)} obs.)`,
                    ` Velocidad media: ${fmtNum(r.mean_speed_kmh, 1)} km/h`,
                    ` Racha máxima: ${fmtNum(r.max_gust_kmh, 1)} km/h`,
                  ];
                },
              },
            },
          },
          scales: {
            r: {
              startAngle: -11.25,
              grid: {
                circular: true,
                color: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.07)',
              },
              angleLines: {
                display: true,
                color: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.10)',
                lineWidth: 1,
              },
              ticks: {
                display: true,
                color: pal.muted,
                backdropColor: 'transparent',
                font: { size: 10 },
                callback: (val) => `${val}%`,
              },
              pointLabels: {
                display: true,
                centerPointLabels: true,
                font: {
                  size: 11,
                  weight: '600',
                },
                color: (ctx) => {
                  const label = ctx.label;
                  if (['S', 'SSW', 'SW', 'SSE'].includes(label)) return isDark ? '#fb923c' : '#c2410c';
                  if (['N', 'NW', 'NNW', 'WNW'].includes(label)) return isDark ? '#38bdf8' : '#0369a1';
                  return isDark ? '#e2e8f0' : '#334155';
                },
              },
            },
          },
        },
      });
    } else {
      createChart('alm_windrose', 'chart-alm-windrose', {
        type: 'bar',
        data: {
          labels: rose.map((r) => r.sector),
          datasets: [
            {
              label: 'Frecuencia relativa (%)',
              data: rose.map((r) => r.frequency_pct),
              backgroundColor: rose.map((r) => getWindSectorColor(r.sector, isDark, isDark ? 0.85 : 0.75)),
              borderColor: rose.map((r) => getWindSectorBorder(r.sector)),
              borderWidth: 1.2,
              borderRadius: 4,
            },
          ],
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: (items) => {
                  const r = rose[items[0].dataIndex];
                  return `${r.sector} · ${SECTOR_NAMES_ES[r.sector] || r.sector}`;
                },
                label: (context) => {
                  const r = rose[context.dataIndex];
                  return [
                    ` Frecuencia: ${fmtNum(r.frequency_pct, 1)} % (${fmtNum(r.count, 0)} obs.)`,
                    ` Velocidad media: ${fmtNum(r.mean_speed_kmh, 1)} km/h`,
                    ` Racha máxima: ${fmtNum(r.max_gust_kmh, 1)} km/h`,
                  ];
                },
              },
            },
          },
          scales: {
            x: {
              beginAtZero: true,
              title: { display: true, text: 'Frecuencia (%)', color: pal.text },
              ticks: { color: pal.text },
              grid: { color: pal.grid },
            },
            y: {
              ticks: {
                color: pal.text,
                font: {
                  weight: (ctx) => (['N', 'E', 'S', 'W'].includes(ctx.tick?.label) ? '700' : '500'),
                },
              },
              grid: { color: pal.grid },
            },
          },
        },
      });
    }
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
   * EXPORTACIÓN NATIVA A EXCEL (.XLSX) CON SHEETJS
   * ------------------------------------------------------------------------ */
  async function ensureXLSXLoaded() {
    if (window.XLSX && typeof window.XLSX.writeFile === 'function') {
      return window.XLSX;
    }
    return new Promise((resolve, reject) => {
      const existing = document.getElementById('script-xlsx-vendor');
      if (existing) {
        if (window.XLSX && typeof window.XLSX.writeFile === 'function') {
          return resolve(window.XLSX);
        }
        existing.addEventListener('load', () => resolve(window.XLSX));
        existing.addEventListener('error', () => reject(new Error('No se pudo cargar la librería XLSX')));
        return;
      }
      const s = document.createElement('script');
      s.id = 'script-xlsx-vendor';
      s.src = './src/js/vendor/xlsx.mini.min.js';
      s.defer = true;
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => {
        const sCdn = document.createElement('script');
        sCdn.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.mini.min.js';
        sCdn.onload = () => resolve(window.XLSX);
        sCdn.onerror = (e) => reject(new Error('Error al cargar la librería de exportación a Excel.'));
        document.head.appendChild(sCdn);
      };
      document.head.appendChild(s);
    });
  }

  async function exportWorkbookToXLSX(sheetsMap, defaultFilename) {
    try {
      const XLSX = await ensureXLSXLoaded();
      const wb = XLSX.utils.book_new();
      Object.entries(sheetsMap).forEach(([rawSheetName, sheetData]) => {
        const sheetName = rawSheetName.replace(/[:\\/?*\[\]]/g, '_').slice(0, 31);
        let ws;
        if (Array.isArray(sheetData) && Array.isArray(sheetData[0])) {
          ws = XLSX.utils.aoa_to_sheet(sheetData);
        } else {
          ws = XLSX.utils.json_to_sheet(sheetData);
        }
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      });
      XLSX.writeFile(wb, defaultFilename);
    } catch (err) {
      console.error('Error al exportar archivo Excel:', err);
      alert('No se pudo generar el archivo Excel: ' + (err.message || err));
    }
  }

  function exportAlmanacMonthlyToExcel(alm) {
    const stT = alm.stats.temperature;
    const stP = alm.stats.precipitation;
    const stW = alm.stats.wind;
    const stA = alm.stats.atmosphere_and_solar;
    const dd = alm.stats.degree_days || {};
    const foehn = alm.foehn_analysis || { total_foehn_days: 0 };

    const monthlyHeaders = [
      'Mes', 'Días válidos', 'Días mes', 'T. media (°C)', 'Media máx. (°C)', 'Media mín. (°C)',
      'T. máx. abs. (°C)', 'Fecha máx.', 'T. mín. abs. (°C)', 'Fecha mín.', 'Lluvia total (mm)',
      'Días lluvia ≥0,2 mm', 'Días lluvia ≥10 mm', 'Lluvia máx. 24h (mm)', 'Fecha máx. lluvia',
      'Viento medio (km/h)', 'Racha máx. (km/h)', 'Fecha racha', 'Días helada (≤0 °C)',
      'Días calor (≥30 °C)', 'Noches tropicales (≥20 °C)', 'Días Foehn / surada',
      'HDD Calefacción (15,5 °C)', 'CDD Refrigeración (21,0 °C)', 'GDD Agrícola (10,0 °C)',
      'Humedad media (%)', 'Presión media (hPa)'
    ];

    const monthlyRows = [monthlyHeaders];
    alm.monthly.forEach((m) => {
      monthlyRows.push([
        m.name, m.valid_days, m.calendar_days, m.temp_mean, m.temp_max_mean, m.temp_min_mean,
        m.temp_max_abs, m.temp_max_date, m.temp_min_abs, m.temp_min_date, m.rain_total,
        m.rain_days_02, m.rain_days_10, m.rain_max_day, m.rain_max_date,
        m.wind_speed_mean, m.wind_gust_max, m.wind_gust_date, m.frost_days,
        m.hot_days_30, m.tropical_nights, m.foehn_days ?? 0, m.hdd_15_5,
        m.cdd_21_0, m.gdd_10_0, m.humidity_mean, m.pressure_mean
      ]);
    });

    monthlyRows.push([
      `Anual / Total (${alm.year})`, alm.coverage.valid_days, alm.coverage.observed_span_days,
      stT.mean, stT.max_mean, stT.min_mean, stT.max_abs, stT.max_abs_date, stT.min_abs, stT.min_abs_date,
      stP.total_mm, stP.days_ge_02mm, stP.days_ge_30mm, stP.max_daily_mm, stP.max_daily_date,
      stW.mean_speed_kmh, stW.max_gust_kmh, stW.max_gust_date, stT.frost_days_le_0,
      stT.hot_days_ge_30, stT.tropical_nights_ge_20, foehn.total_foehn_days,
      dd.hdd_15_5, dd.cdd_21_0, dd.gdd_10_0, stA.humidity_mean_pct, stA.pressure_mean_hpa
    ]);

    const metadataRows = [
      ['Archivo climatológico local', 'MeteoRiotuerto — Notario del clima de Riotuerto'],
      ['Emplazamiento', 'Barrio de Arriba, Riotuerto (Cantabria, España)'],
      ['Coordenadas (WGS84) y cota', '43.341° N, 3.670° W · 115 m s. n. m.'],
      ['Año observado', alm.year],
      ['Estado del anuario', alm.is_provisional ? 'Provisional (año en curso)' : 'Anuario cerrado y consolidado'],
      ['Carácter sinóptico', alm.editorial?.character || ''],
      ['Titular editorial', alm.editorial?.headline || ''],
      ['Días observados válidos', alm.coverage.valid_days],
      ['Días transcurridos en periodo', alm.coverage.observed_span_days],
      ['Porcentaje de cobertura (%)', alm.coverage.coverage_pct],
      ['Temperatura media anual (°C)', stT.mean],
      ['Máxima absoluta anual (°C)', stT.max_abs],
      ['Fecha máxima absoluta', stT.max_abs_date],
      ['Mínima absoluta anual (°C)', stT.min_abs],
      ['Fecha mínima absoluta', stT.min_abs_date],
      ['Precipitación total anual (mm)', stP.total_mm],
      ['Días con lluvia apreciable (≥0,2 mm)', stP.days_ge_02mm],
      ['Precipitación máxima en 24 h (mm)', stP.max_daily_mm],
      ['Fecha máx. precipitación 24 h', stP.max_daily_date],
      ['Racha máxima de viento (km/h)', stW.max_gust_kmh],
      ['Fecha racha máxima', stW.max_gust_date],
      ['Días con patrón Foehn / surada', foehn.total_foehn_days],
      ['HDD Calefacción (base 15,5 °C)', dd.hdd_15_5],
      ['CDD Refrigeración (base 21,0 °C)', dd.cdd_21_0],
      ['GDD Crecimiento agrícola (base 10,0 °C)', dd.gdd_10_0],
      ['Fecha de generación del archivo', new Date().toISOString()]
    ];

    exportWorkbookToXLSX({
      [`Resumen_Mensual_${alm.year}`]: monthlyRows,
      [`Ficha_Anual_${alm.year}`]: metadataRows
    }, `meteoriotuerto_resumen_mensual_${alm.year}.xlsx`);
  }

  function exportAlmanacFullYearToExcel(alm) {
    const ds = alm.daily_series;
    const dailyHeaders = [
      'Fecha', 'T. media (°C)', 'T. máx. (°C)', 'T. mín. (°C)', 'Amplitud (°C)',
      'Lluvia diaria (mm)', 'Lluvia acumulada (mm)', 'Viento medio (km/h)', 'Racha máx. (km/h)',
      'Rumbo viento (°)', 'Sector', 'HDD Calefacción (15,5 °C)', 'CDD Refrigeración (21,0 °C)',
      'GDD Agrícola (10,0 °C)', 'Humedad media (%)', 'Presión relativa (hPa)',
      'Radiación máx. (W/m²)', 'Índice UV máx.'
    ];

    const dailyRows = [dailyHeaders];
    ds.dates.forEach((d, i) => {
      const tm = ds.temp_mean[i];
      const hdd = tm !== null && tm !== undefined ? Number(Math.max(0, 15.5 - tm).toFixed(1)) : null;
      const cdd = tm !== null && tm !== undefined ? Number(Math.max(0, tm - 21.0).toFixed(1)) : null;
      const gdd = tm !== null && tm !== undefined ? Number(Math.max(0, tm - 10.0).toFixed(1)) : null;

      dailyRows.push([
        d,
        ds.temp_mean[i],
        ds.temp_max[i],
        ds.temp_min[i],
        ds.temp_amp[i],
        ds.rain_daily[i],
        ds.rain_accum ? ds.rain_accum[i] : null,
        ds.wind_speed[i],
        ds.wind_gust[i],
        ds.wind_dir[i],
        ds.wind_dir[i] !== null && ds.wind_dir[i] !== undefined ? degToSector(ds.wind_dir[i]) : '',
        hdd,
        cdd,
        gdd,
        ds.humidity_mean[i],
        ds.pressure_rel[i],
        ds.solar_max[i],
        ds.uvi_max[i]
      ]);
    });

    const epHeaders = ['Fecha', 'Tipo', 'Título del episodio', 'Valor registrado', 'Descripción'];
    const epRows = [epHeaders];
    (alm.editorial?.episodes || []).forEach((ep) => {
      epRows.push([ep.date, ep.type, ep.title, ep.value, ep.description]);
    });

    const monthlyHeaders = [
      'Mes', 'Días válidos', 'Días mes', 'T. media (°C)', 'Media máx. (°C)', 'Media mín. (°C)',
      'T. máx. abs. (°C)', 'Fecha máx.', 'T. mín. abs. (°C)', 'Fecha mín.', 'Lluvia total (mm)',
      'Días lluvia ≥0,2 mm', 'Días lluvia ≥10 mm', 'Lluvia máx. 24h (mm)', 'Fecha máx. lluvia',
      'Viento medio (km/h)', 'Racha máx. (km/h)', 'Fecha racha', 'Días helada',
      'Días calor ≥30 °C', 'Noches tropicales', 'Días Foehn', 'HDD (15,5 °C)',
      'CDD (21,0 °C)', 'GDD (10,0 °C)', 'Humedad (%)', 'Presión (hPa)'
    ];
    const monthlyRows = [monthlyHeaders];
    alm.monthly.forEach((m) => {
      monthlyRows.push([
        m.name, m.valid_days, m.calendar_days, m.temp_mean, m.temp_max_mean, m.temp_min_mean,
        m.temp_max_abs, m.temp_max_date, m.temp_min_abs, m.temp_min_date, m.rain_total,
        m.rain_days_02, m.rain_days_10, m.rain_max_day, m.rain_max_date,
        m.wind_speed_mean, m.wind_gust_max, m.wind_gust_date, m.frost_days,
        m.hot_days_30, m.tropical_nights, m.foehn_days ?? 0, m.hdd_15_5,
        m.cdd_21_0, m.gdd_10_0, m.humidity_mean, m.pressure_mean
      ]);
    });

    exportWorkbookToXLSX({
      [`Serie_Diaria_${alm.year}`]: dailyRows,
      [`Resumen_Mensual_${alm.year}`]: monthlyRows,
      [`Episodios_${alm.year}`]: epRows
    }, `meteoriotuerto_libro_anual_${alm.year}.xlsx`);
  }

  function exportComparisonsSynopticToExcel(comp) {
    const headers = [
      'Año', 'Carácter sinóptico', 'T. media (°C)', 'Anomalía T. (°C)', 'Mediana P50 (°C)',
      'T. máx. abs. (°C)', 'T. mín. abs. (°C)', 'Días confort 15-25 °C', 'Confort (%)',
      'Lluvia total (mm)', 'Anomalía lluvia (mm)', 'Días lluvia ≥0,2 mm', 'Días lluvia ≥30 mm',
      'Días helada (≤0 °C)', 'Días calor (≥30 °C)', 'Noches tropicales (≥20 °C)', 'Días Foehn / surada',
      'HDD Calefacción (15,5 °C)', 'CDD Refrigeración (21,0 °C)', 'GDD Agrícola (10,0 °C)',
      'Racha máx. (km/h)', 'Días válidos', 'Cobertura (%)'
    ];
    const rows = [headers];
    comp.yearly_table.forEach((r) => {
      rows.push([
        r.year + (r.is_provisional ? ' (provisional)' : ''),
        r.character,
        r.temp_mean,
        r.anom_temp_c,
        r.temp_median,
        r.temp_max_abs,
        r.temp_min_abs,
        r.comfort_days_15_25,
        r.comfort_pct_15_25,
        r.rain_total_mm,
        r.anom_rain_mm,
        r.rain_days_02,
        r.rain_days_30,
        r.frost_days_le_0,
        r.hot_days_ge_30,
        r.tropical_nights_ge_20,
        r.foehn_days,
        r.hdd_15_5,
        r.cdd_21_0,
        r.gdd_10_0,
        r.wind_gust_max_kmh,
        r.valid_days,
        r.coverage_pct
      ]);
    });

    const ref = comp.reference_baseline;
    rows.push([
      `Referencia OMM local (${ref.years_included.join('–')})`,
      'Promedio climático del periodo cerrado de referencia',
      ref.mean_annual_temp_c,
      0,
      null,
      null,
      null,
      null,
      null,
      ref.mean_annual_rain_mm,
      0,
      ref.mean_annual_rain_days,
      null,
      null,
      null,
      null,
      null,
      ref.mean_annual_hdd_15_5,
      ref.mean_annual_cdd_21_0,
      ref.mean_annual_gdd_10_0,
      null,
      null,
      null
    ]);

    const matTHeaders = ['Año', ...MONTH_NAMES_ES];
    const matTRows = [matTHeaders];
    Object.entries(comp.monthly_matrices?.temp_mean || {}).forEach(([y, vals]) => {
      matTRows.push([y, ...vals]);
    });

    const matRHeaders = ['Año', ...MONTH_NAMES_ES];
    const matRRows = [matRHeaders];
    Object.entries(comp.monthly_matrices?.rain_total || {}).forEach(([y, vals]) => {
      matRRows.push([y, ...vals]);
    });

    exportWorkbookToXLSX({
      'Cuadro_Sinoptico_2022_2026': rows,
      'Matriz_Temperaturas_C': matTRows,
      'Matriz_Precipitacion_mm': matRRows
    }, 'meteoriotuerto_comparativas_sinopticas.xlsx');
  }

  function exportHeadToHeadScoreboardToExcel(profA, profB, mode) {
    const scoreboardHeaders = [
      'Indicador climatológico',
      `Periodo A (${profA.shortLabel})`,
      `Periodo B (${profB.shortLabel})`,
      'Diferencia (B − A)',
      'Unidad',
      'Fecha extremo Periodo A',
      'Fecha extremo Periodo B'
    ];

    const metricDefs = [
      { label: 'Temperatura media diaria', key: 'tempMean', unit: '°C', dec: 1 },
      { label: 'Mediana térmica diaria (P50)', key: 'tempMedian', unit: '°C', dec: 1 },
      { label: 'Media de las temperaturas máximas', key: 'tempMaxMean', unit: '°C', dec: 1 },
      { label: 'Media de las temperaturas mínimas', key: 'tempMinMean', unit: '°C', dec: 1 },
      { label: 'Amplitud térmica media diaria', key: 'tempAmpMean', unit: '°C', dec: 1 },
      { label: 'Temperatura máxima absoluta', key: 'tempMaxAbs', unit: '°C', dec: 1, dateKey: 'tempMaxDate' },
      { label: 'Temperatura mínima absoluta', key: 'tempMinAbs', unit: '°C', dec: 1, dateKey: 'tempMinDate' },
      { label: 'Días en confort térmico (15–25 °C)', key: 'comfortDays1525', unit: 'días', dec: 0 },
      { label: 'Días cálidos (≥25 °C)', key: 'warmDays25', unit: 'días', dec: 0 },
      { label: 'Días de calor intenso (≥30 °C)', key: 'hotDays30', unit: 'días', dec: 0 },
      { label: 'Días de helada (≤0 °C)', key: 'frostDays', unit: 'días', dec: 0 },
      { label: 'Noches tropicales (mín. ≥20 °C)', key: 'tropicalNights', unit: 'noches', dec: 0 },
      { label: 'Precipitación total acumulada', key: 'rainTotal', unit: 'mm', dec: 1 },
      { label: 'Días de lluvia apreciable (≥0,2 mm)', key: 'rainDays02', unit: 'días', dec: 0 },
      { label: profA.rainHeavyLabel, key: 'rainHeavyDays', unit: 'días', dec: 0 },
      { label: 'Precipitación máxima en 24 h', key: 'rainMaxDay', unit: 'mm', dec: 1, dateKey: 'rainMaxDate' },
      { label: 'Velocidad media del viento', key: 'windSpeedMean', unit: 'km/h', dec: 1 },
      { label: 'Racha máxima de viento', key: 'windGustMax', unit: 'km/h', dec: 1, dateKey: 'windGustDate' },
      { label: 'Días con patrón Foehn / surada', key: 'foehnDays', unit: 'días', dec: 0 },
      { label: 'Grados día de calefacción (HDD 15,5 °C)', key: 'hdd', unit: 'HDD', dec: 1 },
      { label: 'Grados día de refrigeración (CDD 21,0 °C)', key: 'cdd', unit: 'CDD', dec: 1 },
      { label: 'Grados día de crecimiento vegetal (GDD 10,0 °C)', key: 'gdd', unit: 'GDD', dec: 1 },
      { label: 'Humedad relativa media', key: 'humidityMean', unit: '%', dec: 1 },
      { label: 'Presión atmosférica media', key: 'pressureMean', unit: 'hPa', dec: 1 },
      { label: 'Días válidos observados', key: 'validDays', unit: 'días', dec: 0 }
    ];

    const rows = [scoreboardHeaders];
    metricDefs.forEach((mDef) => {
      const valA = profA[mDef.key];
      const valB = profB[mDef.key];
      const hasBoth = valA !== null && valA !== undefined && valB !== null && valB !== undefined;
      const diff = hasBoth ? Number((valB - valA).toFixed(mDef.dec)) : null;

      rows.push([
        mDef.label,
        valA,
        valB,
        diff,
        mDef.unit,
        mDef.dateKey ? profA[mDef.dateKey] || '' : '',
        mDef.dateKey ? profB[mDef.dateKey] || '' : ''
      ]);
    });

    const seriesHeaders = [
      mode === 'yearly' ? 'Mes' : 'Día del mes',
      `T. media ${profA.shortLabel} (°C)`,
      `T. media ${profB.shortLabel} (°C)`,
      `Lluvia ${profA.shortLabel} (mm)`,
      `Lluvia ${profB.shortLabel} (mm)`
    ];
    const seriesRows = [seriesHeaders];
    for (let i = 0; i < profA.seriesLabels.length; i += 1) {
      seriesRows.push([
        profA.seriesLabels[i],
        profA.seriesTemp[i],
        profB.seriesTemp[i],
        profA.seriesRain[i],
        profB.seriesRain[i]
      ]);
    }

    const safeA = profA.shortLabel.replace(/[\s\/:]/g, '_');
    const safeB = profB.shortLabel.replace(/[\s\/:]/g, '_');
    exportWorkbookToXLSX({
      'Scoreboard_H2H': rows,
      'Series_Superpuestas': seriesRows
    }, `meteoriotuerto_h2h_${safeA}_vs_${safeB}.xlsx`);
  }

  function exportExplorerSelectionToExcel(rows, dateFrom, dateTo) {
    const headers = [
      'Fecha', 'T. media (°C)', 'T. máx. (°C)', 'T. mín. (°C)', 'Amplitud (°C)',
      'Lluvia (mm)', 'Viento medio (km/h)', 'Racha máx. (km/h)', 'Humedad media (%)', 'Presión rel. (hPa)'
    ];
    const exportRows = [headers];
    rows.forEach((r) => {
      exportRows.push([
        r.date, r.temp_mean, r.temp_max, r.temp_min, r.temp_amp,
        r.rain_daily, r.wind_speed, r.wind_gust, r.humidity_mean, r.pressure_rel
      ]);
    });
    exportWorkbookToXLSX({
      'Seleccion_MeteoRiotuerto': exportRows
    }, `meteoriotuerto_seleccion_${dateFrom}_${dateTo}.xlsx`);
  }

  function exportAbsoluteRecordsToExcel(rec) {
    const absHeaders = ['Indicador', 'Valor numérico', 'Unidad', 'Fecha', 'Hora', 'Contexto / Efeméride'];
    const absRows = [absHeaders];
    Object.values(rec.absolute_records || {}).forEach((item) => {
      if (item && item.label) {
        absRows.push([item.label, item.value, item.unit, item.date, item.time || '', item.context || '']);
      }
    });

    const metaRows = [
      ['Archivo climatológico local', 'MeteoRiotuerto — Notario del clima de Riotuerto'],
      ['Emplazamiento', 'Barrio de Arriba, Riotuerto (Cantabria, España) · 43.341° N, 3.670° W, 115 m s. n. m.'],
      ['Periodo de referencia analizado', rec.period_covered],
      ['Días con observación validada', rec.total_observed_days],
      ['Aviso metodológico', rec.methodological_disclaimer],
      ['Fecha de exportación', new Date().toISOString()]
    ];

    exportWorkbookToXLSX({
      'Extremos_Absolutos': absRows,
      'Ficha_Metodologica': metaRows
    }, 'meteoriotuerto_extremos_absolutos.xlsx');
  }

  function exportRankingsToExcel(rec, activeKey) {
    const topKeys = [
      { key: 'top_hottest_days', name: 'Top10_Calidos', title: 'Top 10 días más cálidos (T. máx. absoluta)', valLabel: 'T. máx. extrema (°C)' },
      { key: 'top_coldest_days', name: 'Top10_Frios', title: 'Top 10 madrugadas más frías (T. mín. absoluta)', valLabel: 'T. mín. extrema (°C)' },
      { key: 'top_wettest_days', name: 'Top10_Lluviosos', title: 'Top 10 días más lluviosos (Precipitación en 24h)', valLabel: 'Lluvia 24h (mm)' },
      { key: 'top_windiest_days', name: 'Top10_Viento', title: 'Top 10 mayores rachas de viento (km/h)', valLabel: 'Racha máx. (km/h)' },
      { key: 'top_amplitude_days', name: 'Top10_Amplitud', title: 'Top 10 mayores amplitudes térmicas diarias', valLabel: 'Amplitud (ΔT, °C)' },
      { key: 'top_coldest_max_days', name: 'Top10_Invernales_Frios', title: 'Top 10 días invernales más fríos (T. máx. más baja)', valLabel: 'T. máx. fría (°C)' },
      { key: 'top_warmest_min_days', name: 'Top10_Noches_Calidas', title: 'Top 10 noches más cálidas (T. mín. más alta)', valLabel: 'T. mín. cálida (°C)' }
    ];

    // La categoría actualmente seleccionada por el usuario encabeza el libro (Hoja 1)
    const current = topKeys.find((k) => k.key === activeKey) || topKeys[0];
    const ordered = [current, ...topKeys.filter((k) => k.key !== current.key)];

    const sheets = {};
    ordered.forEach(({ key, name, valLabel }) => {
      const items = rec.rankings?.[key] || [];
      const rankHeaders = ['Posición', 'Fecha', 'Año', valLabel, 'T. máx. (°C)', 'T. mín. (°C)', 'T. media (°C)', 'Lluvia 24h (mm)', 'Racha máx. (km/h)'];
      const rankRows = [rankHeaders];
      items.forEach((it, idx) => {
        rankRows.push([
          idx + 1, it.date, it.year, it.value, it.temp_max, it.temp_min, it.temp_mean, it.rain_daily, it.wind_gust
        ]);
      });
      sheets[name] = rankRows;
    });

    const safeKey = (activeKey || 'rankings').replace(/[^a-zA-Z0-9_]/g, '_');
    exportWorkbookToXLSX(sheets, `meteoriotuerto_rankings_${safeKey}.xlsx`);
  }

  function exportMonthlyRecordsToExcel(rec) {
    const moHeaders = [
      'Mes', 'Techo térmico (°C)', 'Fecha techo térmico', 'Suelo térmico (°C)', 'Fecha suelo térmico',
      'Precipitación máx. 24h (mm)', 'Fecha máx. precipitación', 'Racha máx. viento (km/h)', 'Fecha racha máx.',
      'Año más lluvioso', 'Lluvia total récord (mm)', 'Año más seco', 'Lluvia total año seco (mm)',
      'Año más cálido', 'T. media año cálido (°C)', 'Año más frío', 'T. media año frío (°C)'
    ];
    const moRows = [moHeaders];
    (rec.monthly_records || []).forEach((m) => {
      moRows.push([
        m.name,
        m.temp_max_abs,
        m.temp_max_date,
        m.temp_min_abs,
        m.temp_min_date,
        m.max_daily_rain,
        m.max_daily_rain_date,
        m.max_wind_gust,
        m.max_wind_gust_date,
        m.wettest_edition ? m.wettest_edition.year : '',
        m.wettest_edition ? m.wettest_edition.rain_mm : null,
        m.driest_edition ? m.driest_edition.year : '',
        m.driest_edition ? m.driest_edition.rain_mm : null,
        m.warmest_edition ? m.warmest_edition.year : '',
        m.warmest_edition ? m.warmest_edition.temp_mean : null,
        m.coldest_edition ? m.coldest_edition.year : '',
        m.coldest_edition ? m.coldest_edition.temp_mean : null
      ]);
    });

    const metaRows = [
      ['Archivo climatológico local', 'MeteoRiotuerto — Notario del clima de Riotuerto'],
      ['Emplazamiento', 'Barrio de Arriba, Riotuerto (Cantabria, España) · 43.341° N, 3.670° W, 115 m s. n. m.'],
      ['Tabla', 'Efemérides y extremos por mes del calendario (Enero a Diciembre)'],
      ['Periodo observado', rec.period_covered],
      ['Fecha de exportación', new Date().toISOString()]
    ];

    exportWorkbookToXLSX({
      'Efemerides_Mensuales': moRows,
      'Ficha_Informativa': metaRows
    }, 'meteoriotuerto_efemerides_mensuales.xlsx');
  }

  function exportRecordsToExcel(rec) {
    exportRankingsToExcel(rec, STATE.recordsRankingKey);
  }

  function exportAuditQualityToExcel(almanacs, overview) {
    const headers = [
      'Año', 'Días válidos', 'Días posibles en periodo', 'Cobertura diaria (%)',
      'Registros 30 min limpios', 'Duplicados depurados', 'Filas diarias incrustadas depuradas',
      'Filas fuera de año depuradas', 'Glitches RF filtrados', 'Incidencias y notas técnicas'
    ];
    const rows = [headers];
    Object.keys(almanacs).sort().forEach((y) => {
      const alm = almanacs[y];
      const cov = alm.coverage;
      const m30 = cov.quality_audit?.intraday_meta || {};
      const notes = [];
      if (!cov.has_30min_series) {
        notes.push('Solo serie diaria consolidada en repositorio.');
      } else {
        if (m30.embedded_daily_removed > 0) notes.push(`Depuradas ${m30.embedded_daily_removed} filas diarias incrustadas.`);
        if (m30.duplicates_removed > 0) notes.push(`Eliminados ${m30.duplicates_removed} timestamps duplicados.`);
        if (m30.out_of_year_removed > 0) notes.push(`Excluidas ${m30.out_of_year_removed} filas fuera del año natural.`);
        if (m30.glitches_filtered && m30.glitches_filtered.length > 0) {
          notes.push(`Filtrado pico RF espurio (${m30.glitches_filtered.length}).`);
        }
      }
      if (cov.missing_days > 0) notes.push(`${cov.missing_days} días sin observación.`);
      if (alm.is_provisional) notes.push(`Año en curso hasta ${alm.last_observed_date}.`);

      rows.push([
        alm.year,
        cov.valid_days,
        cov.observed_span_days,
        cov.coverage_pct,
        cov.has_30min_series ? cov.clean_30min_records : null,
        m30.duplicates_removed || 0,
        m30.embedded_daily_removed || 0,
        m30.out_of_year_removed || 0,
        m30.glitches_filtered ? m30.glitches_filtered.length : 0,
        notes.join(' ') || 'Serie íntegra sin incidencias.'
      ]);
    });

    exportWorkbookToXLSX({
      'Auditoria_y_Calidad': rows
    }, 'meteoriotuerto_auditoria_calidad.xlsx');
  }

  function exportPhenologyCalendarToExcel(allAlmanacs) {
    const years = [2022, 2023, 2024, 2025, 2026];
    const phenoByYear = {};
    years.forEach((y) => {
      phenoByYear[y] = computePhenologicalCalendar(allAlmanacs[y]?.daily_series);
    });

    const headers = [
      'Labor o actividad cotidiana',
      'Criterio agroclimático',
      'Fecha media habitual',
      '2022',
      '2023',
      '2024',
      '2025',
      '2026 (Avance)'
    ];
    const rows = [headers];

    PHENOLOGY_EVENTS.forEach((ev) => {
      const r = [
        ev.name,
        ev.criteria,
        ev.typicalDate
      ];
      years.forEach((y) => {
        const val = phenoByYear[y]?.[ev.key];
        r.push(val ? fmtDateES(val, false) : (y === 2026 ? 'Pendiente' : '—'));
      });
      rows.push(r);
    });

    const metaHeaders = ['Clave', 'Información'];
    const metaRows = [
      metaHeaders,
      ['Título', 'Calendario histórico de labores cotidianas y fenología de Riotuerto (2022–2026)'],
      ['Estación', 'Barrio de Arriba (Riotuerto, Cantabria, 115 m s. n. m.)'],
      ['Periodo', '2022–2026 (5 años documentados)'],
      ['Metodología', 'Cálculo algorítmico continuo sobre series diarias: temperatura media, grados día (HDD/GDD), cero vegetativo (10 °C), precipitación y humedad relativa.'],
      ['Fecha de exportación', new Date().toISOString()]
    ];

    exportWorkbookToXLSX({
      'Calendario_Agroclimatico': rows,
      'Ficha_Metodologica': metaRows
    }, 'meteoriotuerto_calendario_agroclimatico_2022_2026.xlsx');
  }

  function exportSeasonalComparisonToExcel(seasonalComp) {
    if (!seasonalComp) return;
    const table = seasonalComp.table || [];
    const headers = [
      'Año', 'Estación', 'Código OMM', 'Meses canónicos', 'Días válidos', 'Días estación',
      'Estado', 'T. media (°C)', 'Anomalía T. (°C)', 'Media máx. (°C)', 'Media mín. (°C)',
      'T. máx. abs. (°C)', 'Fecha máx.', 'T. mín. abs. (°C)', 'Fecha mín.',
      'Lluvia total (mm)', 'Anomalía lluvia (mm)', 'Anomalía lluvia (%)', 'Días lluvia (≥0,2 mm)',
      'Días lluvia (≥10 mm)', 'Días lluvia (≥30 mm)', 'Lluvia máx. 24h (mm)', 'Fecha máx. lluvia',
      'Viento medio (km/h)', 'Racha máx. (km/h)', 'Fecha racha máx.',
      'Días helada (≤0 °C)', 'Días cálidos (≥25 °C)', 'Días calor (≥30 °C)',
      'Noches tropicales (≥20 °C)', 'Días Foehn (surada)',
      'HDD Calefacción (15,5 °C)', 'CDD Refrigeración (21,0 °C)', 'GDD Agrícola (10,0 °C)', 'Notas'
    ];
    const rows = [headers];
    table.forEach((r) => {
      rows.push([
        r.year, r.season_name, r.season_code, r.months_label, r.observed_days, r.expected_days,
        r.is_provisional ? 'Provisional' : 'Consolidada',
        r.temp_mean, r.temp_anomaly, r.temp_max_mean, r.temp_min_mean,
        r.temp_max_abs, r.temp_max_date, r.temp_min_abs, r.temp_min_date,
        r.rain_total_mm, r.rain_anomaly_mm, r.rain_anomaly_pct, r.rain_days_02,
        r.rain_days_10, r.rain_days_30, r.max_daily_rain_mm, r.max_daily_rain_date,
        r.wind_speed_mean_kmh, r.wind_gust_max_kmh, r.wind_gust_max_date,
        r.frost_days, r.warm_days_25, r.hot_days_30,
        r.tropical_nights, r.foehn_days,
        r.hdd_15_5, r.cdd_21_0, r.gdd_10_0, r.notes || ''
      ]);
    });

    const refHeaders = [
      'Estación', 'Código OMM', 'Meses canónicos', 'T. media ref. (°C)', 'Lluvia ref. (mm)',
      'Días lluvia ref.', 'Heladas ref.', 'Días ≥30 °C ref.', 'Foehn ref.', 'GDD ref.', 'HDD ref.'
    ];
    const refRows = [refHeaders];
    const base = seasonalComp.baseline_reference_2022_2025 || {};
    (seasonalComp.seasons_meta || []).forEach((sm) => {
      const b = base[sm.id] || {};
      refRows.push([
        sm.name, sm.code, sm.months_es, b.temp_mean, b.rain_total_mm, b.rain_days_02,
        b.frost_days, b.hot_days_30, b.foehn_days, b.gdd_10_0, b.hdd_15_5
      ]);
    });

    const metaRows = [
      ['Clave', 'Información'],
      ['Título', 'Climatología estacional canónica OMM (DJF, MAM, JJA, SON) de Riotuerto (2022–2026)'],
      ['Estación', 'Barrio de Arriba, Riotuerto (Cantabria, 115 m s. n. m.)'],
      ['Estándar climatológico', 'Trimestres canónicos de la Organización Meteorológica Mundial (OMM)'],
      ['Periodo de referencia interna', '2022–2025 (4 años naturales cerrados y consolidados)'],
      ['Fecha de exportación', new Date().toISOString()]
    ];

    exportWorkbookToXLSX({
      'Climatologia_Estacional': rows,
      'Normales_Referencia_2022_2025': refRows,
      'Metadatos': metaRows
    }, 'meteoriotuerto_climatologia_estacional_2022_2026.xlsx');
  }

  function exportExtremeEpisodesToExcel(extremeEpisodes) {
    if (!extremeEpisodes) return;
    const episodes = extremeEpisodes.episodes || [];
    const headers = [
      'ID Episodio', 'Tipo de episodio', 'Fecha inicio', 'Fecha fin', 'Duración (días)',
      'Año', 'Estado', 'Intensidad / Pico', 'Unidad pico', 'Fecha pico',
      'Lluvia total (mm)', 'Métrica media', 'Etiqueta métrica', 'T. media (°C)',
      'Indicador complementario', 'Etiqueta indicador', 'Descripción y resumen'
    ];
    const rows = [headers];
    episodes.forEach((e) => {
      rows.push([
        e.id,
        e.type_label,
        e.start_date,
        e.end_date,
        e.duration_days,
        e.year,
        e.is_provisional ? 'Provisional' : 'Consolidado',
        e.peak_value,
        e.peak_value_unit,
        e.peak_date,
        e.total_rain_mm !== undefined ? e.total_rain_mm : '',
        e.mean_primary !== undefined ? e.mean_primary : '',
        e.mean_primary_label || '',
        e.mean_temp !== undefined ? e.mean_temp : '',
        e.extra_count !== undefined ? e.extra_count : '',
        e.extra_label || '',
        e.summary || ''
      ]);
    });

    const critHeaders = ['Tipo de episodio', 'Icono', 'Criterio umbral de detección', 'Descripción climatológica'];
    const critRows = [critHeaders];
    const criteria = extremeEpisodes.criteria || {};
    Object.values(criteria).forEach((c) => {
      critRows.push([c.name, c.icon, c.threshold, c.description]);
    });

    const kpiHeaders = ['Hito extremo histórico', 'Tipo', 'Duración / Valor récord', 'Fechas'];
    const kpiRows = [kpiHeaders];
    const kpis = extremeEpisodes.summary_kpis || {};
    if (kpis.longest_heatwave) {
      kpiRows.push(['Ola de calor más prolongada', 'Ola de calor', `${kpis.longest_heatwave.duration_days} días (pico ${kpis.longest_heatwave.peak_value} °C)`, `${kpis.longest_heatwave.start_date} a ${kpis.longest_heatwave.end_date}`]);
    }
    if (kpis.hottest_heatwave) {
      kpiRows.push(['Ola de calor más tórrida', 'Ola de calor', `Pico ${kpis.hottest_heatwave.peak_value} °C (${kpis.hottest_heatwave.duration_days} días)`, `${kpis.hottest_heatwave.start_date} a ${kpis.hottest_heatwave.end_date}`]);
    }
    if (kpis.longest_coldwave) {
      kpiRows.push(['Ola de frío más prolongada', 'Ola de frío', `${kpis.longest_coldwave.duration_days} días (mín. ${kpis.longest_coldwave.peak_value} °C)`, `${kpis.longest_coldwave.start_date} a ${kpis.longest_coldwave.end_date}`]);
    }
    if (kpis.coldest_coldwave) {
      kpiRows.push(['Ola de frío más gélida', 'Ola de frío', `Mínima ${kpis.coldest_coldwave.peak_value} °C (${kpis.coldest_coldwave.duration_days} días)`, `${kpis.coldest_coldwave.start_date} a ${kpis.coldest_coldwave.end_date}`]);
    }
    if (kpis.longest_wet_spell) {
      kpiRows.push(['Racha de lluvia más prolongada', 'Racha de lluvia', `${kpis.longest_wet_spell.duration_days} días seguidos (${kpis.longest_wet_spell.total_rain_mm} mm)`, `${kpis.longest_wet_spell.start_date} a ${kpis.longest_wet_spell.end_date}`]);
    }
    if (kpis.most_copious_wet_spell) {
      kpiRows.push(['Racha de lluvia más copiosa', 'Racha de lluvia', `${kpis.most_copious_wet_spell.total_rain_mm} mm acumulados (${kpis.most_copious_wet_spell.duration_days} días)`, `${kpis.most_copious_wet_spell.start_date} a ${kpis.most_copious_wet_spell.end_date}`]);
    }
    if (kpis.longest_dry_spell) {
      kpiRows.push(['Racha seca más prolongada', 'Racha seca', `${kpis.longest_dry_spell.duration_days} días sin lluvia (<0,2 mm)`, `${kpis.longest_dry_spell.start_date} a ${kpis.longest_dry_spell.end_date}`]);
    }
    if (kpis.longest_foehn_spell) {
      kpiRows.push(['Surada / Foehn más persistente', 'Surada persistente', `${kpis.longest_foehn_spell.duration_days} días seguidos (racha ${kpis.longest_foehn_spell.peak_value} km/h)`, `${kpis.longest_foehn_spell.start_date} a ${kpis.longest_foehn_spell.end_date}`]);
    }

    const metaRows = [
      ['Clave', 'Información'],
      ['Título', 'Catálogo cronológico de episodios climáticos extremos de Riotuerto (2022–2026)'],
      ['Estación', 'Barrio de Arriba, Riotuerto (Cantabria, 115 m s. n. m.)'],
      ['Criterios de detección', 'Adaptación local de normas OMM / AEMET para Riotuerto'],
      ['Total de episodios catalogados', episodes.length],
      ['Fecha de exportación', new Date().toISOString()]
    ];

    exportWorkbookToXLSX({
      'Episodios_Extremos': rows,
      'Criterios_Deteccion': critRows,
      'Hitos_Historicos': kpiRows,
      'Metadatos': metaRows
    }, 'meteoriotuerto_catalogo_episodios_extremos_2022_2026.xlsx');
  }

  function exportWaterBalanceToExcel(comp) {
    if (!comp || !comp.water_balance_comparison) return;
    const wbc = comp.water_balance_comparison;
    const yearsData = wbc.years || {};

    const summaryHeaders = [
      'Año', 'Estado', 'Lluvia total (mm)', 'Evapotranspiración ET₀ (mm)',
      'Balance neto P - ET₀ (mm)', 'Balance estival JJA (mm)',
      'Días déficit (P < ET₀)', 'Días recarga (P ≥ ET₀)',
      'Mes mayor déficit', 'Déficit mes (mm)',
      'Mes mayor superávit', 'Superávit mes (mm)'
    ];
    const summaryRows = [summaryHeaders];
    Object.keys(yearsData).sort().forEach((y) => {
      const yd = yearsData[y];
      summaryRows.push([
        Number(y),
        y === '2026' ? 'Provisional' : 'Consolidado',
        yd.rain_total_mm,
        yd.eto_total_mm,
        yd.water_balance_mm,
        yd.summer_balance_mm,
        yd.deficit_days,
        yd.surplus_days,
        yd.driest_month,
        yd.driest_month_mm,
        yd.wettest_month,
        yd.wettest_month_mm
      ]);
    });
    summaryRows.push([
      'Media ref. (2022–2025)',
      'Referencia interna',
      comp.reference_baseline?.mean_annual_rain_mm,
      wbc.mean_annual_eto_mm,
      wbc.mean_annual_water_balance_mm,
      wbc.mean_summer_balance_mm,
      '—',
      '—',
      'Julio',
      -77.3,
      'Noviembre',
      240.6
    ]);

    const mHeaders = ['Año', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic', 'Total Anual (mm)'];
    const etoRows = [mHeaders];
    const etoMatrix = comp.monthly_matrices?.eto_total || {};
    Object.keys(etoMatrix).sort().forEach((y) => {
      const vals = etoMatrix[y] || [];
      const tot = yearsData[y]?.eto_total_mm;
      etoRows.push([Number(y), ...vals, tot]);
    });
    if (wbc.monthly_baseline_eto) {
      etoRows.push(['Media ref. (2022–2025)', ...wbc.monthly_baseline_eto, wbc.mean_annual_eto_mm]);
    }

    const wbRows = [mHeaders];
    const wbMatrix = comp.monthly_matrices?.water_balance || {};
    Object.keys(wbMatrix).sort().forEach((y) => {
      const vals = wbMatrix[y] || [];
      const tot = yearsData[y]?.water_balance_mm;
      wbRows.push([Number(y), ...vals, tot]);
    });
    if (wbc.monthly_baseline_water_balance) {
      wbRows.push(['Media ref. (2022–2025)', ...wbc.monthly_baseline_water_balance, wbc.mean_annual_water_balance_mm]);
    }

    const metaRows = [
      ['Clave', 'Información'],
      ['Título', 'Balance Hídrico del Suelo y Evapotranspiración de Referencia (ET0) de Riotuerto (2022–2026)'],
      ['Estación', 'Barrio de Arriba, Riotuerto (Cantabria, 115 m s. n. m.)'],
      ['Coordenadas', '43.341° N, 3.670° W (Cuenca del río Covadal / Miera)'],
      ['Metodología', wbc.methodology || 'FAO-56 Hargreaves-Samani (1985)'],
      ['Formulación ET0', 'ET0 = 0.0023 * Ra_eq * (Tmean + 17.8) * sqrt(Tmax - Tmin)'],
      ['Diagnóstico agroclimático', wbc.agroclimatic_assessment || ''],
      ['Periodo de referencia interna', '2022–2025 (4 años naturales cerrados y consolidados)'],
      ['Fecha de exportación', new Date().toISOString()]
    ];

    exportWorkbookToXLSX({
      'Resumen_Anual': summaryRows,
      'Matriz_Mensual_ET0': etoRows,
      'Matriz_Mensual_Balance': wbRows,
      'Metodologia_FAO56': metaRows
    }, 'meteoriotuerto_balance_hidrico_2022_2026.xlsx');
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
            <option value="foehn">Patrones compatibles con «surada» / efecto Foehn</option>
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
            <button type="button" id="btn-exp-xlsx" class="btn btn-excel">📊 Exportar a Excel (.xlsx)</button>
            <button type="button" id="btn-exp-csv" class="btn">⬇ Exportar (CSV)</button>
            <button type="button" id="btn-exp-json" class="btn">⬇ Exportar (JSON)</button>
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
          foehn_flag: ds.foehn_flag ? ds.foehn_flag[i] : 0,
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
        if (episodeFilter === 'foehn' && rec.foehn_flag !== 1) return;

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
    const btnXlsx = document.getElementById('btn-exp-xlsx');
    if (btnXlsx) {
      btnXlsx.onclick = () => {
        exportExplorerSelectionToExcel(rows, STATE.explorer.dateFrom, STATE.explorer.dateTo);
      };
    }

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

    const ee = rec.extreme_episodes || {};
    const kpis = ee.summary_kpis || {};
    const counts = ee.counts_by_type || {};
    const totalEpisodesCount = ee.total_episodes_count || 0;

    const kpiCards = [
      {
        kpiClass: 'kpi-heat',
        label: '🔥 Ola de calor récord',
        val: kpis.longest_heatwave ? `${kpis.longest_heatwave.duration_days} días` : '—',
        sub: kpis.longest_heatwave ? `Pico: ${fmtNum(kpis.longest_heatwave.peak_value, 1)} °C · ${fmtDateES(kpis.longest_heatwave.start_date, false)} al ${fmtDateES(kpis.longest_heatwave.end_date, false)}` : ''
      },
      {
        kpiClass: 'kpi-cold',
        label: '❄️ Ola de frío récord',
        val: kpis.longest_coldwave ? `${kpis.longest_coldwave.duration_days} días` : '—',
        sub: kpis.longest_coldwave ? `Mínima: ${fmtNum(kpis.longest_coldwave.peak_value, 1)} °C · ${fmtDateES(kpis.longest_coldwave.start_date, false)} al ${fmtDateES(kpis.longest_coldwave.end_date, false)}` : ''
      },
      {
        kpiClass: 'kpi-wet',
        label: '🌧️ Racha de lluvia récord',
        val: kpis.longest_wet_spell ? `${kpis.longest_wet_spell.duration_days} días` : '—',
        sub: kpis.longest_wet_spell ? `Total: ${fmtNum(kpis.longest_wet_spell.total_rain_mm, 1)} mm · ${fmtDateES(kpis.longest_wet_spell.start_date, false)} al ${fmtDateES(kpis.longest_wet_spell.end_date, false)}` : ''
      },
      {
        kpiClass: 'kpi-dry',
        label: '☀️ Racha seca récord',
        val: kpis.longest_dry_spell ? `${kpis.longest_dry_spell.duration_days} días` : '—',
        sub: kpis.longest_dry_spell ? `Sin lluvia apreciable (<0,2 mm) · ${fmtDateES(kpis.longest_dry_spell.start_date, false)} al ${fmtDateES(kpis.longest_dry_spell.end_date, false)}` : ''
      },
      {
        kpiClass: 'kpi-foehn',
        label: '💨 Surada más prolongada',
        val: kpis.longest_foehn_spell ? `${kpis.longest_foehn_spell.duration_days} días` : '—',
        sub: kpis.longest_foehn_spell ? `Racha: ${fmtNum(kpis.longest_foehn_spell.peak_value, 1)} km/h · ${fmtDateES(kpis.longest_foehn_spell.start_date, false)} al ${fmtDateES(kpis.longest_foehn_spell.end_date, false)}` : ''
      }
    ];

    const kpiCardsHtml = kpiCards.map((c) => `
      <div class="episode-kpi-card ${c.kpiClass}">
        <span class="episode-kpi-label">${c.label}</span>
        <div class="episode-kpi-val">${c.val}</div>
        <div class="episode-kpi-sub">${escapeHtml(c.sub)}</div>
      </div>
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
          <div>
            <button type="button" id="btn-export-abs-records-xlsx" class="btn btn-excel">
              📊 Exportar extremos absolutos a Excel (.xlsx)
            </button>
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
          <div class="table-header-actions">
            <button type="button" id="btn-export-rankings-xlsx" class="btn btn-excel" title="Exportar clasificación Top 10 a Excel">
              📊 Exportar ranking Top 10 a Excel (.xlsx)
            </button>
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
          <div>
            <button type="button" id="btn-export-records-monthly-xlsx" class="btn btn-excel">
              📊 Exportar efemérides mensuales a Excel (.xlsx)
            </button>
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

      <!-- EVO-020 (EVO-D): Catálogo cronológico de episodios climáticos extremos -->
      <section class="section-block extreme-episodes-section" id="extreme-episodes-section" aria-labelledby="episodes-heading">
        <div class="section-header">
          <div>
            <h3 id="episodes-heading" class="section-title">⚡ Catálogo cronológico de episodios climáticos extremos (2022–2026)</h3>
            <p class="section-subtitle">
              Detección algorítmica de olas de calor, olas de frío, rachas de lluvia persistente, periodos secos y suradas continuadas
            </p>
          </div>
          <div>
            <button type="button" id="btn-export-episodes-xlsx" class="btn btn-excel">
              📊 Exportar catálogo de episodios extremos a Excel (.xlsx)
            </button>
          </div>
        </div>

        <!-- Hitos récord del catálogo -->
        <div class="episodes-kpis-grid">
          ${kpiCardsHtml}
        </div>

        <!-- Controles de filtrado por categoría y por año -->
        <div class="episodes-controls-bar">
          <div class="episodes-tabs-bar" role="tablist" aria-label="Filtro de tipo de episodio extremo">
            <button type="button" class="episodes-filter-btn active" data-type="all">🌐 Todos (${totalEpisodesCount})</button>
            <button type="button" class="episodes-filter-btn" data-type="heatwave">🔥 Olas de calor (${counts.heatwave || 0})</button>
            <button type="button" class="episodes-filter-btn" data-type="coldwave">❄️ Olas de frío (${counts.coldwave || 0})</button>
            <button type="button" class="episodes-filter-btn" data-type="wet_spell">🌧️ Rachas de lluvia (${counts.wet_spell || 0})</button>
            <button type="button" class="episodes-filter-btn" data-type="dry_spell">☀️ Rachas secas (${counts.dry_spell || 0})</button>
            <button type="button" class="episodes-filter-btn" data-type="foehn_spell">💨 Suradas (${counts.foehn_spell || 0})</button>
          </div>
          <div style="display:flex; align-items:center; gap:8px">
            <label for="select-episodes-year" style="font-size:0.82rem; font-weight:600; color:var(--txt-secondary)">Filtrar año:</label>
            <select id="select-episodes-year" class="form-select" style="padding:5px 10px; font-size:0.82rem">
              <option value="all">Todos los años (2022–2026)</option>
              <option value="2022">2022</option>
              <option value="2023">2023</option>
              <option value="2024">2024</option>
              <option value="2025">2025</option>
              <option value="2026">2026 (En curso)</option>
            </select>
          </div>
        </div>

        <!-- Tabla detallada del catálogo -->
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Tipo de episodio</th>
                <th>Periodo (Inicio — Fin)</th>
                <th class="num">Duración</th>
                <th>Año</th>
                <th class="num">Intensidad máxima</th>
                <th>Fecha pico</th>
                <th class="num">Métrica media / total</th>
                <th>Indicador complementario</th>
                <th>Descripción y síntesis del episodio</th>
              </tr>
            </thead>
            <tbody id="episodes-table-body">
              <!-- Renderizado dinámicamente -->
            </tbody>
          </table>
        </div>
      </section>
    `;

    document.getElementById('btn-export-abs-records-xlsx')?.addEventListener('click', () => {
      exportAbsoluteRecordsToExcel(rec);
    });
    document.getElementById('btn-export-rankings-xlsx')?.addEventListener('click', () => {
      exportRankingsToExcel(rec, STATE.recordsRankingKey);
    });
    document.getElementById('btn-export-records-monthly-xlsx')?.addEventListener('click', () => {
      exportMonthlyRecordsToExcel(rec);
    });

    const sel = document.getElementById('select-ranking-cat');
    if (sel) {
      sel.value = STATE.recordsRankingKey;
      sel.addEventListener('change', (e) => {
        STATE.recordsRankingKey = e.target.value;
        renderRankingRows(rec);
      });
    }
    renderRankingRows(rec);
    initExtremeEpisodes(rec);
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
   * EVO-020 (EVO-D): Funciones auxiliares de episodios climáticos extremos
   * ------------------------------------------------------------------------ */
  function renderExtremeEpisodesTable(rec) {
    const ee = rec.extreme_episodes || {};
    const tbody = document.getElementById('episodes-table-body');
    if (!tbody) return;

    let list = ee.episodes || [];
    const filterType = STATE.episodes.filterType;
    const yearFilter = STATE.episodes.yearFilter;

    if (filterType && filterType !== 'all') {
      list = list.filter((e) => e.type === filterType);
    }
    if (yearFilter && yearFilter !== 'all') {
      list = list.filter((e) => String(e.year) === yearFilter);
    }

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:24px; color:var(--txt-muted)">No se han registrado episodios con los filtros seleccionados.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map((e) => {
      const monthPart = e.start_date ? e.start_date.split('-')[1] : null;
      const almMonthHref = monthPart ? `#almanaque/${e.year}/mes-${monthPart}` : `#almanaque/${e.year}`;
      const yearHtml = e.is_provisional
        ? `<a href="${almMonthHref}" title="Abrir mes de este episodio en el almanaque">${e.year}</a> <span class="badge badge-provisional" style="font-size:0.65rem">prov.</span>`
        : `<a href="${almMonthHref}" title="Abrir mes de este episodio en el almanaque"><strong>${e.year}</strong></a>`;

      let metricHtml = '';
      if (e.total_rain_mm !== undefined) {
        metricHtml = `<strong>${fmtNum(e.total_rain_mm, 1)} mm</strong> <small style="display:block; color:var(--txt-muted)">total acumulado</small>`;
      } else if (e.mean_primary !== undefined) {
        const u = e.peak_value_unit === 'km/h' ? 'km/h' : '°C';
        metricHtml = `<strong>${fmtNum(e.mean_primary, 1)} ${u}</strong> <small style="display:block; color:var(--txt-muted)">${escapeHtml(e.mean_primary_label || '')}</small>`;
      } else {
        metricHtml = '—';
      }

      let extraHtml = '';
      if (e.extra_count !== undefined && e.extra_count > 0) {
        extraHtml = `<strong>${e.extra_count}</strong> <small style="color:var(--txt-muted)">${escapeHtml(e.extra_label || '')}</small>`;
      } else {
        extraHtml = `<span style="color:var(--txt-muted)">—</span>`;
      }

      return `
        <tr id="episode-${e.id}" class="episode-table-row">
          <td>
            <span class="episode-badge episode-badge-${e.type}">
              ${e.type_icon} ${escapeHtml(e.type_label)}
            </span>
          </td>
          <td>
            <a href="#explorador/${e.start_date}/${e.end_date}" title="Consultar las observaciones diarias de este periodo en el Explorador" style="text-decoration:underline; text-underline-offset:2px">
              <strong>${fmtDateES(e.start_date, false)}</strong> al <strong>${fmtDateES(e.end_date, false)}</strong> 🔍
            </a>
          </td>
          <td class="num mono"><strong>${e.duration_days} días</strong></td>
          <td class="mono">${yearHtml}</td>
          <td class="num mono">
            <strong style="color:${e.type_color || 'var(--txt-primary)'}">${fmtNum(e.peak_value, 1)} ${escapeHtml(e.peak_value_unit || '')}</strong>
          </td>
          <td><small>${fmtDateES(e.peak_date, false)}</small></td>
          <td class="num mono">${metricHtml}</td>
          <td>${extraHtml}</td>
          <td><small style="line-height:1.35; display:block">${escapeHtml(e.summary)}</small></td>
        </tr>
      `;
    }).join('');
  }

  function initExtremeEpisodes(rec) {
    renderExtremeEpisodesTable(rec);

    const filterBtns = document.querySelectorAll('.episodes-filter-btn');
    filterBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        filterBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        STATE.episodes.filterType = btn.dataset.type || 'all';
        renderExtremeEpisodesTable(rec);
      });
    });

    const yearSelect = document.getElementById('select-episodes-year');
    if (yearSelect) {
      yearSelect.value = STATE.episodes.yearFilter;
      yearSelect.addEventListener('change', (e) => {
        STATE.episodes.yearFilter = e.target.value;
        renderExtremeEpisodesTable(rec);
      });
    }

    document.getElementById('btn-export-episodes-xlsx')?.addEventListener('click', () => {
      exportExtremeEpisodesToExcel(rec.extreme_episodes);
    });
  }

  /* ------------------------------------------------------------------------
   * VISTA 5: COMPARATIVAS ENTRE AÑOS
   * ------------------------------------------------------------------------ */
  async function renderComparativas() {
    const [comp, almanacs] = await Promise.all([
      ensureComparisonsLoaded(),
      ensureAllAlmanacsLoaded(),
    ]);
    const container = document.getElementById('view-comparativas');
    const ref = comp.reference_baseline;
    const rows = comp.yearly_table;

    // Cómputo del calendario fenológico multianual
    const compYears = [2022, 2023, 2024, 2025, 2026];
    const phenoByYear = {};
    compYears.forEach((y) => {
      phenoByYear[y] = computePhenologicalCalendar(almanacs[y]?.daily_series);
    });

    const phenoCompRowsHtml = PHENOLOGY_EVENTS.map((ev) => {
      const cellsHtml = compYears.map((y) => {
        const val = phenoByYear[y]?.[ev.key];
        if (val) {
          return `<td><span class="pheno-badge-date">${fmtDateES(val, false)}</span></td>`;
        }
        if (y === 2026) {
          return `<td><span class="pheno-badge-pending">Pendiente</span></td>`;
        }
        return `<td><span class="pheno-badge-pending">—</span></td>`;
      }).join('');

      return `
        <tr>
          <td>
            <strong>${ev.icon} ${escapeHtml(ev.name)}</strong>
            <span style="display:block; font-size:0.75rem; color:var(--txt-muted)">${escapeHtml(ev.subtitle)}</span>
          </td>
          <td style="font-size:0.82rem; color:var(--txt-secondary)">${escapeHtml(ev.criteria)}</td>
          ${cellsHtml}
          <td style="font-weight:700; color:var(--txt-primary)">${escapeHtml(ev.typicalDate)}</td>
        </tr>
      `;
    }).join('');

    const tableRowsHtml = rows.map((r) => `
      <tr>
        <td class="mono"><a href="#almanaque/${r.year}"><strong>${r.year}</strong></a> ${r.is_provisional ? '<span class="badge badge-provisional">Prov.</span>' : ''}</td>
        <td>${escapeHtml(r.character)}</td>
        <td class="num"><strong>${fmtNum(r.temp_mean, 1)} °C</strong></td>
        <td class="num">${r.is_provisional ? '—' : fmtSignNum(r.temp_anomaly_vs_series, 2, '°C')}</td>
        <td class="num">${fmtNum(r.temp_median, 1)} °C</td>
        <td class="num" style="color:var(--accent-heat)">${fmtNum(r.temp_max_abs, 1)} °C</td>
        <td class="num" style="color:var(--accent-cold)">${fmtNum(r.temp_min_abs, 1)} °C</td>
        <td class="num" style="color:var(--accent-forest)"><strong>${r.comfort_days_15_25}</strong> <small>(${fmtNum(r.comfort_pct_15_25, 1)}%)</small></td>
        <td class="num" style="color:var(--accent-rain)"><strong>${fmtNum(r.rain_total_mm, 1)} mm</strong></td>
        <td class="num">${r.is_provisional ? '—' : fmtSignNum(r.rain_anomaly_pct, 1, '%')}</td>
        <td class="num">${r.rain_days_02}</td>
        <td class="num">${r.rain_days_30}</td>
        <td class="num">${r.frost_days}</td>
        <td class="num">${r.hot_days_30}</td>
        <td class="num">${r.tropical_nights}</td>
        <td class="num"><strong>${r.foehn_days ?? '—'}</strong></td>
        <td class="num">${fmtNum(r.hdd_15_5, 1)}</td>
        <td class="num">${fmtNum(r.cdd_21_0, 1)}</td>
        <td class="num" style="color:var(--accent-forest)"><strong>${fmtNum(r.gdd_10_0, 1)}</strong></td>
        <td class="num">${fmtNum(r.wind_gust_max_kmh, 1)} km/h</td>
      </tr>
    `).join('');

    const wbc = comp.water_balance_comparison || {};
    const wbYears = wbc.years || {};
    const wbTableRowsHtml = Object.keys(wbYears).sort().map((y) => {
      const yd = wbYears[y];
      const isProv = y === '2026';
      const isSurplus = yd.water_balance_mm >= 0;
      return `
        <tr>
          <td class="mono">
            <a href="#almanaque/${y}"><strong>${y}</strong></a>
            ${isProv ? '<span class="badge badge-provisional">Prov.</span>' : ''}
          </td>
          <td class="num" style="color:var(--accent-rain)"><strong>${fmtNum(yd.rain_total_mm, 1)} mm</strong></td>
          <td class="num" style="color:#0284c7"><strong>${fmtNum(yd.eto_total_mm, 1)} mm</strong></td>
          <td class="num" style="color:${isSurplus ? '#059669' : '#ea580c'}"><strong>${isSurplus ? '+' : ''}${fmtNum(yd.water_balance_mm, 1)} mm</strong></td>
          <td class="num" style="color:#ea580c"><strong>${yd.summer_balance_mm > 0 ? '+' : ''}${fmtNum(yd.summer_balance_mm, 1)} mm</strong></td>
          <td class="num">${yd.deficit_days}</td>
          <td class="num">${yd.surplus_days}</td>
          <td>${escapeHtml(yd.driest_month || '—')} (${fmtNum(yd.driest_month_mm, 1)} mm)</td>
          <td>${escapeHtml(yd.wettest_month || '—')} (+${fmtNum(yd.wettest_month_mm, 1)} mm)</td>
        </tr>
      `;
    }).join('');

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

      <div class="callout callout-warning" style="margin-bottom:24px; border-left-width:5px; padding:18px 22px">
        <h4 style="font-size:1rem; font-weight:700; margin-bottom:8px; color:var(--txt-primary)">
          ⚖️ Alcance científico: Comparaciones anuales y representatividad climatológica
        </h4>
        <p style="margin-bottom:8px; line-height:1.55">
          Este archivo proporciona <strong>comparaciones anuales muy útiles</strong> para examinar el comportamiento y la variabilidad meteorológica reciente en Barrio de Arriba.
          Sin embargo, <strong>la serie todavía no permite establecer normales climatológicas estándar de 30 años ni atribuir tendencias climáticas sólidas con garantías estadísticas</strong>.
        </p>
        <p style="font-size:0.86rem; color:var(--txt-secondary); margin:0">
          Según los estándares de la Organización Meteorológica Mundial (OMM), la definición de normales climatológicas requiere un mínimo de 30 años de registros homogéneos. Las anomalías mostradas a continuación se calculan exclusivamente respecto al promedio de los años completos disponibles en este archivo local (2022–2025: <strong>${fmtNum(ref.mean_annual_temp_c, 2)} °C</strong> y <strong>${fmtNum(ref.mean_annual_rain_mm, 1)} mm/año</strong>), con fines divulgativos y de comparación entre ejercicios recientes.
        </p>
      </div>

      <!-- EVO-011: Comparador cara a cara (head-to-head) entre dos años o meses -->
      <section class="section-block h2h-section" id="h2h-comparator-container" aria-labelledby="h2h-heading"></section>

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

      <!-- Gráfico espagueti de precipitación acumulada interanual (EVO-001) -->
      <div class="chart-panel" style="margin-bottom:28px">
        <div class="chart-panel-header">
          <div>
            <h4 class="chart-panel-title">💧 Evolución interanual de la precipitación acumulada (curva espagueti)</h4>
            <p class="chart-panel-subtitle">Suma diaria acumulada (1 ene – 31 dic) de cada año y contraste con la curva media de referencia 2022–2025</p>
          </div>
        </div>
        <div class="chart-canvas-wrap" style="height:440px">
          <canvas id="chart-comp-cum-rain"></canvas>
        </div>
        <div class="cum-rain-kpis">
          <div class="cum-kpi-box">
            <span class="cum-kpi-label">Año en curso 2026 (al 25 oct)</span>
            <span class="cum-kpi-val" style="color:var(--accent-rain)">1.504,3 mm</span>
            <span class="cum-kpi-sub">Registro provisional en observación</span>
          </div>
          <div class="cum-kpi-box">
            <span class="cum-kpi-label">Media esperada a 25 oct</span>
            <span class="cum-kpi-val">1.370,8 mm</span>
            <span class="cum-kpi-sub">Promedio acumulado 2022–2025</span>
          </div>
          <div class="cum-kpi-box">
            <span class="cum-kpi-label">Superávit acumulado 2026</span>
            <span class="cum-kpi-val" style="color:#059669">+133,5 mm (+9,7 %)</span>
            <span class="cum-kpi-sub">Aportación hídrica sobre el promedio</span>
          </div>
          <div class="cum-kpi-box">
            <span class="cum-kpi-label">Año récord más lluvioso</span>
            <span class="cum-kpi-val" style="color:#2563eb">2023 (2.140,4 mm)</span>
            <span class="cum-kpi-sub">Máximo absoluto de la serie</span>
          </div>
        </div>
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

      <!-- Gráfico comparativo de Grados Día (EVO-006) -->
      <div class="chart-panel" style="margin-bottom:28px">
        <div class="chart-panel-header">
          <div>
            <h4 class="chart-panel-title">🌱 Grados día anuales comparados (Calefacción HDD, Refrigeración CDD y Crecimiento GDD)</h4>
            <p class="chart-panel-subtitle">
              Demanda de calefacción en viviendas (HDD base 15,5 °C), sobrecalentamiento estival (CDD base 21,0 °C) y acumulación de energía biológica para praderas y huertas (GDD base 10,0 °C)
            </p>
          </div>
        </div>
        <div class="chart-canvas-wrap" style="height:360px">
          <canvas id="chart-comp-degree-days"></canvas>
        </div>
      </div>

      <!-- Gráfico comparativo de distribución térmica por bandas (EVO-007) -->
      <div class="chart-panel" style="margin-bottom:28px">
        <div class="chart-panel-header">
          <div>
            <h4 class="chart-panel-title">🌡️ Reparto de días por bandas térmicas y de confort (2022–2026)</h4>
            <p class="chart-panel-subtitle">
              Distribución porcentual acumulada (100 %) de los días de cada año según la temperatura máxima diaria: frío riguroso, fresco, templado, agradable, cálido y calor intenso
            </p>
          </div>
        </div>
        <div class="chart-canvas-wrap" style="height:320px">
          <canvas id="chart-comp-thermal-distribution"></canvas>
        </div>
      </div>

      <!-- EVO-019 (EVO-C): Climatología estacional comparada (Trimestres canónicos OMM) -->
      <section class="section-block seasonal-section" id="seasonal-comparison-section" aria-labelledby="seasonal-heading">
        <div class="section-header">
          <div>
            <h3 id="seasonal-heading" class="section-title">🍂 Climatología estacional comparada (Trimestres canónicos DJF, MAM, JJA, SON)</h3>
            <p class="section-subtitle">
              Evolución interanual de los 4 trimestres climáticos canónicos de la Organización Meteorológica Mundial (OMM): Invierno (DJF), Primavera (MAM), Verano (JJA) y Otoño (SON)
            </p>
          </div>
          <div>
            <button type="button" id="btn-export-seasonal-xlsx" class="btn btn-excel">
              📊 Exportar climatología estacional a Excel (.xlsx)
            </button>
          </div>
        </div>

        <!-- Barra de pestañas de estaciones -->
        <div class="seasonal-tabs-bar" role="tablist" aria-label="Filtro de estación climatológica">
          <button type="button" class="seasonal-tab-btn active" data-season="all" id="btn-season-all">🌐 Todas las estaciones</button>
          <button type="button" class="seasonal-tab-btn" data-season="winter" id="btn-season-winter">❄️ Invierno (DJF)</button>
          <button type="button" class="seasonal-tab-btn" data-season="spring" id="btn-season-spring">🌸 Primavera (MAM)</button>
          <button type="button" class="seasonal-tab-btn" data-season="summer" id="btn-season-summer">☀️ Verano (JJA)</button>
          <button type="button" class="seasonal-tab-btn" data-season="autumn" id="btn-season-autumn">🍂 Otoño (SON)</button>
        </div>

        <!-- Panel del gráfico comparativo estacional -->
        <div class="chart-panel" style="margin-top:16px; margin-bottom:24px">
          <div class="chart-panel-header" style="flex-wrap:wrap; gap:10px">
            <div>
              <h4 class="chart-panel-title" id="seasonal-chart-title">Comparativa estacional de temperatura y precipitación</h4>
              <p class="chart-panel-subtitle" id="seasonal-chart-subtitle">Contraste interanual de trimestres canónicos frente al promedio histórico 2022–2025</p>
            </div>
            <div class="seasonal-metric-toggles" role="group" aria-label="Métrica estacional para el gráfico">
              <button type="button" class="seasonal-metric-btn active" data-metric="temp" id="btn-smetric-temp">🌡️ T. Media (°C)</button>
              <button type="button" class="seasonal-metric-btn" data-metric="rain" id="btn-smetric-rain">💧 Lluvia (mm)</button>
              <button type="button" class="seasonal-metric-btn" data-metric="extremes" id="btn-smetric-extremes">⚡ Heladas / Calor</button>
              <button type="button" class="seasonal-metric-btn" data-metric="foehn" id="btn-smetric-foehn">🔥 Días Foehn</button>
            </div>
          </div>
          <div class="chart-canvas-wrap" style="height:360px">
            <canvas id="chart-seasonal-comp"></canvas>
          </div>
        </div>

        <!-- Tabla analítica de todas las estaciones registradas -->
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Año</th>
                <th>Estación</th>
                <th class="num">OMM</th>
                <th>Meses</th>
                <th class="num">Días</th>
                <th class="num">T. media</th>
                <th class="num">Anom. T.</th>
                <th class="num">T. máx. abs.</th>
                <th class="num">T. mín. abs.</th>
                <th class="num">Lluvia trimestral</th>
                <th class="num">Anom. lluvia</th>
                <th class="num">Días ≥0,2 mm</th>
                <th class="num">Heladas</th>
                <th class="num">Días ≥30 °C</th>
                <th class="num">Noches trop.</th>
                <th class="num">Días Foehn</th>
                <th class="num">GDD (10 °C)</th>
                <th class="num">HDD (15,5 °C)</th>
                <th class="num">Racha máx.</th>
              </tr>
            </thead>
            <tbody id="seasonal-table-body">
              <!-- Renderizado dinámicamente -->
            </tbody>
          </table>
        </div>

        <!-- Fichas de hitos estacionales históricos de Riotuerto -->
        <div class="seasonal-highlights-grid">
          <div class="seasonal-highlight-card" style="border-top: 3px solid #ea580c">
            <div class="seasonal-highlight-card-top">
              <span class="seasonal-highlight-badge" style="background:#ffedd5; color:#c2410c">☀️ Verano récord</span>
              <span style="font-size:1.2rem">🔥</span>
            </div>
            <div class="seasonal-highlight-val">2026 y 2024</div>
            <p class="seasonal-highlight-desc">
              El <strong>Verano 2026</strong> registró la media más cálida con <strong>20,6 °C</strong> (+1,3 °C sobre la referencia). En el <strong>Verano 2024</strong> se alcanzó la máxima absoluta histórica de Riotuerto con <strong>42,1 °C</strong> (11 de agosto).
            </p>
          </div>

          <div class="seasonal-highlight-card" style="border-top: 3px solid #d97706">
            <div class="seasonal-highlight-card-top">
              <span class="seasonal-highlight-badge" style="background:#fef3c7; color:#b45309">🍂 Otoño torrencial</span>
              <span style="font-size:1.2rem">🌧️</span>
            </div>
            <div class="seasonal-highlight-val">695,5 mm</div>
            <p class="seasonal-highlight-desc">
              El <strong>Otoño 2024</strong> lidera la precipitación otoñal con <strong>695,5 mm</strong>, seguido de cerca por el <strong>Otoño 2023</strong> (639,8 mm). Concentra además el mayor número de advecciones de viento sur otoñal (19 días con Surada en 2022).
            </p>
          </div>

          <div class="seasonal-highlight-card" style="border-top: 3px solid #0284c7">
            <div class="seasonal-highlight-card-top">
              <span class="seasonal-highlight-badge" style="background:#e0f2fe; color:#0369a1">❄️ Invierno frío / nivoso</span>
              <span style="font-size:1.2rem">⛄</span>
            </div>
            <div class="seasonal-highlight-val">781,6 mm / 17 d</div>
            <p class="seasonal-highlight-desc">
              El <strong>Invierno 2022/2023</strong> fue el más lluvioso con <strong>781,6 mm</strong> (+40,3 % de superávit). El <strong>Invierno 2022</strong> concentró 17 días de helada en solo 2 meses por persistentes inversiones térmicas.
            </p>
          </div>

          <div class="seasonal-highlight-card" style="border-top: 3px solid #10b981">
            <div class="seasonal-highlight-card-top">
              <span class="seasonal-highlight-badge" style="background:#d1fae5; color:#065f46">🌸 Primavera húmeda</span>
              <span style="font-size:1.2rem">🌱</span>
            </div>
            <div class="seasonal-highlight-val">551,4 mm</div>
            <p class="seasonal-highlight-desc">
              La <strong>Primavera 2026</strong> superó todas las marcas previas con <strong>551,4 mm</strong> (+49,0 % sobre la media de 370,1 mm) impulsando un desarrollo forrajero temprano de 356,9 GDD.
            </p>
          </div>
        </div>
      </section>

      <!-- Balance hídrico y evapotranspiración multianual (EVO-022 / EVO-A) -->
      <section class="section-block water-balance-section" id="sec-water-balance-comparative" aria-labelledby="wb-comp-title">
        <div class="section-header">
          <div>
            <div class="editorial-kicker">RÉGIMEN AGROCLIMÁTICO Y DEMANDA EVAPORATIVA COMPARADA</div>
            <h3 id="wb-comp-title" class="section-title">💧 Balance hídrico del suelo y Evapotranspiración (ET₀) Multianual (2022–2026)</h3>
            <p class="section-subtitle">
              Oferta pluviométrica vs demanda evapotranspirativa según formulación estándar FAO-56 Hargreaves-Samani (Lat. 43,341° N)
            </p>
          </div>
          <div>
            <button type="button" id="btn-export-waterbalance-xlsx" class="btn btn-excel">
              📊 Exportar balance hídrico a Excel (.xlsx)
            </button>
          </div>
        </div>

        <div class="chart-panel" style="margin-bottom:24px">
          <div class="chart-panel-header">
            <div>
              <h4 class="chart-panel-title">Comparativa interanual: Lluvia anual vs Evapotranspiración ET₀ y Balance neto</h4>
              <p class="chart-panel-subtitle">Precipitación total (mm), Evapotranspiración acumulada ET₀ (mm), Balance neto P &minus; ET₀ (mm) y Balance estival JJA (mm)</p>
            </div>
          </div>
          <div class="chart-canvas-wrap" style="height:380px">
            <canvas id="chart-comp-waterbalance"></canvas>
          </div>
        </div>

        <div class="table-responsive" style="margin-bottom:20px">
          <table class="data-table">
            <thead>
              <tr>
                <th>Año</th>
                <th class="num">Lluvia total</th>
                <th class="num">Evapotranspiración ET₀</th>
                <th class="num">Balance neto (P &minus; ET₀)</th>
                <th class="num">Balance estival (JJA)</th>
                <th class="num">Días déficit (P &lt; ET₀)</th>
                <th class="num">Días recarga (P &ge; ET₀)</th>
                <th>Mes mayor déficit</th>
                <th>Mes mayor superávit</th>
              </tr>
            </thead>
            <tbody>
              ${wbTableRowsHtml}
            </tbody>
            <tfoot>
              <tr>
                <td>Media ref. (2022–2025)</td>
                <td class="num"><strong>${fmtNum(ref.mean_annual_rain_mm, 1)} mm</strong></td>
                <td class="num"><strong>${fmtNum(comp.water_balance_comparison?.mean_annual_eto_mm, 1)} mm</strong></td>
                <td class="num" style="color:#059669"><strong>+${fmtNum(comp.water_balance_comparison?.mean_annual_water_balance_mm, 1)} mm</strong></td>
                <td class="num" style="color:#ea580c"><strong>${fmtNum(comp.water_balance_comparison?.mean_summer_balance_mm, 1)} mm</strong></td>
                <td class="num">—</td>
                <td class="num">—</td>
                <td>Julio (&minus;77,3 mm)</td>
                <td>Noviembre (+240,6 mm)</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div class="wb-assessment-callout">
          <h4>🌾 Diagnóstico agroclimático cantábrico</h4>
          <p>
            ${escapeHtml(comp.water_balance_comparison?.agroclimatic_assessment || '')}
          </p>
        </div>
      </section>

      <section class="section-block">
        <div class="section-header">
          <div>
            <h3 class="section-title">Cuadro sinóptico multianual (2022–2026)</h3>
            <p class="section-subtitle">Síntesis de todos los indicadores anuales y anomalías respecto al periodo cerrado 2022–2025</p>
          </div>
          <div>
            <button type="button" id="btn-export-synoptic-xlsx" class="btn btn-excel">
              📊 Exportar sinóptico a Excel (.xlsx)
            </button>
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
                <th class="num" title="Mediana de temperatura media diaria">Mediana (P50)</th>
                <th class="num">T. máx. abs.</th>
                <th class="num">T. mín. abs.</th>
                <th class="num" title="Días con máxima entre 15 y 25 °C">Confort (15–25 °C)</th>
                <th class="num">Lluvia anual</th>
                <th class="num">Anom. lluvia</th>
                <th class="num">Días ≥0,2 mm</th>
                <th class="num">Días ≥30 mm</th>
                <th class="num">Heladas</th>
                <th class="num">Días ≥30 °C</th>
                <th class="num">Noches trop.</th>
                <th class="num">Días Foehn</th>
                <th class="num">HDD (15,5 °C)</th>
                <th class="num">CDD (21 °C)</th>
                <th class="num">GDD (10 °C)</th>
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
                <td class="num">14,7 °C</td>
                <td class="num">42,1 °C (máx.)</td>
                <td class="num">-3,1 °C (mín.)</td>
                <td class="num" style="color:var(--accent-forest)"><strong>216,0</strong> (59,2 %)</td>
                <td class="num">${fmtNum(ref.mean_annual_rain_mm, 1)} mm</td>
                <td class="num">0,0 %</td>
                <td class="num">${fmtNum(ref.mean_annual_rain_days, 1)}</td>
                <td class="num">14,0</td>
                <td class="num">11,8</td>
                <td class="num">15,3</td>
                <td class="num">0,3</td>
                <td class="num">26,0</td>
                <td class="num">${fmtNum(ref.mean_annual_hdd_15_5, 1)}</td>
                <td class="num">${fmtNum(ref.mean_annual_cdd_21_0, 1)}</td>
                <td class="num" style="color:var(--accent-forest)">${fmtNum(ref.mean_annual_gdd_10_0, 1)}</td>
                <td class="num">97,2 km/h (máx.)</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <!-- Calendario histórico agroclimático y fenológico de Riotuerto -->
      <section class="section-block" aria-labelledby="sec-phenology-title">
        <div class="section-header">
          <div>
            <div class="editorial-kicker">FENOLOGÍA Y RITMOS DEL VALLE · SERIE HISTÓRICA 2022–2026</div>
            <h3 id="sec-phenology-title" class="section-title">Calendario histórico de labores cotidianas y agroclimatología</h3>
            <p class="section-subtitle">
              Comparativa interanual de fechas exactas en que se alcanzaron los umbrales biofísicos para calderas, huertas, siegas, robots cortacésped y setas
            </p>
          </div>
          <div>
            <button type="button" id="btn-export-phenology-xlsx" class="btn btn-excel">
              📊 Exportar calendario agroclimático (.xlsx)
            </button>
          </div>
        </div>

        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Labor o actividad cotidiana</th>
                <th>Criterio agroclimático</th>
                <th>2022</th>
                <th>2023</th>
                <th>2024</th>
                <th>2025</th>
                <th>2026 (Avance)</th>
                <th>Fecha media habitual</th>
              </tr>
            </thead>
            <tbody>
              ${phenoCompRowsHtml}
            </tbody>
          </table>
        </div>
      </section>
    `;

    document.getElementById('chk-include-2026')?.addEventListener('change', (e) => {
      STATE.include2026InComparisons = e.target.checked;
      renderComparisonCharts(comp);
      updateSeasonalTable(comp);
      renderSeasonalComparisonChart(comp);
    });

    document.getElementById('btn-export-synoptic-xlsx')?.addEventListener('click', () => {
      exportComparisonsSynopticToExcel(comp);
    });

    document.getElementById('btn-export-phenology-xlsx')?.addEventListener('click', () => {
      exportPhenologyCalendarToExcel(almanacs);
    });

    document.getElementById('btn-export-seasonal-xlsx')?.addEventListener('click', () => {
      exportSeasonalComparisonToExcel(comp.seasonal_comparison);
    });

    document.getElementById('btn-export-waterbalance-xlsx')?.addEventListener('click', () => {
      exportWaterBalanceToExcel(comp);
    });

    renderHeadToHeadComparator(comp);
    renderComparisonCharts(comp);
    initSeasonalComparison(comp);
  }

  /* ------------------------------------------------------------------------
   * EVO-011: Comparador cara a cara (head-to-head) entre dos años o meses
   * ------------------------------------------------------------------------ */
  function computeMedianValue(arr) {
    const valid = arr.filter((v) => v !== null && v !== undefined && !Number.isNaN(Number(v))).map(Number).sort((a, b) => a - b);
    if (!valid.length) return null;
    const mid = Math.floor(valid.length / 2);
    return valid.length % 2 === 1 ? valid[mid] : Number(((valid[mid - 1] + valid[mid]) / 2).toFixed(1));
  }

  function extractH2HProfile(mode, year, month, comp) {
    const y = Number(year);
    const m = Number(month);
    const alm = STATE.cache.almanacs[y];
    const compRow = comp.yearly_table.find((r) => r.year === y);
    if (!alm) return null;

    if (mode === 'yearly') {
      const stT = alm.stats.temperature;
      const stP = alm.stats.precipitation;
      const stW = alm.stats.wind;
      const stA = alm.stats.atmosphere_and_solar;
      const dd = alm.stats.degree_days || {};
      const p50 = alm.stats.thermal_percentiles?.temp_mean?.P50 ?? compRow?.temp_median ?? null;

      return {
        mode: 'yearly',
        label: `Año ${y}${alm.is_provisional ? ' (prov.)' : ''}`,
        shortLabel: `${y}`,
        sublabel: `${alm.editorial?.character ? `${alm.editorial.character} · ` : ''}${alm.coverage.valid_days}/${alm.coverage.observed_span_days} días observados`,
        hasData: alm.coverage.valid_days > 0,
        isProvisional: alm.is_provisional,
        validDays: alm.coverage.valid_days,
        tempMean: stT.mean,
        tempMedian: p50,
        tempMaxMean: stT.max_mean,
        tempMinMean: stT.min_mean,
        tempAmpMean: stT.mean_daily_amplitude,
        tempMaxAbs: stT.max_abs,
        tempMaxDate: stT.max_abs_date,
        tempMinAbs: stT.min_abs,
        tempMinDate: stT.min_abs_date,
        frostDays: stT.frost_days_le_0,
        warmDays25: stT.warm_days_ge_25,
        hotDays30: stT.hot_days_ge_30,
        tropicalNights: stT.tropical_nights_ge_20,
        comfortDays1525: compRow ? compRow.comfort_days_15_25 : null,
        rainTotal: stP.total_mm,
        rainDays02: stP.days_ge_02mm,
        rainHeavyDays: stP.days_ge_30mm,
        rainHeavyLabel: 'Días de lluvia muy fuerte (≥30 mm)',
        rainMaxDay: stP.max_daily_mm,
        rainMaxDate: stP.max_daily_date,
        windSpeedMean: stW.mean_speed_kmh,
        windGustMax: stW.max_gust_kmh,
        windGustDate: stW.max_gust_date,
        foehnDays: stW.foehn_days ?? alm.foehn_analysis?.total_foehn_days ?? 0,
        hdd: dd.hdd_15_5 ?? null,
        cdd: dd.cdd_21_0 ?? null,
        gdd: dd.gdd_10_0 ?? null,
        humidityMean: stA.humidity_mean_pct,
        pressureMean: stA.pressure_mean_hpa,
        seriesLabels: MONTH_SHORT_ES,
        seriesTemp: alm.monthly.map((mo) => mo.temp_mean),
        seriesRain: alm.monthly.map((mo) => mo.rain_total),
      };
    }

    // Modo mensual: extraer mes m del año y
    const mObj = alm.monthly.find((mo) => mo.month === m);
    const prefix = `${y}-${String(m).padStart(2, '0')}-`;
    const ds = alm.daily_series;
    const dayMeans = [];
    const dayAmps = [];
    let warm25 = 0;
    let comfort1525 = 0;
    const seriesTemp = new Array(31).fill(null);
    const seriesRain = new Array(31).fill(null);

    for (let i = 0; i < ds.dates.length; i += 1) {
      const dStr = ds.dates[i];
      if (!dStr.startsWith(prefix)) continue;
      const dayNum = Number(dStr.slice(8, 10));
      const tMean = ds.temp_mean[i];
      const tMax = ds.temp_max[i];
      const tAmp = ds.temp_amp[i];
      const rain = ds.rain_daily[i];

      if (dayNum >= 1 && dayNum <= 31) {
        seriesTemp[dayNum - 1] = tMean;
        seriesRain[dayNum - 1] = rain;
      }
      if (tMean !== null && tMean !== undefined) dayMeans.push(tMean);
      if (tAmp !== null && tAmp !== undefined) dayAmps.push(tAmp);
      if (tMax !== null && tMax !== undefined) {
        if (tMax >= 25.0) warm25 += 1;
        if (tMax >= 15.0 && tMax < 25.0) comfort1525 += 1;
      }
    }

    const validDays = mObj ? mObj.valid_days : 0;
    const calDays = mObj ? mObj.calendar_days : 30;
    const avgAmp = dayAmps.length ? Number((dayAmps.reduce((a, b) => a + b, 0) / dayAmps.length).toFixed(1)) : null;

    return {
      mode: 'monthly',
      label: `${MONTH_NAMES_ES[m - 1]} de ${y}`,
      shortLabel: `${MONTH_SHORT_ES[m - 1]} ${y}`,
      sublabel: validDays > 0
        ? `${validDays}/${calDays} días registrados en ${MONTH_NAMES_ES[m - 1].toLowerCase()} de ${y}`
        : `Mes aún no observado en ${y}`,
      hasData: validDays > 0,
      isProvisional: alm.is_provisional,
      validDays,
      tempMean: mObj ? mObj.temp_mean : null,
      tempMedian: computeMedianValue(dayMeans),
      tempMaxMean: mObj ? mObj.temp_max_mean : null,
      tempMinMean: mObj ? mObj.temp_min_mean : null,
      tempAmpMean: avgAmp,
      tempMaxAbs: mObj ? mObj.temp_max_abs : null,
      tempMaxDate: mObj ? mObj.temp_max_date : null,
      tempMinAbs: mObj ? mObj.temp_min_abs : null,
      tempMinDate: mObj ? mObj.temp_min_date : null,
      frostDays: mObj ? mObj.frost_days : null,
      warmDays25: validDays > 0 ? warm25 : null,
      hotDays30: mObj ? mObj.hot_days_30 : null,
      tropicalNights: mObj ? mObj.tropical_nights : null,
      comfortDays1525: validDays > 0 ? comfort1525 : null,
      rainTotal: mObj ? mObj.rain_total : null,
      rainDays02: mObj ? mObj.rain_days_02 : null,
      rainHeavyDays: mObj ? mObj.rain_days_10 : null,
      rainHeavyLabel: 'Días de lluvia abundante (≥10 mm)',
      rainMaxDay: mObj ? mObj.rain_max_day : null,
      rainMaxDate: mObj ? mObj.rain_max_date : null,
      windSpeedMean: mObj ? mObj.wind_speed_mean : null,
      windGustMax: mObj ? mObj.wind_gust_max : null,
      windGustDate: mObj ? mObj.wind_gust_date : null,
      foehnDays: mObj ? mObj.foehn_days : null,
      hdd: mObj ? mObj.hdd_15_5 : null,
      cdd: mObj ? mObj.cdd_21_0 : null,
      gdd: mObj ? mObj.gdd_10_0 : null,
      humidityMean: mObj ? mObj.humidity_mean : null,
      pressureMean: mObj ? mObj.pressure_mean : null,
      seriesLabels: Array.from({ length: 31 }, (_, idx) => `Día ${idx + 1}`),
      seriesTemp,
      seriesRain,
    };
  }

  function renderHeadToHeadComparator(comp) {
    const h2hContainer = document.getElementById('h2h-comparator-container');
    if (!h2hContainer) return;

    const { mode, yearA, monthA, yearB, monthB } = STATE.headToHead;
    const years = [2022, 2023, 2024, 2025, 2026];
    const profA = extractH2HProfile(mode, yearA, monthA, comp);
    const profB = extractH2HProfile(mode, yearB, monthB, comp);
    if (!profA || !profB) return;

    const yearOptionsA = years.map((y) => `<option value="${y}" ${y === Number(yearA) ? 'selected' : ''}>${y}${y === 2026 ? ' (prov.)' : ''}</option>`).join('');
    const yearOptionsB = years.map((y) => `<option value="${y}" ${y === Number(yearB) ? 'selected' : ''}>${y}${y === 2026 ? ' (prov.)' : ''}</option>`).join('');
    const monthOptionsA = MONTH_NAMES_ES.map((name, idx) => `<option value="${idx + 1}" ${idx + 1 === Number(monthA) ? 'selected' : ''}>${name}</option>`).join('');
    const monthOptionsB = MONTH_NAMES_ES.map((name, idx) => `<option value="${idx + 1}" ${idx + 1 === Number(monthB) ? 'selected' : ''}>${name}</option>`).join('');

    // Construir veredicto narrativo automático
    let verdictHtml = '';
    if (!profA.hasData || !profB.hasData) {
      verdictHtml = `
        <div class="h2h-verdict-box">
          <strong>⚠️ Periodo sin observaciones consolidadas:</strong> Uno de los meses seleccionados pertenece a la parte aún no transcurrida del año en curso 2026. Seleccione un mes entre enero y octubre para contrastar datos observados.
        </div>
      `;
    } else {
      const dTemp = Number((profB.tempMean - profA.tempMean).toFixed(1));
      const dRain = Number((profB.rainTotal - profA.rainTotal).toFixed(1));
      const pctRain = profA.rainTotal > 0 ? Number(((dRain / profA.rainTotal) * 100).toFixed(1)) : null;
      const dHdd = profA.hdd !== null && profB.hdd !== null ? Number((profB.hdd - profA.hdd).toFixed(1)) : null;

      const tempPhrase = dTemp === 0
        ? `registró exactamente la misma temperatura media (<strong>${fmtNum(profB.tempMean, 1)} °C</strong>)`
        : dTemp > 0
          ? `fue <strong>+${fmtNum(dTemp, 1)} °C más cálido</strong> en promedio (${fmtNum(profB.tempMean, 1)} °C frente a ${fmtNum(profA.tempMean, 1)} °C)`
          : `fue <strong>${fmtNum(dTemp, 1)} °C más fresco</strong> en promedio (${fmtNum(profB.tempMean, 1)} °C frente a ${fmtNum(profA.tempMean, 1)} °C)`;

      const rainPhrase = dRain === 0
        ? `acumuló idéntica precipitación (${fmtNum(profB.rainTotal, 1)} mm)`
        : dRain > 0
          ? `recogió <strong>+${fmtNum(dRain, 1)} mm más de lluvia</strong> (${pctRain !== null ? `+${fmtNum(pctRain, 1)} %` : ''})`
          : `recogió <strong>${fmtNum(Math.abs(dRain), 1)} mm menos de lluvia</strong> (${pctRain !== null ? `${fmtNum(pctRain, 1)} %` : ''})`;

      const hddPhrase = dHdd !== null && Math.abs(dHdd) >= 1
        ? ` En términos energéticos domésticos, supuso <strong>${dHdd > 0 ? `+${fmtNum(dHdd, 1)} HDD más` : `${fmtNum(Math.abs(dHdd), 1)} HDD menos`}</strong> de demanda de calefacción.`
        : '';

      verdictHtml = `
        <div class="h2h-verdict-box">
          <span class="h2h-verdict-kicker">⚖️ SÍNTESIS DEL CONTRASTE (${escapeHtml(profB.shortLabel)} FRENTE A ${escapeHtml(profA.shortLabel)}):</span>
          <p class="h2h-verdict-text">
            En comparación con <strong>${escapeHtml(profA.label)}</strong>, el periodo <strong>${escapeHtml(profB.label)}</strong>
            ${tempPhrase} y ${rainPhrase}.${hddPhrase}
          </p>
        </div>
      `;
    }

    // Filas del marcador comparativo (Scoreboard)
    const metricDefs = [
      { label: 'Temperatura media', key: 'tempMean', unit: '°C', dec: 1, category: '🌡️ Termometría' },
      { label: 'Mediana térmica diaria (P50)', key: 'tempMedian', unit: '°C', dec: 1 },
      { label: 'Media de las máximas diarias', key: 'tempMaxMean', unit: '°C', dec: 1 },
      { label: 'Media de las mínimas diarias', key: 'tempMinMean', unit: '°C', dec: 1 },
      { label: 'Amplitud térmica media diaria', key: 'tempAmpMean', unit: '°C', dec: 1 },
      { label: 'Temperatura máxima absoluta', key: 'tempMaxAbs', unit: '°C', dec: 1, dateKey: 'tempMaxDate' },
      { label: 'Temperatura mínima absoluta', key: 'tempMinAbs', unit: '°C', dec: 1, dateKey: 'tempMinDate' },
      { label: 'Días en confort térmico (15–25 °C)', key: 'comfortDays1525', unit: 'días', dec: 0 },
      { label: 'Días de calor (≥30 °C)', key: 'hotDays30', unit: 'días', dec: 0 },
      { label: 'Días de helada (≤0 °C)', key: 'frostDays', unit: 'días', dec: 0 },
      { label: 'Noches tropicales (mín. ≥20 °C)', key: 'tropicalNights', unit: 'noches', dec: 0 },
      { label: 'Precipitación total acumulada', key: 'rainTotal', unit: 'mm', dec: 1, category: '💧 Pluviometría' },
      { label: 'Días de lluvia apreciable (≥0,2 mm)', key: 'rainDays02', unit: 'días', dec: 0 },
      { label: profA.rainHeavyLabel, key: 'rainHeavyDays', unit: 'días', dec: 0 },
      { label: 'Precipitación máxima en 24 h', key: 'rainMaxDay', unit: 'mm', dec: 1, dateKey: 'rainMaxDate' },
      { label: 'Velocidad media del viento', key: 'windSpeedMean', unit: 'km/h', dec: 1, category: '💨 Viento, Foehn y energía' },
      { label: 'Racha máxima de viento', key: 'windGustMax', unit: 'km/h', dec: 1, dateKey: 'windGustDate' },
      { label: 'Días con patrón Foehn / surada', key: 'foehnDays', unit: 'días', dec: 0 },
      { label: 'Grados día de calefacción (HDD 15,5 °C)', key: 'hdd', unit: 'HDD', dec: 1 },
      { label: 'Grados día de refrigeración (CDD 21 °C)', key: 'cdd', unit: 'CDD', dec: 1 },
      { label: 'Grados día de crecimiento vegetal (GDD 10 °C)', key: 'gdd', unit: 'GDD', dec: 1 },
    ];

    const scoreboardRowsHtml = metricDefs.map((mDef) => {
      const valA = profA[mDef.key];
      const valB = profB[mDef.key];
      const hasBoth = valA !== null && valA !== undefined && valB !== null && valB !== undefined;
      const diff = hasBoth ? Number((valB - valA).toFixed(mDef.dec)) : null;

      // Porcentaje para barra proporcional
      let pctA = 50;
      let pctB = 50;
      if (hasBoth) {
        const absA = Math.max(0, Number(valA));
        const absB = Math.max(0, Number(valB));
        const sum = absA + absB;
        if (sum > 0) {
          pctA = Math.round((absA / sum) * 100);
          pctB = 100 - pctA;
        }
      }

      const dateAStr = mDef.dateKey && profA[mDef.dateKey] ? ` <small class="mono" style="color:var(--txt-muted)">(${fmtDateES(profA[mDef.dateKey], false)})</small>` : '';
      const dateBStr = mDef.dateKey && profB[mDef.dateKey] ? ` <small class="mono" style="color:var(--txt-muted)">(${fmtDateES(profB[mDef.dateKey], false)})</small>` : '';

      const catRow = mDef.category
        ? `<tr class="h2h-cat-row"><td colspan="5">${mDef.category}</td></tr>`
        : '';

      const diffClass = diff === null || diff === 0 ? '' : diff > 0 ? 'h2h-diff-pos' : 'h2h-diff-neg';

      return `
        ${catRow}
        <tr>
          <td><strong>${escapeHtml(mDef.label)}</strong></td>
          <td class="num"><span class="h2h-val-a">${fmtNum(valA, mDef.dec, mDef.unit)}</span>${dateAStr}</td>
          <td class="h2h-bar-cell">
            <div class="h2h-dual-bar" title="${escapeHtml(profA.shortLabel)}: ${fmtNum(valA, mDef.dec)} vs ${escapeHtml(profB.shortLabel)}: ${fmtNum(valB, mDef.dec)}">
              <div class="h2h-bar-a" style="width:${pctA}%"></div>
              <div class="h2h-bar-b" style="width:${pctB}%"></div>
            </div>
          </td>
          <td class="num"><span class="h2h-val-b">${fmtNum(valB, mDef.dec, mDef.unit)}</span>${dateBStr}</td>
          <td class="num ${diffClass}"><strong>${diff !== null ? fmtSignNum(diff, mDef.dec, mDef.unit) : '—'}</strong></td>
        </tr>
      `;
    }).join('');

    const dTemp = profA.hasData && profB.hasData ? Number((profB.tempMean - profA.tempMean).toFixed(1)) : null;
    const dRain = profA.hasData && profB.hasData ? Number((profB.rainTotal - profA.rainTotal).toFixed(1)) : null;
    const dRainPct = profA.hasData && profB.hasData && profA.rainTotal > 0
      ? Number(((dRain / profA.rainTotal) * 100).toFixed(1))
      : null;
    const dHdd = profA.hasData && profB.hasData && profA.hdd !== null && profB.hdd !== null
      ? Number((profB.hdd - profA.hdd).toFixed(1))
      : null;
    const dFoehn = profA.hasData && profB.hasData && profA.foehnDays !== null && profB.foehnDays !== null
      ? profB.foehnDays - profA.foehnDays
      : null;

    h2hContainer.innerHTML = `
      <div class="section-header">
        <div>
          <h3 id="h2h-heading" class="section-title">⚔️ Comparador cara a cara (Periodo A frente a Periodo B)</h3>
          <p class="section-subtitle">
            Seleccione dos años completos o dos meses específicos para calcular sus diferencias exactas (Δ = B − A) y superponer sus curvas
          </p>
        </div>
        <div class="h2h-mode-switch" role="group" aria-label="Modo de comparación cara a cara">
          <button type="button" class="btn ${mode === 'yearly' ? 'btn-primary' : ''}" id="btn-h2h-mode-yearly">📅 Año vs. Año</button>
          <button type="button" class="btn ${mode === 'monthly' ? 'btn-primary' : ''}" id="btn-h2h-mode-monthly">🗓️ Mes vs. Mes</button>
        </div>
      </div>

      <div class="h2h-controls-grid">
        <div class="h2h-period-card h2h-period-a">
          <div class="h2h-period-badge">PERIODO A (REFERENCIA)</div>
          <div class="h2h-selectors-row">
            ${mode === 'monthly' ? `
              <label class="h2h-select-label">
                <span>Mes A</span>
                <select id="sel-h2h-month-a" class="form-select">${monthOptionsA}</select>
              </label>
            ` : ''}
            <label class="h2h-select-label">
              <span>Año A</span>
              <select id="sel-h2h-year-a" class="form-select">${yearOptionsA}</select>
            </label>
          </div>
          <div class="h2h-period-summary">${escapeHtml(profA.sublabel)}</div>
        </div>

        <div class="h2h-swap-col">
          <button type="button" class="btn h2h-swap-btn" id="btn-h2h-swap" title="Intercambiar Periodo A y Periodo B">
            ⇄ Invertir A / B
          </button>
        </div>

        <div class="h2h-period-card h2h-period-b">
          <div class="h2h-period-badge">PERIODO B (CONTRASTE)</div>
          <div class="h2h-selectors-row">
            ${mode === 'monthly' ? `
              <label class="h2h-select-label">
                <span>Mes B</span>
                <select id="sel-h2h-month-b" class="form-select">${monthOptionsB}</select>
              </label>
            ` : ''}
            <label class="h2h-select-label">
              <span>Año B</span>
              <select id="sel-h2h-year-b" class="form-select">${yearOptionsB}</select>
            </label>
          </div>
          <div class="h2h-period-summary">${escapeHtml(profB.sublabel)}</div>
        </div>
      </div>

      <div class="h2h-presets-row">
        <span class="h2h-presets-label">Cruces destacados:</span>
        <button type="button" class="term-chip-link" data-h2h-preset="yearly:2023:8:2025:8">2023 (récord lluvia) vs. 2025</button>
        <button type="button" class="term-chip-link" data-h2h-preset="yearly:2022:8:2024:8">2022 vs. 2024 (récord calor/viento)</button>
        <button type="button" class="term-chip-link" data-h2h-preset="monthly:2023:8:2024:8">Agosto 2023 vs. Agosto 2024 (>40 °C)</button>
        <button type="button" class="term-chip-link" data-h2h-preset="monthly:2023:1:2025:1">Enero 2023 vs. Enero 2025</button>
        <button type="button" class="term-chip-link" data-h2h-preset="monthly:2025:10:2026:10">Octubre 2025 vs. Octubre 2026</button>
      </div>

      ${verdictHtml}

      <div class="kpi-grid-4" style="margin-bottom:20px">
        <div class="kpi-card">
          <div class="kpi-label">Δ Temperatura media (B − A)</div>
          <div class="kpi-value" style="color:${dTemp > 0 ? 'var(--accent-heat)' : dTemp < 0 ? 'var(--accent-cold)' : 'var(--txt-primary)'}">
            ${dTemp !== null ? fmtSignNum(dTemp, 1, '°C') : '—'}
          </div>
          <div class="kpi-meta">${escapeHtml(profA.shortLabel)}: <strong>${fmtNum(profA.tempMean, 1)} °C</strong> · ${escapeHtml(profB.shortLabel)}: <strong>${fmtNum(profB.tempMean, 1)} °C</strong></div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Δ Precipitación acumulada (B − A)</div>
          <div class="kpi-value" style="color:var(--accent-rain)">
            ${dRain !== null ? fmtSignNum(dRain, 1, 'mm') : '—'}
          </div>
          <div class="kpi-meta">${dRainPct !== null ? `Variación: <strong>${fmtSignNum(dRainPct, 1, '%')}</strong> · ` : ''}${profA.rainDays02 ?? '—'} vs. ${profB.rainDays02 ?? '—'} días de lluvia</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Δ Demanda calefacción (HDD)</div>
          <div class="kpi-value" style="color:var(--accent-forest)">
            ${dHdd !== null ? fmtSignNum(dHdd, 1, 'HDD') : '—'}
          </div>
          <div class="kpi-meta">GDD agrícola: <strong>${fmtNum(profA.gdd, 0)}</strong> vs. <strong>${fmtNum(profB.gdd, 0)}</strong></div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Δ Días patrón Foehn / surada</div>
          <div class="kpi-value" style="color:var(--accent-solar)">
            ${dFoehn !== null ? fmtSignNum(dFoehn, 0, 'días') : '—'}
          </div>
          <div class="kpi-meta">Racha máx.: <strong>${fmtNum(profA.windGustMax, 1)}</strong> vs. <strong>${fmtNum(profB.windGustMax, 1)} km/h</strong></div>
        </div>
      </div>

      <div class="chart-panel" style="margin-bottom:22px">
        <div class="chart-panel-header">
          <div>
            <h4 class="chart-panel-title">📈 Superposición directa: ${escapeHtml(profA.label)} vs. ${escapeHtml(profB.label)}</h4>
            <p class="chart-panel-subtitle">
              ${mode === 'yearly'
                ? 'Evolución mensual comparada de temperatura media (líneas, eje izquierdo) y precipitación acumulada (barras, eje derecho)'
                : 'Evolución diaria (días 1 al 31) de temperatura media diaria (líneas) y lluvia diaria (barras)'}
            </p>
          </div>
        </div>
        <div class="chart-canvas-wrap" style="height:340px">
          <canvas id="chart-h2h-comparison"></canvas>
        </div>
      </div>

      <div class="table-responsive">
        <div class="table-header-actions" style="justify-content:space-between;margin-bottom:10px;">
          <h4 style="margin:0;font-size:0.95rem;font-weight:700;">Marcador cara a cara (21 indicadores)</h4>
          <button type="button" id="btn-export-h2h-xlsx" class="btn btn-excel">
            📊 Exportar cara a cara a Excel (.xlsx)
          </button>
        </div>
        <table class="data-table h2h-table">
          <thead>
            <tr>
              <th>Indicador climatológico</th>
              <th class="num" style="color:#2563eb">Periodo A (${escapeHtml(profA.shortLabel)})</th>
              <th style="width:180px;text-align:center">Proporción A vs. B</th>
              <th class="num" style="color:#d97706">Periodo B (${escapeHtml(profB.shortLabel)})</th>
              <th class="num">Diferencia (B − A)</th>
            </tr>
          </thead>
          <tbody>
            ${scoreboardRowsHtml}
          </tbody>
        </table>
      </div>
    `;

    // Renderizar gráfico superpuesto A vs B
    const pal = chartPalette();
    createChart('comp-h2h-dual', 'chart-h2h-comparison', {
      data: {
        labels: profA.seriesLabels,
        datasets: [
          {
            type: 'line',
            label: `T. media ${profA.shortLabel} (°C)`,
            data: profA.seriesTemp,
            borderColor: '#2563eb',
            backgroundColor: '#2563eb',
            borderWidth: 2.5,
            pointRadius: mode === 'yearly' ? 4 : 2.5,
            tension: 0.25,
            yAxisID: 'yTemp',
          },
          {
            type: 'line',
            label: `T. media ${profB.shortLabel} (°C)`,
            data: profB.seriesTemp,
            borderColor: '#d97706',
            backgroundColor: '#d97706',
            borderWidth: 2.5,
            pointRadius: mode === 'yearly' ? 4 : 2.5,
            tension: 0.25,
            yAxisID: 'yTemp',
          },
          {
            type: 'bar',
            label: `Lluvia ${profA.shortLabel} (mm)`,
            data: profA.seriesRain,
            backgroundColor: 'rgba(37, 99, 235, 0.32)',
            borderColor: '#2563eb',
            borderWidth: 1,
            borderRadius: 3,
            yAxisID: 'yRain',
          },
          {
            type: 'bar',
            label: `Lluvia ${profB.shortLabel} (mm)`,
            data: profB.seriesRain,
            backgroundColor: 'rgba(217, 119, 6, 0.36)',
            borderColor: '#d97706',
            borderWidth: 1,
            borderRadius: 3,
            yAxisID: 'yRain',
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
          x: {
            ticks: { color: pal.text },
            grid: { color: pal.grid },
          },
          yTemp: {
            type: 'linear',
            position: 'left',
            title: { display: true, text: 'Temperatura media (°C)', color: pal.text },
            ticks: { color: pal.text },
            grid: { color: pal.grid },
          },
          yRain: {
            type: 'linear',
            position: 'right',
            beginAtZero: true,
            title: { display: true, text: 'Precipitación (mm)', color: pal.rain },
            ticks: { color: pal.rain },
            grid: { drawOnChartArea: false },
          },
        },
      },
    });

    // Eventos de interacción del comparador cara a cara
    document.getElementById('btn-export-h2h-xlsx')?.addEventListener('click', () => {
      exportHeadToHeadScoreboardToExcel(profA, profB, mode);
    });
    document.getElementById('btn-h2h-mode-yearly')?.addEventListener('click', () => {
      STATE.headToHead.mode = 'yearly';
      renderHeadToHeadComparator(comp);
    });
    document.getElementById('btn-h2h-mode-monthly')?.addEventListener('click', () => {
      STATE.headToHead.mode = 'monthly';
      renderHeadToHeadComparator(comp);
    });
    document.getElementById('sel-h2h-year-a')?.addEventListener('change', (e) => {
      STATE.headToHead.yearA = Number(e.target.value);
      renderHeadToHeadComparator(comp);
    });
    document.getElementById('sel-h2h-year-b')?.addEventListener('change', (e) => {
      STATE.headToHead.yearB = Number(e.target.value);
      renderHeadToHeadComparator(comp);
    });
    document.getElementById('sel-h2h-month-a')?.addEventListener('change', (e) => {
      STATE.headToHead.monthA = Number(e.target.value);
      renderHeadToHeadComparator(comp);
    });
    document.getElementById('sel-h2h-month-b')?.addEventListener('change', (e) => {
      STATE.headToHead.monthB = Number(e.target.value);
      renderHeadToHeadComparator(comp);
    });
    document.getElementById('btn-h2h-swap')?.addEventListener('click', () => {
      const tmpY = STATE.headToHead.yearA;
      const tmpM = STATE.headToHead.monthA;
      STATE.headToHead.yearA = STATE.headToHead.yearB;
      STATE.headToHead.monthA = STATE.headToHead.monthB;
      STATE.headToHead.yearB = tmpY;
      STATE.headToHead.monthB = tmpM;
      renderHeadToHeadComparator(comp);
    });
    h2hContainer.querySelectorAll('[data-h2h-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const parts = (btn.getAttribute('data-h2h-preset') || '').split(':');
        if (parts.length === 5) {
          STATE.headToHead.mode = parts[0];
          STATE.headToHead.yearA = Number(parts[1]);
          STATE.headToHead.monthA = Number(parts[2]);
          STATE.headToHead.yearB = Number(parts[3]);
          STATE.headToHead.monthB = Number(parts[4]);
          renderHeadToHeadComparator(comp);
        }
      });
    });
  }

  function renderComparisonCharts(comp) {
    const pal = chartPalette();
    const ref = comp.reference_baseline;
    const rows = comp.yearly_table.filter((r) => STATE.include2026InComparisons || !r.is_provisional);
    const completeRows = comp.yearly_table.filter((r) => !r.is_provisional);

    // Colores diferenciados y consistentes por año
    const yearColors = {
      '2022': '#d97706',
      '2023': '#2563eb',
      '2024': '#0d9488',
      '2025': '#9333ea',
      '2026': '#059669',
    };

    // 0. Curva espagueti de precipitación acumulada (EVO-001)
    const cum = comp.cumulative_precipitation;
    if (cum && cum.years) {
      const cumDatasets = [];

      // Años consolidados
      ['2022', '2023', '2024', '2025'].forEach((y) => {
        const row = comp.yearly_table.find((r) => String(r.year) === y);
        const totalStr = row ? `${fmtNum(row.rain_total_mm, 1)} mm` : '';
        cumDatasets.push({
          label: `Año ${y} (${totalStr})`,
          data: cum.years[y],
          borderColor: yearColors[y],
          backgroundColor: yearColors[y],
          borderWidth: y === '2023' ? 2.8 : 2,
          pointRadius: 0,
          pointHoverRadius: 5,
          tension: 0.1,
        });
      });

      // Año 2026 (provisional) si está habilitado
      if (STATE.include2026InComparisons && cum.years['2026']) {
        cumDatasets.push({
          label: 'Año 2026 (1.504,3 mm al 25 oct · prov.)',
          data: cum.years['2026'],
          borderColor: yearColors['2026'],
          backgroundColor: yearColors['2026'],
          borderWidth: 3.5,
          pointRadius: 0,
          pointHoverRadius: 7,
          tension: 0.1,
        });
      }

      // Media de referencia 2022–2025 (curva punteada contrastada)
      const baselineColor = STATE.theme === 'dark' ? '#e2e8f0' : '#1e293b';
      cumDatasets.unshift({
        label: `Media referencia 2022–2025 (${fmtNum(ref.mean_annual_rain_mm, 1)} mm)`,
        data: cum.baseline_mean,
        borderColor: baselineColor,
        backgroundColor: baselineColor,
        borderDash: [6, 4],
        borderWidth: 3.2,
        pointRadius: 0,
        pointHoverRadius: 6,
        tension: 0.1,
      });

      createChart('comp_cum_rain', 'chart-comp-cum-rain', {
        type: 'line',
        data: {
          labels: cum.labels,
          datasets: cumDatasets,
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              labels: {
                color: pal.text,
                usePointStyle: true,
                boxWidth: 10,
              },
            },
            tooltip: {
              callbacks: {
                title: (items) => 'Día: ' + items[0].label,
                label: (ctx) => {
                  const lbl = ctx.dataset.label.split('(')[0].trim();
                  return `${lbl}: ${fmtNum(ctx.parsed.y, 1)} mm`;
                },
              },
            },
          },
          scales: {
            x: {
              ticks: { color: pal.text, maxTicksLimit: 12 },
              grid: { color: pal.grid },
            },
            y: {
              beginAtZero: true,
              title: { display: true, text: 'Precipitación acumulada (mm)', color: pal.text },
              ticks: { color: pal.text },
              grid: { color: pal.grid },
            },
          },
        },
      });
    }

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
          { label: 'Suradas / Foehn', data: rows.map((r) => r.foehn_days ?? 0), backgroundColor: pal.solar },
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

    // 5. Grados día anuales comparados (EVO-006)
    createChart('comp_degree_days', 'chart-comp-degree-days', {
      type: 'bar',
      data: {
        labels: rows.map((r) => (r.is_provisional ? `${r.year} (prov.)` : String(r.year))),
        datasets: [
          {
            label: 'Calefacción doméstica (HDD 15,5 °C)',
            data: rows.map((r) => r.hdd_15_5),
            backgroundColor: 'rgba(194, 65, 12, 0.85)',
            borderRadius: 4,
          },
          {
            label: 'Refrigeración estival (CDD 21,0 °C)',
            data: rows.map((r) => r.cdd_21_0),
            backgroundColor: 'rgba(14, 116, 144, 0.85)',
            borderRadius: 4,
          },
          {
            label: 'Desarrollo agrícola / praderas (GDD 10,0 °C)',
            data: rows.map((r) => r.gdd_10_0),
            backgroundColor: 'rgba(27, 67, 50, 0.85)',
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: pal.text } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${fmtNum(ctx.parsed.y, 1)} grados día`,
            },
          },
        },
        scales: {
          x: { ticks: { color: pal.text }, grid: { color: pal.grid } },
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Grados día acumulados', color: pal.text },
            ticks: { color: pal.text },
            grid: { color: pal.grid },
          },
        },
      },
    });

    // 6. Reparto de días por bandas térmicas y de confort (EVO-007)
    const tDist = comp.thermal_distribution;
    if (tDist && tDist.bands) {
      const yearsList = rows.map((r) => String(r.year));
      const datasets = tDist.bands.map((band, bIdx) => ({
        label: `${band.name} (${band.range})`,
        data: yearsList.map((y) => (tDist.years_pct[y] ? tDist.years_pct[y][bIdx] : 0)),
        backgroundColor: band.color,
        borderRadius: 2,
      }));

      createChart('comp_thermal_distribution', 'chart-comp-thermal-distribution', {
        type: 'bar',
        data: {
          labels: rows.map((r) => (r.is_provisional ? `${r.year} (prov.)` : String(r.year))),
          datasets: datasets,
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'top',
              labels: { color: pal.text, boxWidth: 12, usePointStyle: true },
            },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const y = yearsList[ctx.dataIndex];
                  const days = tDist.years[y] ? tDist.years[y][ctx.datasetIndex] : 0;
                  return `${ctx.dataset.label}: ${fmtNum(ctx.parsed.x, 1)}% (${days} días)`;
                },
              },
            },
          },
          scales: {
            x: {
              stacked: true,
              max: 100,
              title: { display: true, text: 'Distribución porcentual del año (%)', color: pal.text },
              ticks: { color: pal.text, callback: (v) => `${v}%` },
              grid: { color: pal.grid },
            },
            y: {
              stacked: true,
              ticks: { color: pal.text, font: { weight: 'bold' } },
              grid: { display: false },
            },
          },
        },
      });
    }

    // 7. Balance Hídrico Multianual: Lluvia vs ET0 vs Balance neto (EVO-022 / EVO-A)
    const wbCompEl = document.getElementById('chart-comp-waterbalance');
    if (wbCompEl && comp.water_balance_comparison) {
      const wbCompRows = comp.yearly_table.filter((r) => STATE.include2026InComparisons || !r.is_provisional);
      const labels = wbCompRows.map((r) => (r.is_provisional ? `${r.year} (prov.)` : String(r.year)));
      const rainData = wbCompRows.map((r) => r.rain_total_mm);
      const etoData = wbCompRows.map((r) => r.eto_total_mm);
      const netData = wbCompRows.map((r) => r.water_balance_mm);
      const summerData = wbCompRows.map((r) => r.summer_balance_mm);

      createChart('comp_waterbalance', 'chart-comp-waterbalance', {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            {
              type: 'bar',
              label: 'Precipitación anual (mm)',
              data: rainData,
              backgroundColor: 'rgba(37, 99, 235, 0.7)',
              borderColor: '#2563eb',
              borderWidth: 1.5,
              borderRadius: 4,
              order: 3,
            },
            {
              type: 'bar',
              label: 'Evapotranspiración ET₀ (mm)',
              data: etoData,
              backgroundColor: 'rgba(234, 88, 12, 0.7)',
              borderColor: '#ea580c',
              borderWidth: 1.5,
              borderRadius: 4,
              order: 3,
            },
            {
              type: 'line',
              label: 'Balance neto anual P - ET₀ (mm)',
              data: netData,
              borderColor: '#059669',
              backgroundColor: '#059669',
              borderWidth: 2.8,
              pointRadius: 5,
              pointBackgroundColor: '#059669',
              pointBorderColor: '#ffffff',
              pointBorderWidth: 2,
              tension: 0.2,
              order: 1,
            },
            {
              type: 'line',
              label: 'Balance estival JJA (mm)',
              data: summerData,
              borderColor: '#dc2626',
              backgroundColor: '#dc2626',
              borderDash: [5, 5],
              borderWidth: 2.2,
              pointRadius: 4.5,
              pointBackgroundColor: '#dc2626',
              pointBorderColor: '#ffffff',
              pointBorderWidth: 1.5,
              tension: 0.2,
              order: 2,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { labels: { color: pal.text } },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const val = ctx.parsed.y;
                  if (val === null || val === undefined) return '';
                  const prefix = ctx.dataset.label.includes('Balance') && val > 0 ? '+' : '';
                  return `${ctx.dataset.label}: ${prefix}${fmtNum(val, 1)} mm`;
                },
              },
            },
          },
          scales: {
            x: { ticks: { color: pal.text, font: { weight: 'bold' } }, grid: { color: pal.grid } },
            y: {
              title: { display: true, text: 'Milímetros acumulados (mm)', color: pal.text },
              ticks: { color: pal.text },
              grid: { color: pal.grid },
            },
          },
        },
      });
    }
  }

  /* ------------------------------------------------------------------------
   * EVO-019 (EVO-C): Climatología estacional comparada (Trimestres canónicos OMM)
   * ------------------------------------------------------------------------ */
  function renderSeasonalTableRows(seasonalComp, seasonFilter) {
    if (!seasonalComp || !seasonalComp.table) return '';
    let rows = seasonalComp.table;
    if (seasonFilter && seasonFilter !== 'all') {
      rows = rows.filter((r) => r.season_id === seasonFilter);
    }
    if (!STATE.include2026InComparisons) {
      rows = rows.filter((r) => !r.is_provisional);
    }

    return rows.map((r) => {
      const yearBadge = r.is_provisional
        ? `<span class="badge badge-provisional">${r.year} (prov.)</span>`
        : `<strong>${r.year}</strong>`;
      const seasonBadge = `<span class="seasonal-pill seasonal-pill-${r.season_id}">${r.season_icon} ${r.season_name}</span>`;
      const ommBadge = `<span class="badge">${r.season_code}</span>`;

      const tAnomHtml = r.temp_anomaly !== null && r.temp_anomaly !== undefined
        ? `<span class="${r.temp_anomaly >= 0 ? 'text-warm' : 'text-cool'} font-mono">${fmtSignNum(r.temp_anomaly, 2, '°C')}</span>`
        : '—';

      const rAnomHtml = r.rain_anomaly_mm !== null && r.rain_anomaly_mm !== undefined
        ? `<span class="${r.rain_anomaly_mm >= 0 ? 'text-rain-surplus' : 'text-rain-deficit'} font-mono">${fmtSignNum(r.rain_anomaly_mm, 1, 'mm')} <small>(${fmtSignNum(r.rain_anomaly_pct, 1, '%')})</small></span>`
        : (r.is_provisional ? '<span class="badge badge-provisional">En curso</span>' : '—');

      return `
        <tr>
          <td>${yearBadge}</td>
          <td>${seasonBadge}</td>
          <td class="num">${ommBadge}</td>
          <td><small>${escapeHtml(r.months_label)}</small></td>
          <td class="num font-mono">${r.observed_days}/${r.expected_days}</td>
          <td class="num font-mono"><strong>${fmtNum(r.temp_mean, 1)} °C</strong></td>
          <td class="num font-mono">${tAnomHtml}</td>
          <td class="num font-mono">${fmtNum(r.temp_max_abs, 1)} °C</td>
          <td class="num font-mono">${fmtNum(r.temp_min_abs, 1)} °C</td>
          <td class="num font-mono"><strong>${fmtNum(r.rain_total_mm, 1)} mm</strong></td>
          <td class="num font-mono">${rAnomHtml}</td>
          <td class="num font-mono">${r.rain_days_02}</td>
          <td class="num font-mono">${r.frost_days}</td>
          <td class="num font-mono">${r.hot_days_30}</td>
          <td class="num font-mono">${r.tropical_nights}</td>
          <td class="num font-mono">${r.foehn_days}</td>
          <td class="num font-mono">${fmtNum(r.gdd_10_0, 1)}</td>
          <td class="num font-mono">${fmtNum(r.hdd_15_5, 1)}</td>
          <td class="num font-mono">${fmtNum(r.wind_gust_max_kmh, 1)} km/h</td>
        </tr>
      `;
    }).join('');
  }

  function updateSeasonalTable(comp) {
    const sc = comp?.seasonal_comparison;
    const tbody = document.getElementById('seasonal-table-body');
    if (!tbody || !sc) return;
    tbody.innerHTML = renderSeasonalTableRows(sc, STATE.seasonal.seasonFilter);
  }

  function renderSeasonalComparisonChart(comp) {
    const sc = comp?.seasonal_comparison;
    if (!sc || !sc.table) return;

    const pal = chartPalette();
    const filter = STATE.seasonal.seasonFilter || 'all';
    const metric = STATE.seasonal.metric || 'temp';
    const baseRef = sc.baseline_reference_2022_2025 || {};
    const seasonsMeta = sc.seasons_meta || [];

    const titleEl = document.getElementById('seasonal-chart-title');
    const subtitleEl = document.getElementById('seasonal-chart-subtitle');

    const yearColors = {
      2022: '#d97706',
      2023: '#2563eb',
      2024: '#059669',
      2025: '#7c3aed',
      2026: '#ea580c'
    };

    let chartConfig = null;

    if (filter === 'all') {
      const seasonLabels = seasonsMeta.map((s) => `${s.icon} ${s.name} (${s.code})`);
      const seasonIds = seasonsMeta.map((s) => s.id);

      const availableYears = [2022, 2023, 2024, 2025];
      if (STATE.include2026InComparisons) {
        availableYears.push(2026);
      }

      if (metric === 'temp') {
        if (titleEl) titleEl.textContent = 'Temperatura media estacional (°C) por trimestre OMM';
        if (subtitleEl) subtitleEl.textContent = 'Comparativa interanual de los 4 trimestres climáticos respecto a la normal interna 2022–2025';

        const datasets = availableYears.map((y) => {
          const color = yearColors[y] || '#64748b';
          const isProv = y === 2026;
          return {
            label: isProv ? `Año ${y} (prov.)` : `Año ${y}`,
            data: seasonIds.map((sId) => {
              const row = sc.table.find((r) => r.year === y && r.season_id === sId);
              return row ? row.temp_mean : null;
            }),
            backgroundColor: isProv ? 'rgba(234, 88, 12, 0.45)' : color,
            borderColor: color,
            borderWidth: isProv ? 2 : 1,
            borderDash: isProv ? [4, 4] : [],
            borderRadius: 4
          };
        });

        datasets.push({
          type: 'line',
          label: 'Normal Riotuerto (2022–2025)',
          data: seasonIds.map((sId) => baseRef[sId]?.temp_mean ?? null),
          borderColor: pal.text,
          borderWidth: 2,
          borderDash: [6, 4],
          pointRadius: 5,
          pointBackgroundColor: pal.text,
          fill: false
        });

        chartConfig = {
          type: 'bar',
          data: { labels: seasonLabels, datasets },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: 'top', labels: { color: pal.text, boxWidth: 14 } },
              tooltip: {
                callbacks: {
                  label: (ctx) => `${ctx.dataset.label}: ${fmtNum(ctx.parsed.y, 1)} °C`
                }
              }
            },
            scales: {
              x: { ticks: { color: pal.text, font: { weight: 'bold' } }, grid: { display: false } },
              y: {
                title: { display: true, text: 'Temperatura media (°C)', color: pal.text },
                ticks: { color: pal.text, callback: (v) => `${v} °C` },
                grid: { color: pal.grid }
              }
            }
          }
        };

      } else if (metric === 'rain') {
        if (titleEl) titleEl.textContent = 'Precipitación acumulada estacional (mm) por trimestre OMM';
        if (subtitleEl) subtitleEl.textContent = 'Lluvia total de cada trimestre frente al promedio histórico de referencia 2022–2025';

        const datasets = availableYears.map((y) => {
          const color = yearColors[y] || '#64748b';
          const isProv = y === 2026;
          return {
            label: isProv ? `Año ${y} (prov.)` : `Año ${y}`,
            data: seasonIds.map((sId) => {
              const row = sc.table.find((r) => r.year === y && r.season_id === sId);
              return row ? row.rain_total_mm : null;
            }),
            backgroundColor: isProv ? 'rgba(234, 88, 12, 0.45)' : color,
            borderColor: color,
            borderWidth: isProv ? 2 : 1,
            borderRadius: 4
          };
        });

        datasets.push({
          type: 'line',
          label: 'Normal Riotuerto (2022–2025)',
          data: seasonIds.map((sId) => baseRef[sId]?.rain_total_mm ?? null),
          borderColor: pal.text,
          borderWidth: 2,
          borderDash: [6, 4],
          pointRadius: 5,
          pointBackgroundColor: pal.text,
          fill: false
        });

        chartConfig = {
          type: 'bar',
          data: { labels: seasonLabels, datasets },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: 'top', labels: { color: pal.text, boxWidth: 14 } },
              tooltip: {
                callbacks: {
                  label: (ctx) => `${ctx.dataset.label}: ${fmtNum(ctx.parsed.y, 1)} mm`
                }
              }
            },
            scales: {
              x: { ticks: { color: pal.text, font: { weight: 'bold' } }, grid: { display: false } },
              y: {
                title: { display: true, text: 'Precipitación acumulada (mm)', color: pal.text },
                ticks: { color: pal.text, callback: (v) => `${v} mm` },
                grid: { color: pal.grid }
              }
            }
          }
        };

      } else if (metric === 'extremes') {
        if (titleEl) titleEl.textContent = 'Extremos térmicos: Heladas vs Calor por estación';
        if (subtitleEl) subtitleEl.textContent = 'Contraste estacional entre días de helada (≤0 °C) y días de calor (≥30 °C)';

        chartConfig = {
          type: 'bar',
          data: {
            labels: seasonLabels,
            datasets: [
              {
                label: 'Heladas (≤0 °C, media 2022–2025)',
                data: seasonIds.map((sId) => baseRef[sId]?.frost_days ?? 0),
                backgroundColor: 'rgba(2, 132, 199, 0.75)',
                borderColor: '#0284c7',
                borderWidth: 1,
                borderRadius: 4
              },
              {
                label: 'Días calor (≥30 °C, media 2022–2025)',
                data: seasonIds.map((sId) => baseRef[sId]?.hot_days_30 ?? 0),
                backgroundColor: 'rgba(234, 88, 12, 0.75)',
                borderColor: '#ea580c',
                borderWidth: 1,
                borderRadius: 4
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: 'top', labels: { color: pal.text, boxWidth: 14 } },
              tooltip: {
                callbacks: {
                  label: (ctx) => `${ctx.dataset.label}: ${fmtNum(ctx.parsed.y, 1)} días`
                }
              }
            },
            scales: {
              x: { ticks: { color: pal.text, font: { weight: 'bold' } }, grid: { display: false } },
              y: {
                title: { display: true, text: 'Días promedio por trimestre', color: pal.text },
                ticks: { color: pal.text },
                grid: { color: pal.grid }
              }
            }
          }
        };

      } else if (metric === 'foehn') {
        if (titleEl) titleEl.textContent = 'Días de viento sur / Foehn (surada) por trimestre OMM';
        if (subtitleEl) subtitleEl.textContent = 'Frecuencia de episodios de viento sur por estación en Riotuerto';

        const datasets = availableYears.map((y) => {
          const color = yearColors[y] || '#64748b';
          const isProv = y === 2026;
          return {
            label: isProv ? `Año ${y} (prov.)` : `Año ${y}`,
            data: seasonIds.map((sId) => {
              const row = sc.table.find((r) => r.year === y && r.season_id === sId);
              return row ? row.foehn_days : null;
            }),
            backgroundColor: isProv ? 'rgba(234, 88, 12, 0.45)' : color,
            borderColor: color,
            borderWidth: isProv ? 2 : 1,
            borderRadius: 4
          };
        });

        datasets.push({
          type: 'line',
          label: 'Promedio Riotuerto (2022–2025)',
          data: seasonIds.map((sId) => baseRef[sId]?.foehn_days ?? null),
          borderColor: pal.text,
          borderWidth: 2,
          borderDash: [6, 4],
          pointRadius: 5,
          pointBackgroundColor: pal.text,
          fill: false
        });

        chartConfig = {
          type: 'bar',
          data: { labels: seasonLabels, datasets },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: 'top', labels: { color: pal.text, boxWidth: 14 } },
              tooltip: {
                callbacks: {
                  label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y} días de surada`
                }
              }
            },
            scales: {
              x: { ticks: { color: pal.text, font: { weight: 'bold' } }, grid: { display: false } },
              y: {
                title: { display: true, text: 'Días de viento sur / Foehn', color: pal.text },
                ticks: { color: pal.text },
                grid: { color: pal.grid }
              }
            }
          }
        };
      }

    } else {
      const curSeasonMeta = seasonsMeta.find((s) => s.id === filter) || {
        name: filter,
        code: '',
        icon: '🍂',
        color: '#d97706'
      };
      const curBase = baseRef[filter] || {};

      let rows = sc.table.filter((r) => r.season_id === filter);
      if (!STATE.include2026InComparisons) {
        rows = rows.filter((r) => !r.is_provisional);
      }

      const yearLabels = rows.map((r) => (r.is_provisional ? `${r.year} (prov.)` : String(r.year)));
      const baseColor = curSeasonMeta.color || '#0284c7';

      if (metric === 'temp') {
        if (titleEl) titleEl.textContent = `${curSeasonMeta.icon} ${curSeasonMeta.name} (${curSeasonMeta.code}): Temperatura media interanual`;
        if (subtitleEl) subtitleEl.textContent = `Referencia normal 2022–2025: ${fmtNum(curBase.temp_mean, 1)} °C`;

        chartConfig = {
          type: 'bar',
          data: {
            labels: yearLabels,
            datasets: [
              {
                label: 'T. Media (°C)',
                data: rows.map((r) => r.temp_mean),
                backgroundColor: rows.map((r) => (r.is_provisional ? 'rgba(234, 88, 12, 0.45)' : baseColor)),
                borderColor: rows.map((r) => (r.is_provisional ? '#ea580c' : baseColor)),
                borderWidth: 1,
                borderRadius: 4
              },
              {
                type: 'line',
                label: `Normal 2022–2025 (${fmtNum(curBase.temp_mean, 1)} °C)`,
                data: rows.map(() => curBase.temp_mean),
                borderColor: pal.text,
                borderWidth: 2,
                borderDash: [6, 4],
                pointRadius: 0,
                fill: false
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: 'top', labels: { color: pal.text, boxWidth: 14 } },
              tooltip: {
                callbacks: {
                  afterLabel: (ctx) => {
                    const r = rows[ctx.dataIndex];
                    if (!r) return '';
                    return `T. Máx: ${fmtNum(r.temp_max_abs, 1)} °C | T. Mín: ${fmtNum(r.temp_min_abs, 1)} °C\nAnomalía: ${fmtSignNum(r.temp_anomaly, 2, '°C')}`;
                  }
                }
              }
            },
            scales: {
              x: { ticks: { color: pal.text, font: { weight: 'bold' } }, grid: { display: false } },
              y: {
                title: { display: true, text: 'Temperatura media (°C)', color: pal.text },
                ticks: { color: pal.text, callback: (v) => `${v} °C` },
                grid: { color: pal.grid }
              }
            }
          }
        };

      } else if (metric === 'rain') {
        if (titleEl) titleEl.textContent = `${curSeasonMeta.icon} ${curSeasonMeta.name} (${curSeasonMeta.code}): Precipitación acumulada interanual`;
        if (subtitleEl) subtitleEl.textContent = `Referencia normal 2022–2025: ${fmtNum(curBase.rain_total_mm, 1)} mm`;

        chartConfig = {
          type: 'bar',
          data: {
            labels: yearLabels,
            datasets: [
              {
                label: 'Precipitación (mm)',
                data: rows.map((r) => r.rain_total_mm),
                backgroundColor: rows.map((r) => (r.is_provisional ? 'rgba(2, 132, 199, 0.45)' : '#0284c7')),
                borderColor: '#0284c7',
                borderWidth: 1,
                borderRadius: 4
              },
              {
                type: 'line',
                label: `Normal 2022–2025 (${fmtNum(curBase.rain_total_mm, 1)} mm)`,
                data: rows.map(() => curBase.rain_total_mm),
                borderColor: pal.text,
                borderWidth: 2,
                borderDash: [6, 4],
                pointRadius: 0,
                fill: false
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: 'top', labels: { color: pal.text, boxWidth: 14 } },
              tooltip: {
                callbacks: {
                  afterLabel: (ctx) => {
                    const r = rows[ctx.dataIndex];
                    if (!r) return '';
                    return `Días lluvia: ${r.rain_days_02} | Máx 24h: ${fmtNum(r.max_daily_rain_mm, 1)} mm\nAnom: ${fmtSignNum(r.rain_anomaly_mm, 1, 'mm')} (${fmtSignNum(r.rain_anomaly_pct, 1, '%')})`;
                  }
                }
              }
            },
            scales: {
              x: { ticks: { color: pal.text, font: { weight: 'bold' } }, grid: { display: false } },
              y: {
                title: { display: true, text: 'Lluvia total (mm)', color: pal.text },
                ticks: { color: pal.text, callback: (v) => `${v} mm` },
                grid: { color: pal.grid }
              }
            }
          }
        };

      } else if (metric === 'extremes') {
        if (titleEl) titleEl.textContent = `${curSeasonMeta.icon} ${curSeasonMeta.name}: Indicadores extremos e impacto térmico`;
        if (subtitleEl) subtitleEl.textContent = `Días de helada (≤0 °C), días cálidos (≥25 °C / ≥30 °C) y noches tropicales (≥20 °C)`;

        chartConfig = {
          type: 'bar',
          data: {
            labels: yearLabels,
            datasets: [
              {
                label: 'Heladas (≤0 °C)',
                data: rows.map((r) => r.frost_days),
                backgroundColor: '#0284c7',
                borderRadius: 4
              },
              {
                label: 'Días cálidos (≥25 °C)',
                data: rows.map((r) => r.warm_days_25),
                backgroundColor: '#f59e0b',
                borderRadius: 4
              },
              {
                label: 'Días calor (≥30 °C)',
                data: rows.map((r) => r.hot_days_30),
                backgroundColor: '#ea580c',
                borderRadius: 4
              },
              {
                label: 'Noches trop. (≥20 °C)',
                data: rows.map((r) => r.tropical_nights),
                backgroundColor: '#7c3aed',
                borderRadius: 4
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: 'top', labels: { color: pal.text, boxWidth: 14 } }
            },
            scales: {
              x: { ticks: { color: pal.text, font: { weight: 'bold' } }, grid: { display: false } },
              y: {
                title: { display: true, text: 'Número de días', color: pal.text },
                ticks: { color: pal.text },
                grid: { color: pal.grid }
              }
            }
          }
        };

      } else if (metric === 'foehn') {
        if (titleEl) titleEl.textContent = `${curSeasonMeta.icon} ${curSeasonMeta.name}: Días de viento sur / Foehn y racha máxima`;
        if (subtitleEl) subtitleEl.textContent = `Días con viento del sector sur (SE-SO) y racha máxima observada (km/h)`;

        chartConfig = {
          type: 'bar',
          data: {
            labels: yearLabels,
            datasets: [
              {
                type: 'bar',
                label: 'Días Foehn (surada)',
                data: rows.map((r) => r.foehn_days),
                backgroundColor: '#d97706',
                yAxisID: 'y',
                borderRadius: 4
              },
              {
                type: 'line',
                label: 'Racha máxima (km/h)',
                data: rows.map((r) => r.wind_gust_max_kmh),
                borderColor: '#ef4444',
                backgroundColor: '#ef4444',
                yAxisID: 'y1',
                pointRadius: 4,
                borderWidth: 2
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: 'top', labels: { color: pal.text, boxWidth: 14 } },
              tooltip: {
                callbacks: {
                  afterLabel: (ctx) => {
                    const r = rows[ctx.dataIndex];
                    if (!r) return '';
                    return `Fecha racha: ${r.wind_gust_max_date || '—'}`;
                  }
                }
              }
            },
            scales: {
              x: { ticks: { color: pal.text, font: { weight: 'bold' } }, grid: { display: false } },
              y: {
                title: { display: true, text: 'Días Foehn', color: pal.text },
                ticks: { color: pal.text },
                grid: { color: pal.grid }
              },
              y1: {
                position: 'right',
                title: { display: true, text: 'Racha máx. (km/h)', color: pal.text },
                ticks: { color: pal.text },
                grid: { display: false }
              }
            }
          }
        };
      }
    }

    if (chartConfig) {
      createChart('seasonal_comp', 'chart-seasonal-comp', chartConfig);
    }
  }

  function initSeasonalComparison(comp) {
    const sc = comp?.seasonal_comparison;
    if (!sc) return;

    updateSeasonalTable(comp);
    renderSeasonalComparisonChart(comp);

    const tabBtns = document.querySelectorAll('.seasonal-tab-btn');
    tabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        tabBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        STATE.seasonal.seasonFilter = btn.dataset.season || 'all';
        updateSeasonalTable(comp);
        renderSeasonalComparisonChart(comp);
      });
    });

    const metricBtns = document.querySelectorAll('.seasonal-metric-btn');
    metricBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        metricBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        STATE.seasonal.metric = btn.dataset.metric || 'temp';
        renderSeasonalComparisonChart(comp);
      });
    });
  }

  /* ------------------------------------------------------------------------
   * MODELO TOPOCLIMÁTICO Y PERFIL OROGRÁFICO INTERACTIVO (EVO-018)
   * ------------------------------------------------------------------------ */
  const TOPOGRAPHY_DATA = {
    foehn: {
      id: 'foehn',
      title: 'Viento Sur y Efecto Foehn («La Surada cántabra»)',
      kicker: 'DINÁMICA 1: ADVECCIÓN DEL SUR Y SOTAVENTO ADIABÁTICO',
      color: '#ea580c',
      badge: '🔥 Efecto Foehn',
      physicalDescription: 'Cuando las borrascas o frentes atlánticos se aproximan por el oeste, se canaliza un potente flujo del sector Sur-Sudoeste sobre la cordillera cantábrica. El aire húmedo se ve forzado a ascender por la vertiente sur perdiendo humedad por condensación. Al rebasar el collado del Puerto de Alisas (674 m) y desplomarse hacia el fondo del valle del Covadal (115 m), experimenta compresión adiabática seca: se recalienta a un ritmo de +1 °C por cada 100 m de descenso y su humedad relativa se desploma violentamente.',
      territorialImpact: 'Provoca desecación repentina de praderas y vegetación arbórea, aceleración eólica canalizada por el desfiladero con rachas huracanadas en Barrio de Arriba y riesgo extremo de incendios forestales. Históricamente se conoce como «el viento de las castañas» por favorecer su caída en otoño, y altera el biorritmo vecinal por ionización positiva y subidas térmicas fulgurantes en pleno invierno.',
      records: [
        { label: 'Racha máxima histórica', val: '86,4 km/h', sub: 'SW · 27 de marzo de 2024' },
        { label: 'Desplome de humedad', val: '22 %', sub: 'Mínimo del registro con Surada' },
        { label: 'Salto térmico en 3h', val: '+12,8 °C', sub: 'Típico amanecer con viento sur' },
        { label: 'Noches tropicales', val: '4 noches', sub: 'Tª mín ≥20 °C en el año 2026' },
      ],
    },
    orographic: {
      id: 'orographic',
      title: 'Frentes del Noroeste y Retención Orográfica',
      kicker: 'DINÁMICA 2: ADVECCIÓN CANTÁBRICA Y ASCENSO FORZADO',
      color: '#0284c7',
      badge: '🌧️ Lluvia orográfica',
      physicalDescription: 'Tras el paso de frentes fríos o con vientos marítimos del noroeste («gallego»), masas de aire polar marítimo muy húmedas procedentes del golfo de Vizcaya penetran tierra adentro por el curso bajo del río Miera desde la ría de Cubas (a solo 14 km de Riotuerto). Al encontrarse con la rampa orográfica del valle del Covadal y la barrera frontal del Puerto de Alisas (674 m), el aire no puede rodear el relieve y asciende forzado. El enfriamiento por expansión adiabática satura la masa de aire, generando densas nubes estratiformes encajonadas y precipitaciones orográficas copiosas.',
      territorialImpact: 'Explica por qué Riotuerto registra pluviometrías anuales extraordinarias (entre 1.600 y más de 2.100 mm), superando con creces los acumulados de la franja costera de Santander. Proporciona una productividad forrajera excepcional para los pastizales cántabros y alimenta el caudal ininterrumpido del río Covadal y los acuíferos kársticos, aunque incrementa el riesgo de encharcamiento en vegas llanas en temporales de invierno.',
      records: [
        { label: 'Precipitación anual récord', val: '2.124,4 mm', sub: 'Año histórico 2024' },
        { label: 'Máxima lluvia en 24h', val: '83,8 mm', sub: '7 de octubre de 2026' },
        { label: 'Días de lluvia apreciable', val: '184 días', sub: 'Promedio anual ≥0,2 mm' },
        { label: 'Humedad relativa media', val: '82,5 %', sub: 'Régimen oceánico hiperhúmedo' },
      ],
    },
    inversion: {
      id: 'inversion',
      title: 'Noches Anticiclónicas e Inversión Térmica en Fondo de Valle',
      kicker: 'DINÁMICA 3: DRENAJE CATABÁTICO Y LAGO DE AIRE FRÍO',
      color: '#6366f1',
      badge: '❄️ Inversión térmica',
      physicalDescription: 'Bajo situaciones de alta presión invernal (anticiclón) con cielos completamente despejados y calma total de viento, el suelo de Riotuerto pierde calor de forma masiva por emisión de radiación infrarroja hacia el espacio exterior. El aire en contacto directo con las laderas y pastos se enfría bruscamente, haciéndose más denso y pesado. Por pura gravedad, este aire gélido drena lentamente laderas abajo («viento catabático») y se embalsa en el fondo cóncavo del valle en Barrio de Arriba (115 m) y La Cavada (80 m). Se invierte el gradiente térmico habitual.',
      territorialImpact: 'Genera las heladas más intensas del año en el fondo de valle (alcanzando hasta -3,1 °C) y formación de densa escarcha blanca sobre prados y techados, mientras que las viviendas situadas a media ladera (Monte, Rucandio) registran valores varios grados más suaves. Con frecuencia favorece la aparición de nieblas de irradiación matinales que se disipan rápidamente con el calentamiento solar.',
      records: [
        { label: 'Mínima absoluta del valle', val: '-3,1 °C', sub: '20 de enero de 2024' },
        { label: 'Días de helada al año', val: '8 a 14 días', sub: 'Tª mín ≤0 °C en Barrio de Arriba' },
        { label: 'Diferencial térmico fondo/ladera', val: '3 a 5 °C', sub: 'Más frío en el valle que en cumbres' },
        { label: 'Calma eólica nocturna', val: '<1,0 km/h', sub: 'Ausencia de turbulencia' },
      ],
    },
  };

  function generateTopographySVG(mode, isDark) {
    const skyFill = mode === 'foehn'
      ? (isDark ? 'url(#sky-grad-foehn-dark)' : 'url(#sky-grad-foehn)')
      : mode === 'orographic'
      ? (isDark ? 'url(#sky-grad-orographic-dark)' : 'url(#sky-grad-orographic)')
      : 'url(#sky-grad-inversion)';

    const terrainFill = isDark ? 'url(#terrain-grad-dark)' : 'url(#terrain-grad)';
    const gridLineColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.07)';
    const textMutedColor = isDark ? '#94a3b8' : '#64748b';
    const textPrimaryColor = isDark ? '#f8fafc' : '#0f172a';

    let skyDynamicHtml = '';
    let overlayDynamicHtml = '';

    if (mode === 'foehn') {
      skyDynamicHtml = `
        <g class="topo-flow-left">
          <path d="M 855,105 Q 805,45 745,80 Q 640,155 540,215 Q 470,248 430,265" fill="none" stroke="#ea580c" stroke-width="3.5" stroke-linecap="round" />
          <path d="M 865,135 Q 815,75 765,100 Q 660,175 565,230 Q 495,258 440,270" fill="none" stroke="#f97316" stroke-width="2.5" stroke-linecap="round" />
          <path d="M 845,75 Q 795,25 730,60 Q 625,135 525,200 Q 455,235 395,255" fill="none" stroke="#fbbf24" stroke-width="2" stroke-linecap="round" />
        </g>
        <polygon points="425,268 440,260 435,275" fill="#ea580c" />
        <ellipse cx="800" cy="50" rx="35" ry="12" fill="${isDark ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.85)'}" />
        <ellipse cx="785" cy="48" rx="20" ry="9" fill="${isDark ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.95)'}" />
      `;

      overlayDynamicHtml = `
        <text x="855" y="18" font-size="11" font-weight="800" fill="#ea580c" text-anchor="end">🔥 Viento Sur / Ábrego ⮨</text>
        <g transform="translate(460, 78)">
          <rect x="0" y="0" width="220" height="28" rx="5" fill="${isDark ? 'rgba(30,10,5,0.92)' : 'rgba(255,247,237,0.96)'}" stroke="#ea580c" stroke-width="1.2" />
          <text x="110" y="18" font-size="11" font-weight="700" text-anchor="middle" fill="${isDark ? '#fed7aa' : '#9a3412'}">Descenso adiabático (+1 °C/100m)</text>
        </g>
      `;
    } else if (mode === 'orographic') {
      skyDynamicHtml = `
        <g class="topo-flow-right">
          <path d="M 65,275 Q 180,270 290,255 Q 410,240 520,205 Q 630,155 710,95 Q 760,65 770,78" fill="none" stroke="#0284c7" stroke-width="3.5" stroke-linecap="round" />
          <path d="M 65,245 Q 180,240 300,225 Q 420,205 530,170 Q 640,125 720,75" fill="none" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" />
        </g>
        <polygon points="770,78 757,71 759,86" fill="#0284c7" />
        <path d="M 360,170 Q 420,130 480,140 Q 540,110 610,120 Q 680,80 750,90 Q 790,50 830,70 L 830,140 Q 720,160 580,210 Q 450,250 360,250 Z" fill="${isDark ? 'rgba(100,116,139,0.45)' : 'rgba(203,213,225,0.75)'}" />
        <ellipse cx="520" cy="130" rx="60" ry="25" fill="${isDark ? 'rgba(148,163,184,0.35)' : 'rgba(241,245,249,0.85)'}" />
        <ellipse cx="640" cy="100" rx="70" ry="30" fill="${isDark ? 'rgba(148,163,184,0.4)' : 'rgba(241,245,249,0.9)'}" />
        <ellipse cx="740" cy="75" rx="55" ry="22" fill="${isDark ? 'rgba(148,163,184,0.45)' : 'rgba(241,245,249,0.95)'}" />
        <g stroke="#38bdf8" stroke-width="1.8" stroke-dasharray="4 6" opacity="0.85">
          <line x1="390" y1="180" x2="380" y2="245" />
          <line x1="420" y1="170" x2="410" y2="240" />
          <line x1="445" y1="165" x2="435" y2="242" />
          <line x1="470" y1="160" x2="460" y2="235" />
          <line x1="500" y1="155" x2="490" y2="228" />
          <line x1="535" y1="150" x2="525" y2="218" />
          <line x1="570" y1="140" x2="560" y2="205" />
        </g>
      `;

      overlayDynamicHtml = `
        <text x="55" y="18" font-size="11" font-weight="800" fill="#0284c7">🌊 Flujo oceánico húmedo ⮞</text>
        <g transform="translate(190, 78)">
          <rect x="0" y="0" width="230" height="28" rx="5" fill="${isDark ? 'rgba(15,23,42,0.92)' : 'rgba(240,249,255,0.96)'}" stroke="#0284c7" stroke-width="1.2" />
          <text x="115" y="18" font-size="11" font-weight="700" text-anchor="middle" fill="${isDark ? '#bae6fd' : '#0369a1'}">Retención y condensación forzada</text>
        </g>
      `;
    } else if (mode === 'inversion') {
      skyDynamicHtml = `
        <circle cx="120" cy="55" r="14" fill="${isDark ? '#fef08a' : '#fde047'}" />
        <circle cx="126" cy="51" r="13" fill="${isDark ? '#0f172a' : '#1e1b4b'}" />
        <text x="210" y="60" fill="#fef08a" font-size="10" opacity="0.8">★</text>
        <text x="340" y="45" fill="#fef08a" font-size="8" opacity="0.6">★</text>
        <text x="510" y="55" fill="#fef08a" font-size="12" opacity="0.85">★</text>
        <text x="670" y="40" fill="#fef08a" font-size="9" opacity="0.7">★</text>
        <text x="770" y="48" fill="#fef08a" font-size="11" opacity="0.8">★</text>
        <path d="M 720,135 Q 670,180 620,225" fill="none" stroke="#38bdf8" stroke-width="2" stroke-dasharray="3 3" />
        <polygon points="620,225 628,217 631,225" fill="#38bdf8" />
        <path d="M 590,235 Q 530,250 480,265" fill="none" stroke="#38bdf8" stroke-width="2" stroke-dasharray="3 3" />
        <polygon points="480,265 490,260 491,268" fill="#38bdf8" />
        <path d="M 170,290 Q 280,284 390,270 Q 500,260 550,248 L 550,312 L 170,312 Z" fill="url(#cold-lake-grad)" />
        <path d="M 190,282 Q 220,278 250,282 T 310,282 T 370,282" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2" />
        <path d="M 210,292 Q 240,288 270,292 T 330,292 T 390,292" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="2" />
      `;

      overlayDynamicHtml = `
        <g transform="translate(260, 78)">
          <rect x="0" y="0" width="270" height="28" rx="5" fill="rgba(15,23,42,0.94)" stroke="#6366f1" stroke-width="1.2" />
          <text x="135" y="18" font-size="11" font-weight="700" text-anchor="middle" fill="#c7d2fe">Inversión nocturna: Lago de aire frío</text>
        </g>
        <g transform="translate(180, 240)">
          <rect x="0" y="0" width="125" height="24" rx="4" fill="rgba(15,23,42,0.94)" stroke="#38bdf8" stroke-width="1.2" />
          <text x="62" y="16" font-size="10" font-weight="700" text-anchor="middle" fill="#67e8f9">❄ Fondo: -3,1 °C</text>
        </g>
        <g transform="translate(570, 135)">
          <line x1="65" y1="24" x2="65" y2="46" stroke="#f59e0b" stroke-width="1.2" stroke-dasharray="2 2" />
          <circle cx="65" cy="46" r="3" fill="#f59e0b" />
          <rect x="0" y="0" width="130" height="24" rx="4" fill="rgba(15,23,42,0.94)" stroke="#f59e0b" stroke-width="1.2" />
          <text x="65" y="16" font-size="10" font-weight="700" text-anchor="middle" fill="#fde68a">🌡️ Ladera: +4,5 °C</text>
        </g>
      `;
    }

    return `
      <svg class="topography-svg" viewBox="0 0 900 350" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Perfil orográfico y modelo microclimático del valle de Riotuerto">
        <defs>
          <linearGradient id="sky-grad-foehn" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#fffbeb" />
            <stop offset="60%" stop-color="#fef3c7" />
            <stop offset="100%" stop-color="#fed7aa" />
          </linearGradient>
          <linearGradient id="sky-grad-foehn-dark" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#1c100c" />
            <stop offset="60%" stop-color="#2d130a" />
            <stop offset="100%" stop-color="#4a1809" />
          </linearGradient>
          <linearGradient id="sky-grad-orographic" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#f1f5f9" />
            <stop offset="50%" stop-color="#cbd5e1" />
            <stop offset="100%" stop-color="#94a3b8" />
          </linearGradient>
          <linearGradient id="sky-grad-orographic-dark" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#0b1120" />
            <stop offset="50%" stop-color="#1e293b" />
            <stop offset="100%" stop-color="#334155" />
          </linearGradient>
          <linearGradient id="sky-grad-inversion" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#020617" />
            <stop offset="50%" stop-color="#0f172a" />
            <stop offset="100%" stop-color="#1e1b4b" />
          </linearGradient>
          <linearGradient id="terrain-grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#15803d" />
            <stop offset="45%" stop-color="#166534" />
            <stop offset="80%" stop-color="#475569" />
            <stop offset="100%" stop-color="#334155" />
          </linearGradient>
          <linearGradient id="terrain-grad-dark" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#14532d" />
            <stop offset="45%" stop-color="#166534" />
            <stop offset="80%" stop-color="#334155" />
            <stop offset="100%" stop-color="#1e293b" />
          </linearGradient>
          <linearGradient id="cold-lake-grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.1" />
            <stop offset="70%" stop-color="#0284c7" stop-opacity="0.38" />
            <stop offset="100%" stop-color="#0369a1" stop-opacity="0.65" />
          </linearGradient>
        </defs>

        <rect x="40" y="15" width="830" height="300" rx="8" fill="${skyFill}" />
        <line x1="40" y1="104" x2="870" y2="104" stroke="${gridLineColor}" stroke-dasharray="3 3" />
        <text x="35" y="107" font-size="9" fill="${textMutedColor}" text-anchor="end">600m</text>
        <line x1="40" y1="173" x2="870" y2="173" stroke="${gridLineColor}" stroke-dasharray="3 3" />
        <text x="35" y="176" font-size="9" fill="${textMutedColor}" text-anchor="end">400m</text>
        <line x1="40" y1="241" x2="870" y2="241" stroke="${gridLineColor}" stroke-dasharray="3 3" />
        <text x="35" y="244" font-size="9" fill="${textMutedColor}" text-anchor="end">200m</text>
        <line x1="40" y1="310" x2="870" y2="310" stroke="${gridLineColor}" />
        <text x="35" y="313" font-size="9" fill="${textMutedColor}" text-anchor="end">0m</text>

        ${skyDynamicHtml}

        <path d="M 40,310 L 70,310 Q 130,306 180,301 Q 250,293 310,282 Q 370,274 430,270 Q 510,260 600,210 Q 690,150 770,78 Q 815,78 860,170 L 860,320 L 40,320 Z" fill="${terrainFill}" />
        <path d="M 40,310 Q 120,308 180,303 Q 250,295 310,284 Q 370,276 430,272" fill="none" stroke="#38bdf8" stroke-width="2.5" opacity="0.75" />

        <circle cx="70" cy="310" r="3" fill="#38bdf8" />
        <text x="70" y="328" font-size="10" font-weight="600" fill="${textMutedColor}" text-anchor="middle">Mar Cantábrico (0 m)</text>

        <circle cx="310" cy="282" r="3" fill="${textPrimaryColor}" />
        <line x1="310" y1="282" x2="310" y2="295" stroke="${textMutedColor}" stroke-width="1" />
        <text x="310" y="307" font-size="10" font-weight="600" fill="${textPrimaryColor}" text-anchor="middle">La Cavada (80 m)</text>

        <circle cx="770" cy="78" r="4" fill="#f59e0b" />
        <line x1="770" y1="78" x2="770" y2="58" stroke="#f59e0b" stroke-width="1.2" />
        <text x="770" y="50" font-size="10" font-weight="700" fill="${textPrimaryColor}" text-anchor="middle">Puerto de Alisas (674 m)</text>

        <text x="55" y="34" font-size="11" font-weight="700" fill="${textMutedColor}">⮜ NORTE (Hacia la costa)</text>
        <text x="855" y="34" font-size="11" font-weight="700" fill="${textMutedColor}" text-anchor="end">SUR (Hacia la cordillera) ⮞</text>

        <g transform="translate(430, 270)">
          <circle cx="0" cy="-14" r="6" fill="${mode === 'foehn' ? '#ea580c' : mode === 'orographic' ? '#0284c7' : '#06b6d4'}" class="topo-pulse-circle" />
          <line x1="0" y1="0" x2="0" y2="-14" stroke="${textPrimaryColor}" stroke-width="2" />
          <circle cx="0" cy="-14" r="3.5" fill="${mode === 'foehn' ? '#ea580c' : mode === 'orographic' ? '#0284c7' : '#06b6d4'}" stroke="#ffffff" stroke-width="1.2" />
          <line x1="-5" y1="-14" x2="5" y2="-14" stroke="#ffffff" stroke-width="1.2" />
          <g transform="translate(0, -32)">
            <rect x="-85" y="-12" width="170" height="22" rx="4" fill="${isDark ? 'rgba(15,23,42,0.92)' : 'rgba(255,255,255,0.95)'}" stroke="${mode === 'foehn' ? '#ea580c' : mode === 'orographic' ? '#0284c7' : '#06b6d4'}" stroke-width="1.5" />
            <text x="0" y="3" font-size="10" font-weight="800" text-anchor="middle" fill="${textPrimaryColor}">📍 Barrio de Arriba (115 m)</text>
          </g>
        </g>

        ${overlayDynamicHtml}
      </svg>
    `;
  }

  function renderTopographyModule(mode) {
    const topoMode = mode || STATE.topographyMode || 'foehn';
    STATE.topographyMode = topoMode;
    const isDark = STATE.theme === 'dark';
    const data = TOPOGRAPHY_DATA[topoMode] || TOPOGRAPHY_DATA.foehn;

    ['foehn', 'orographic', 'inversion'].forEach((m) => {
      const btn = document.getElementById(`btn-topo-${m}`);
      if (btn) {
        if (m === topoMode) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      }
    });

    const svgContainer = document.getElementById('topography-svg-container');
    if (svgContainer) {
      svgContainer.innerHTML = generateTopographySVG(topoMode, isDark);
    }

    const explanationPanel = document.getElementById('topography-explanation-panel');
    if (explanationPanel) {
      const pillsHtml = data.records.map((r) => `
        <div class="topo-metric-pill">
          <span class="topo-metric-val">${escapeHtml(r.val)}</span>
          <span class="topo-metric-lbl">${escapeHtml(r.label)}</span>
          <span style="font-size:0.68rem;color:var(--txt-muted);margin-top:2px">${escapeHtml(r.sub)}</span>
        </div>
      `).join('');

      explanationPanel.innerHTML = `
        <div class="topo-explanation-card">
          <h4 class="topo-card-title">
            <span style="color:${data.color}">${data.badge}</span> ${escapeHtml(data.title)}
          </h4>
          <p class="topo-card-desc">
            ${data.physicalDescription}
          </p>
        </div>

        <div class="topo-explanation-card">
          <h4 class="topo-card-title">
            🌿 Impacto en el territorio y la vida cotidiana
          </h4>
          <p class="topo-card-desc">
            ${data.territorialImpact}
          </p>
          <div class="topo-metrics-grid">
            ${pillsHtml}
          </div>
        </div>
      `;
    }
  }

  function initTopographyModule() {
    ['foehn', 'orographic', 'inversion'].forEach((m) => {
      const btn = document.getElementById(`btn-topo-${m}`);
      if (btn) {
        btn.addEventListener('click', () => {
          renderTopographyModule(m);
        });
      }
    });
    renderTopographyModule(STATE.topographyMode || 'foehn');
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
        <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border-color);font-size:0.92rem;color:var(--txt-secondary);line-height:1.6">
          <p style="margin-bottom:8px">
            Cada cifra publicada en este archivo procede directamente de los registros instrumentales validados,
            distinguiendo con rigor entre observaciones directas, indicadores derivados y contexto sinóptico.
          </p>
          <p style="margin:0">
            El archivo ofrece <strong>comparaciones anuales muy útiles</strong> para examinar la variabilidad meteorológica reciente en Riotuerto,
            pero <strong>todavía no permite establecer <abbr class="glossary-term" data-term="normal_climatologica">normales climatológicas de 30 años</abbr> ni atribuir tendencias climáticas seculares con garantías estadísticas</strong>.
          </p>
        </div>
      </article>

      <div class="stats-two-col">
        <div class="chronicle-card">
          <h3>📍 Emplazamiento geográfico y microclima del valle</h3>
          <p style="margin-bottom:10px">
            La estación está situada en una pradera abierta en la localidad de <strong>${escapeHtml(st.location.locality)}</strong>,
            perteneciente al municipio de <strong>${escapeHtml(st.location.municipality)} (${escapeHtml(st.location.region)})</strong>,
            en la comarca histórica de <strong>Trasmiera</strong> (valle medio-alto del río Miera, entre <strong>La Cavada</strong> y el <strong>puerto de Alisas</strong>),
            en las coordenadas <a href="${idx.station.links.openstreetmap || 'https://www.openstreetmap.org/?mlat=43.341&mlon=-3.670#map=15/43.341/-3.670'}" target="_blank" rel="noopener noreferrer" title="Ver localización en OpenStreetMap"><code>43.341° N, 3.670° W</code></a> (WGS84: <code>43.341, -3.670</code>) y a una altitud de
            <strong>115 metros sobre el nivel del mar</strong>.
          </p>
          <p style="margin-bottom:10px">
            Ubicada en el fondo del <strong>valle del río Covadal</strong> (afluente de la cuenca del Miera), a 14 km de la costa
            cantábrica y a 5 km del puerto de Alisas, presenta un microclima de valle muy definido condicionado por el relieve:
          </p>
          <ul class="location-highlights" style="margin-bottom:14px">
            <li><strong><abbr class="glossary-term" data-term="lluvia_orografica">Retención orográfica Cantábrica</abbr>:</strong> las masas de aire húmedo del noroeste procedentes del mar Cantábrico quedan retenidas contra la barrera montañosa, generando una elevada pluviosidad (habitualmente de 1.600 a más de 2.100 mm anuales).</li>
            <li><strong><abbr class="glossary-term" data-term="efecto_foehn">Efecto Foehn</abbr> (<abbr class="glossary-term" data-term="surada">«suradas»</abbr>):</strong> cuando el viento sopla del sur desciende recalentado desde la divisoria de la cordillera, disparando bruscamente las temperaturas y hundiendo la humedad relativa.</li>
            <li><strong><abbr class="glossary-term" data-term="inversion_termica">Inversión térmica nocturna</abbr>:</strong> en noches calmas y despejadas el aire frío drena hacia el fondo del valle, provocando heladas locales mientras las laderas permanecen más templadas.</li>
            <li><strong>Distancias clave:</strong> a 5 km de Alisas (674 m), a 7 km de Liérganes, a 16 km del aeropuerto de Santander y a 23 km de la ciudad de Santander.</li>
          </ul>

          <div class="station-location-map-wrap" style="margin-top:14px">
            <iframe
              class="station-osm-map"
              style="height:280px"
              src="https://www.openstreetmap.org/export/embed.html?bbox=-3.770%2C43.295%2C-3.560%2C43.385&amp;layer=mapnik&amp;marker=43.341%2C-3.670"
              title="Mapa topográfico de localización de Barrio de Arriba (Riotuerto, Cantabria)"
              loading="lazy">
            </iframe>
            <div class="map-link-bar">
              <a href="https://www.openstreetmap.org/?mlat=43.341&mlon=-3.670#map=15/43.341/-3.670" target="_blank" rel="noopener noreferrer">
                Explorar mapa en pantalla completa en OpenStreetMap ↗
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

          <figure class="station-photo-figure" style="margin-top:14px">
            <div class="station-photo-wrap">
              <span class="station-photo-badge">📷 29 nov. 2020 · Instalación</span>
              <picture>
                <source srcset="./assets/img/estacion-meteorologica-barrio-de-arriba.webp" type="image/webp">
                <img
                  src="./assets/img/estacion-meteorologica-barrio-de-arriba.jpg"
                  alt="Estación meteorológica Sainlogic WS3500 instalada en Barrio de Arriba (Riotuerto, Cantabria)"
                  class="station-photo-img"
                  loading="lazy"
                  width="1600"
                  height="1200"
                >
              </picture>
            </div>
            <figcaption class="station-photo-caption">
              <strong>Estación Sainlogic WS3500 en Barrio de Arriba (115 m s. n. m.).</strong> Fotografía documental tomada el 29 de noviembre de 2020 a las 12:40 h durante el izado del mástil e inicio formal de la serie histórica de observaciones en Riotuerto.
            </figcaption>
            <div class="station-photo-link-bar">
              <a href="./assets/img/estacion-meteorologica-barrio-de-arriba.jpg" target="_blank" rel="noopener noreferrer">
                Ver fotografía original en alta resolución (1600×1200) ↗
              </a>
            </div>
          </figure>
        </div>
      </div>

      <!-- Modelo topoclimático y perfil orográfico interactivo del valle del Covadal (EVO-018) -->
      <section class="section-block topography-section" id="topography-section">
        <div class="section-header">
          <div>
            <div class="editorial-kicker">MODELO TOPOCLIMÁTICO Y PERFIL TRANSVERSAL DEL MUNICIPIO</div>
            <h3 class="section-title">Perfil orográfico y dinámicas atmosféricas de Riotuerto</h3>
            <p class="section-subtitle">Visualización interactiva: cómo el relieve del valle del Covadal modula la Surada (efecto Foehn), las lluvias cantábricas y las inversiones térmicas</p>
          </div>
          <div class="topography-mode-selector" id="topography-mode-selector">
            <button type="button" class="topography-mode-btn active" data-topo-mode="foehn" id="btn-topo-foehn">
              🔥 1. Viento Sur (Efecto Foehn)
            </button>
            <button type="button" class="topography-mode-btn" data-topo-mode="orographic" id="btn-topo-orographic">
              🌧️ 2. Frentes del NO (Lluvia orográfica)
            </button>
            <button type="button" class="topography-mode-btn" data-topo-mode="inversion" id="btn-topo-inversion">
              ❄️ 3. Noche anticiclónica (Inversión térmica)
            </button>
          </div>
        </div>

        <div class="topography-card">
          <div class="topography-svg-wrap" id="topography-svg-container"></div>
          <div class="topography-explanation-panel" id="topography-explanation-panel"></div>
        </div>
      </section>

      <div class="callout callout-warning" style="margin-top:24px; margin-bottom:28px; border-left-width:5px; padding:18px 22px">
        <h4 style="font-size:1rem; font-weight:700; margin-bottom:8px; color:var(--txt-primary)">
          ⚠️ Representatividad climatológica y atribución de tendencias (Normativa OMM)
        </h4>
        <p style="margin-bottom:8px; line-height:1.55">
          Este archivo proporciona <strong>comparaciones anuales muy útiles</strong> para documentar la meteorología observada y estudiar la variabilidad reciente del municipio de Riotuerto.
          Sin embargo, con registros consolidados desde 2022, <strong>la web todavía no permite establecer normales climatológicas oficiales de 30 años ni atribuir tendencias climáticas sólidas con garantías estadísticas</strong>.
        </p>
        <p style="font-size:0.86rem; color:var(--txt-secondary); margin:0">
          De acuerdo con los criterios de la Organización Meteorológica Mundial (OMM), las normales de referencia y la detección de señales climáticas a largo plazo exigen un periodo mínimo de 30 años de observaciones homogéneas. Las medias publicadas en este portal describen únicamente la línea base de la ventana temporal observada (2022–2025).
        </p>
      </div>

      <!-- Tabla de auditoría de cobertura y calidad por año -->
      <section class="section-block">
        <div class="section-header">
          <div>
            <h3 class="section-title">Auditoría de cobertura temporal y depuración por año</h3>
            <p class="section-subtitle">Estado real comprobado de los archivos CSV originales y resultados del pipeline de validación</p>
          </div>
          <div>
            <button type="button" id="btn-export-audit-xlsx" class="btn btn-excel">
              📊 Exportar auditoría a Excel (.xlsx)
            </button>
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

      <!-- EVO-010: Interoperabilidad SIG (GeoJSON), JSON Schema y Datos Abiertos -->
      <section class="section-block" aria-labelledby="sec-opendata-sig">
        <div class="section-header">
          <div>
            <h3 id="sec-opendata-sig" class="section-title">🗺️ Interoperabilidad SIG (GeoJSON), esquema técnico y datos abiertos</h3>
            <p class="section-subtitle">
              Recursos estandarizados para Sistemas de Información Geográfica (QGIS, ArcGIS) y análisis científico en Python o R
            </p>
          </div>
        </div>

        <div class="chronicle-grid" style="margin-bottom: 18px;">
          <div class="chronicle-card">
            <h3>1. Capa vectorial GeoJSON para SIG (<code>station.geojson</code>)</h3>
            <p>
              Publicada bajo el estándar internacional <strong>RFC 7946 (GeoJSON)</strong> en coordenadas geodésicas
              <strong>WGS84 (<code>EPSG:4326</code>)</strong>. Contiene la entidad puntual de la estación de Barrio de Arriba
              (<code>[-3.670, 43.341, 115]</code>) con una tabla de atributos completa (promedios 2022–2025, mediana térmica,
              pluviosidad, grados día <code>HDD/CDD/GDD</code> y récords absolutos), acompañada de los hitos fisiográficos
              que modulan el valle (divisoria del <strong>puerto de Alisas</strong> a 674 m s. n. m. y vega del Miera en
              <strong>La Cavada</strong> a 62 m s. n. m.). Puede arrastrarse directamente sobre <strong>QGIS</strong> o abrirse
              en el visor cartográfico nativo de GitHub.
            </p>
            <div class="btn-group" style="margin-top: 12px;">
              <a href="./data/station.geojson" download="meteoriotuerto_station.geojson" class="btn btn-primary">⬇ Descargar ficha SIG (station.geojson)</a>
              <a href="https://github.com/egofer/meteoriotuerto-web/blob/main/data/station.geojson" target="_blank" rel="noopener noreferrer" class="btn">Ver mapa GeoJSON en GitHub ↗</a>
            </div>
          </div>

          <div class="chronicle-card">
            <h3>2. Contrato y diccionario JSON Schema (<code>schema.json</code>)</h3>
            <p>
              Especificación formal <strong>JSON Schema (Draft 2020-12)</strong> que documenta la estructura de los 11 archivos
              de la API estática, los invariantes físicos de validación y el diccionario completo de las <strong>19 variables
              meteorológicas y bioclimáticas</strong> (unidades en el SI/OMM, precisión decimal, sensores y fórmulas de cálculo).
              Facilita la ingesta directa y validación automática desde cuadernos <strong>Jupyter, Python (<code>pandas</code> /
              <code>geopandas</code>) y R</strong>.
            </p>
            <div class="btn-group" style="margin-top: 12px;">
              <a href="./data/schema.json" download="meteoriotuerto_schema.json" class="btn btn-primary">⬇ Descargar esquema técnico (schema.json)</a>
              <a href="./data/schema.json" target="_blank" rel="noopener" class="btn">Explorar diccionario JSON ↗</a>
            </div>
          </div>
        </div>

        <div class="section-header" style="margin-top: 24px;">
          <div>
            <h3 class="section-title">Descarga completa de productos de datos y repositorio fuente</h3>
            <p class="section-subtitle">Archivos JSON y GeoJSON estáticos generados de forma reproducible y auditada</p>
          </div>
        </div>
        <div class="btn-group">
          <a href="./data/index.json" download="meteoriotuerto_index.json" class="btn btn-primary">⬇ Índice general (index.json)</a>
          <a href="./data/station.geojson" download="meteoriotuerto_station.geojson" class="btn">⬇ Capa SIG (station.geojson)</a>
          <a href="./data/schema.json" download="meteoriotuerto_schema.json" class="btn">⬇ Esquema (schema.json)</a>
          <a href="./data/records.json" download="meteoriotuerto_records.json" class="btn">⬇ Récords e históricos (records.json)</a>
          <a href="./data/comparisons.json" download="meteoriotuerto_comparisons.json" class="btn">⬇ Comparativas (comparisons.json)</a>
          <a href="./data/glossary.json" download="meteoriotuerto_glossary.json" class="btn">⬇ Glosario y conceptos (glossary.json)</a>
          <a href="https://github.com/egofer/meteoriotuerto/" target="_blank" rel="noopener noreferrer" class="btn">Repositorio CSV original en GitHub ↗</a>
        </div>
      </section>
    `;

    document.getElementById('btn-export-audit-xlsx')?.addEventListener('click', () => {
      exportAuditQualityToExcel(STATE.cache.almanacs, idx.series_overview);
    });

    initTopographyModule();
  }

  /* ------------------------------------------------------------------------
   * Modal interactivo de definiciones y conceptos meteorológicos (EVO-008)
   * ------------------------------------------------------------------------ */
  async function openTermModal(termId) {
    if (!termId) return;
    const glo = await ensureGlossaryLoaded();
    const term = glo.terms.find((t) => t.id === termId);
    if (!term) return;

    const modal = document.getElementById('term-modal');
    const backdrop = document.getElementById('term-modal-backdrop');
    if (!modal || !backdrop) return;

    const category = glo.categories.find((c) => c.id === term.category_id);
    const catBadge = document.getElementById('modal-term-category');
    if (catBadge) {
      catBadge.textContent = category ? `${category.icon} ${category.name}` : term.category_id;
    }

    const titleEl = document.getElementById('modal-term-title');
    if (titleEl) titleEl.textContent = term.term;

    const threshEl = document.getElementById('modal-term-threshold');
    if (threshEl) {
      if (term.threshold) {
        threshEl.hidden = false;
        threshEl.textContent = `Umbral / Criterio: ${term.threshold}`;
      } else {
        threshEl.hidden = true;
      }
    }

    const shortEl = document.getElementById('modal-term-short');
    if (shortEl) shortEl.textContent = term.short_definition;

    const bodyEl = document.getElementById('modal-term-body');
    if (bodyEl) {
      bodyEl.innerHTML = `<p>${escapeHtml(term.full_definition)}</p>`;
    }

    const rioEl = document.getElementById('modal-term-riotuerto');
    if (rioEl) rioEl.textContent = term.riotuerto_context;

    const footerEl = document.getElementById('modal-term-footer');
    const seeAlsoContainer = document.getElementById('modal-term-see-also');
    if (footerEl && seeAlsoContainer) {
      if (term.see_also && term.see_also.length > 0) {
        footerEl.hidden = false;
        seeAlsoContainer.innerHTML = term.see_also.map((saId) => {
          const saTerm = glo.terms.find((t) => t.id === saId);
          const saLabel = saTerm ? saTerm.term : saId;
          return `<button type="button" class="term-chip-link" data-open-term="${escapeHtml(saId)}">↳ ${escapeHtml(saLabel)}</button>`;
        }).join('');
      } else {
        footerEl.hidden = true;
      }
    }

    backdrop.hidden = false;
    modal.setAttribute('open', '');
    document.body.style.overflow = 'hidden';
  }

  function closeTermModal() {
    const modal = document.getElementById('term-modal');
    const backdrop = document.getElementById('term-modal-backdrop');
    if (modal) modal.removeAttribute('open');
    if (backdrop) backdrop.hidden = true;
    document.body.style.overflow = '';
  }

  /* ------------------------------------------------------------------------
   * VISTA 7: GLOSARIO METEOROLÓGICO Y DIVULGATIVO (EVO-008)
   * ------------------------------------------------------------------------ */
  async function renderGlosario() {
    const glo = await ensureGlossaryLoaded();
    const container = document.getElementById('view-glosario');
    if (!container) return;

    const activeCat = STATE.glossary.categoryFilter || 'all';
    const query = (STATE.glossary.searchQuery || '').trim().toLowerCase();

    // Filtro reactivo
    let filteredTerms = glo.terms.filter((t) => {
      if (activeCat !== 'all' && t.category_id !== activeCat) {
        return false;
      }
      if (!query) return true;
      const haystack = [
        t.term,
        t.short_definition,
        t.full_definition,
        t.riotuerto_context,
        t.threshold || '',
        ...(t.aliases || []),
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });

    // Ordenar alfabéticamente por nombre del término
    filteredTerms.sort((a, b) => a.term.localeCompare(b.term, 'es'));

    // Categorías con conteos
    const catChipsHtml = [
      `<button type="button" class="glossary-filter-chip ${activeCat === 'all' ? 'active' : ''}" data-cat="all">Todas (${glo.terms.length})</button>`,
      ...glo.categories.map((c) => {
        const count = glo.terms.filter((t) => t.category_id === c.id).length;
        const isActive = activeCat === c.id;
        return `<button type="button" class="glossary-filter-chip ${isActive ? 'active' : ''}" data-cat="${c.id}">${c.icon} ${c.name} (${count})</button>`;
      }),
    ].join('');

    // Tarjetas de términos
    const termsHtml = filteredTerms.length === 0
      ? `<div class="empty-state" style="grid-column: 1 / -1; padding: 48px 24px; text-align: center;">
           <p style="font-size: 1.1rem; color: var(--txt-muted);">No se han encontrado conceptos coincidentes con la búsqueda <strong>"${escapeHtml(query)}"</strong>.</p>
           <button type="button" class="btn btn-primary" id="btn-reset-glossary-search" style="margin-top: 12px;">Restablecer búsqueda</button>
         </div>`
      : filteredTerms.map((t) => {
          const cat = glo.categories.find((c) => c.id === t.category_id);
          const catLabel = cat ? `${cat.icon} ${cat.name}` : t.category_id;
          return `
            <article class="glossary-card" data-term-id="${escapeHtml(t.id)}">
              <div class="glossary-card-header">
                <span class="glossary-card-cat">${escapeHtml(catLabel)}</span>
                ${t.threshold ? `<span class="glossary-card-threshold mono" title="Criterio de umbral">${escapeHtml(t.threshold)}</span>` : ''}
              </div>
              <h3 class="glossary-card-title">${escapeHtml(t.term)}</h3>
              <p class="glossary-card-short">${escapeHtml(t.short_definition)}</p>
              <div class="glossary-card-riotuerto">
                <span class="riotuerto-mini-tag">🌱 En Riotuerto:</span>
                <span class="riotuerto-mini-desc">${escapeHtml(t.riotuerto_context)}</span>
              </div>
              <div class="glossary-card-footer">
                <button type="button" class="btn btn-outline-term" data-open-term="${escapeHtml(t.id)}">
                  Ver definición completa y referencias ↗
                </button>
              </div>
            </article>
          `;
        }).join('');

    container.innerHTML = `
      <div class="view-intro">
        <span class="view-kicker">ENCICLOPEDIA Y DIVULGACIÓN LOCAL</span>
        <h2 class="view-title" id="glosario-heading">Glosario meteorológico y microclimático de Riotuerto</h2>
        <p class="view-lead">
          Repertorio de conceptos atmosféricos, biofísicos, estadísticos y orográficos documentados en el valle del río Covadal.
          Todas las definiciones combinan el rigor de los estándares de la Organización Meteorológica Mundial (OMM)
          con el comportamiento real y singular observado en el municipio de Riotuerto.
        </p>
        <div class="intro-stats-strip">
          <div class="stat-badge"><span class="num">${glo.total_terms}</span> conceptos documentados</div>
          <div class="stat-badge"><span class="num">${glo.total_categories}</span> áreas temáticas</div>
          <div class="stat-badge"><span class="num">100 %</span> contextualizado al valle</div>
        </div>
      </div>

      <section class="section-block">
        <div class="glossary-toolbar">
          <div class="glossary-search-wrap">
            <span class="search-icon" aria-hidden="true">🔍</span>
            <input
              type="search"
              id="glossary-search-input"
              class="glossary-search-input"
              placeholder="Buscar por término, sinónimo o fenómeno (ej: Foehn, surada, helada, HDD, IQR)..."
              value="${escapeHtml(STATE.glossary.searchQuery || '')}"
              aria-label="Buscar concepto en el glosario"
            />
            ${STATE.glossary.searchQuery ? `<button type="button" id="btn-clear-glossary-search" class="btn-clear-search" aria-label="Limpiar búsqueda">✕</button>` : ''}
          </div>
          <div class="glossary-filter-chips" role="group" aria-label="Filtrar por categoría">
            ${catChipsHtml}
          </div>
        </div>

        <div class="glossary-results-count">
          Mostrando <strong>${filteredTerms.length}</strong> de <strong>${glo.total_terms}</strong> conceptos
          ${activeCat !== 'all' ? `en la categoría seleccionada` : ''}
          ${query ? `para la búsqueda "<em>${escapeHtml(query)}</em>"` : ''}.
        </div>

        <div class="glossary-grid" id="glossary-grid">
          ${termsHtml}
        </div>
      </section>

      <!-- Descarga del glosario en formato abierto JSON -->
      <section class="section-block">
        <div class="section-header">
          <div>
            <h3 class="section-title">Datos abiertos del glosario</h3>
            <p class="section-subtitle">Descarga del catálogo enciclopédico estructurado en formato JSON machine-readable</p>
          </div>
        </div>
        <div class="btn-group">
          <a href="./data/glossary.json" download="meteoriotuerto_glossary.json" class="btn btn-primary">⬇ Descargar glosario estructurado (glossary.json)</a>
        </div>
      </section>
    `;

    // Listeners del toolbar y tarjetas
    const searchInput = document.getElementById('glossary-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        STATE.glossary.searchQuery = e.target.value;
        renderGlosario();
      });
    }

    const clearBtn = document.getElementById('btn-clear-glossary-search');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        STATE.glossary.searchQuery = '';
        renderGlosario();
      });
    }

    const resetBtn = document.getElementById('btn-reset-glossary-search');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        STATE.glossary.searchQuery = '';
        STATE.glossary.categoryFilter = 'all';
        renderGlosario();
      });
    }

    container.querySelectorAll('.glossary-filter-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const cat = chip.getAttribute('data-cat');
        STATE.glossary.categoryFilter = cat;
        renderGlosario();
      });
    });

    container.querySelectorAll('[data-open-term]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tId = btn.getAttribute('data-open-term');
        if (tId) openTermModal(tId);
      });
    });

    container.querySelectorAll('.glossary-card').forEach((card) => {
      card.addEventListener('click', () => {
        const tId = card.getAttribute('data-term-id');
        if (tId) openTermModal(tId);
      });
    });
  }

  /* ------------------------------------------------------------------------
   * VISTA 8: EL TIEMPO EN LAS FIESTAS Y TRADICIONES DE RIOTUERTO (EVO-013)
   * ------------------------------------------------------------------------ */
  const FESTIVALS_CATALOG = [
    {
      id: 'san_jose',
      name: 'San José Obrero',
      place: 'Monte',
      type: 'fixed',
      mmdd: '05-01',
      dateLabel: '1 de mayo',
      icon: '🌸',
      description: 'Festividad primaveral del barrio de Monte que abre el calendario anual de fiestas en Riotuerto.',
      culturalNotes: 'Celebración tradicional en la ermita y praderas de Monte con misa solemne, danzas populares y parrillada.'
    },
    {
      id: 'san_juan',
      name: 'San Juan Bautista (Patrón)',
      place: 'La Cavada',
      type: 'fixed',
      mmdd: '06-24',
      dateLabel: '24 de junio',
      icon: '🔥',
      badge: 'Patrón del municipio',
      description: 'Fiesta patronal del municipio de Riotuerto con gran concurrencia popular en La Cavada.',
      culturalNotes: 'San Juan Bautista reúne a todo el vecindario con pasacalles, mercado tradicional, actividades infantiles, verbenas multitudinarias y la clásica hoguera de San Juan la noche víspera junto al río Covadal. Es históricamente la festividad más calurosa del municipio: en 2026 registró el segundo valor más alto de la serie con 41,3 °C.'
    },
    {
      id: 'carmen',
      name: 'Nuestra Señora del Carmen',
      place: 'Barrio de Arriba',
      type: 'fixed',
      mmdd: '07-16',
      dateLabel: '16 de julio',
      icon: '⛵',
      description: 'Festividad mariana y romería tradicional en el Barrio de Arriba.',
      culturalNotes: 'Romería emblemática con devoción vecinal, procesión y danzas tradicionales.'
    },
    {
      id: 'magdalena',
      name: 'Santa María Magdalena',
      place: 'Rucandio',
      type: 'fixed',
      mmdd: '07-22',
      dateLabel: '22 de julio',
      icon: '🏛️',
      description: 'Fiestas patronales del pueblo de Rucandio en un marco arquitectónico señero.',
      culturalNotes: 'Celebración al pie de la monumental iglesia barroca de Santa María Magdalena (Bien de Interés Cultural). Destaca por su procesión con danzantes montañeses, mercado de productos artesanos, romería y comidas populares en la campa.'
    },
    {
      id: 'san_roque',
      name: 'San Roque',
      place: 'Angustina',
      type: 'fixed',
      mmdd: '08-16',
      dateLabel: '16 de agosto',
      icon: '🐕',
      description: 'Romería campestre y festividad tradicional en el pueblo de Angustina.',
      culturalNotes: 'Cita estival muy arraigada con misa y comida campestre cuando el tiempo lo permite.'
    },
    {
      id: 'juventud',
      name: 'Fiesta de la Juventud',
      place: 'La Cavada',
      type: 'rule',
      dateLabel: '3.er sábado de agosto',
      dateRule: 'Tercera semana de agosto (sábado)',
      datesByYear: {
        2022: '2022-08-20',
        2023: '2023-08-19',
        2024: '2024-08-17',
        2025: '2025-08-16',
        2026: '2026-08-15'
      },
      icon: '🎉',
      description: 'Encuentro juvenil y festivo multitudinario en el casco urbano de La Cavada.',
      culturalNotes: 'Organizada por peñas y colectivos jóvenes, congrega pasacalles y charangas, paelladas gigantes, torneos deportivos, descenso de autoslocos, concursos gastronómicos y verbena hasta altas horas de la madrugada aprovechando el apogeo estival.'
    },
    {
      id: 'brigadier',
      name: 'Toma de Posesión del Brigadier Casado Torres',
      place: 'La Cavada (Reales Fábricas de Artillería)',
      type: 'rule',
      dateLabel: '4.º sábado de agosto',
      dateRule: 'Cuarto sábado de agosto',
      datesByYear: {
        2022: '2022-08-27',
        2023: '2023-08-26',
        2024: '2024-08-24',
        2025: '2025-08-23',
        2026: '2026-08-22'
      },
      icon: '⚔️',
      badge: 'Fiesta de Interés Turístico Regional',
      description: 'Recreación histórica militar del siglo XVIII y ciclo cultural de conferencias de 5 días de duración.',
      culturalNotes: 'Conmemora la toma de posesión del Brigadier Fernando Casado de Torres en 1787 al mando de la Real Fábrica de Cañones de La Cavada. Declarada Fiesta de Interés Turístico Regional de Cantabria, incluye desfile de tropas con uniformes de época dieciochesca, salva de artillería con un cañón naval de tiro real de 48 libras y tamborrada infantil.'
    },
    {
      id: 'san_cipriano',
      name: 'San Cipriano',
      place: 'Barrio de Arriba',
      type: 'fixed',
      mmdd: '09-16',
      dateLabel: '16 de septiembre',
      icon: '🍂',
      description: 'Romería que despide el ciclo de fiestas veraniegas en el Barrio de Arriba.',
      culturalNotes: 'Jornada costumbrista de hermandad vecinal previa al equinoccio de otoño, con misa solemne, procesión, romería amenizada con pitu y tambor y danzantes bailando danzas tradicionales de palos y varas.'
    }
  ];

  function getFestivalYearRecord(fest, year, almanacs) {
    const alm = almanacs[year];
    const ds = alm?.daily_series;
    const isoDate = fest.type === 'fixed' ? `${year}-${fest.mmdd}` : fest.datesByYear[year];
    if (!ds || !isoDate) return { year, isoDate, hasData: false };

    const pos = ds.dates.indexOf(isoDate);
    if (pos === -1 || ds.temp_mean[pos] === null || ds.temp_mean[pos] === undefined) {
      return { year, isoDate, hasData: false };
    }

    const tmean = ds.temp_mean[pos];
    const tmax = ds.temp_max[pos];
    const tmin = ds.temp_min[pos];
    const tamp = ds.temp_amp[pos];
    const rain = ds.rain_daily[pos] ?? 0;
    const gust = ds.wind_gust[pos];
    const wdir = ds.wind_dir[pos];
    const hum = ds.humidity_mean[pos];

    let badgeText = '⛅ Seco y agradable';
    let badgeClass = 'fest-badge-dry';
    if (rain >= 10.0) {
      badgeText = '🌧️ Lluvia abundante';
      badgeClass = 'fest-badge-rain';
    } else if (rain >= 0.2) {
      badgeText = '🌦️ Lluvia débil / orvallo';
      badgeClass = 'fest-badge-rain';
    } else if (tmax >= 35.0) {
      badgeText = '🔥 Calor extremo / Surada';
      badgeClass = 'fest-badge-heat';
    } else if (tmax >= 28.0) {
      badgeText = '☀️ Caluroso y soleado';
      badgeClass = 'fest-badge-heat';
    }

    return {
      year,
      isoDate,
      hasData: true,
      tmean,
      tmax,
      tmin,
      tamp,
      rain,
      gust,
      wdir,
      sector: degToSector(wdir),
      hum,
      badgeText,
      badgeClass
    };
  }

  function computeFestivalStats(fest, almanacs) {
    const years = [2022, 2023, 2024, 2025, 2026];
    const records = years.map((y) => getFestivalYearRecord(fest, y, almanacs)).filter((r) => r.hasData);
    if (records.length === 0) return null;

    const tmaxList = records.map((r) => r.tmax).filter((v) => v !== null && v !== undefined);
    const tminList = records.map((r) => r.tmin).filter((v) => v !== null && v !== undefined);
    const tmeanList = records.map((r) => r.tmean).filter((v) => v !== null && v !== undefined);
    const rainList = records.map((r) => r.rain);
    const gustList = records.map((r) => r.gust).filter((v) => v !== null && v !== undefined);

    const avgTmax = tmaxList.reduce((a, b) => a + b, 0) / tmaxList.length;
    const avgTmin = tminList.reduce((a, b) => a + b, 0) / tminList.length;
    const avgTmean = tmeanList.reduce((a, b) => a + b, 0) / tmeanList.length;
    const avgRain = rainList.reduce((a, b) => a + b, 0) / rainList.length;

    const rainDays = rainList.filter((r) => r >= 0.2).length;
    const rainProbPct = (rainDays / records.length) * 100;

    const maxTmaxRecord = records.reduce((max, r) => (r.tmax > (max?.tmax ?? -999) ? r : max), null);
    const maxRainRecord = records.reduce((max, r) => (r.rain > (max?.rain ?? -999) ? r : max), null);
    const maxGustRecord = records.reduce((max, r) => ((r.gust || 0) > (max?.gust ?? -999) ? r : max), null);

    return {
      fest,
      records,
      avgTmax,
      avgTmin,
      avgTmean,
      avgRain,
      rainDays,
      totalObservedYears: records.length,
      rainProbPct,
      maxTmaxRecord,
      maxRainRecord,
      maxGustRecord
    };
  }

  function exportFestivalsToExcel(almanacs) {
    const festStatsList = FESTIVALS_CATALOG.map((f) => computeFestivalStats(f, almanacs)).filter(Boolean);

    // Hoja 1: Resumen comparativo de festividades
    const summaryHeaders = [
      'Festividad', 'Localidad', 'Fecha canónica / Regla', 'T. máx. media (°C)',
      'T. mín. media (°C)', 'T. media global (°C)', 'Probabilidad de lluvia (%)',
      'Lluvia media (mm)', 'Récord T. máx. (°C)', 'Año récord calor',
      'Lluvia máx. (mm)', 'Año lluvia máx.', 'Racha máx. (km/h)'
    ];
    const summaryRows = [summaryHeaders];

    festStatsList.forEach((fs) => {
      summaryRows.push([
        fs.fest.name,
        fs.fest.place,
        fs.fest.dateLabel || fs.fest.dateRule,
        round(fs.avgTmax, 1),
        round(fs.avgTmin, 1),
        round(fs.avgTmean, 1),
        round(fs.rainProbPct, 1),
        round(fs.avgRain, 1),
        round(fs.maxTmaxRecord?.tmax, 1),
        fs.maxTmaxRecord?.year || '—',
        round(fs.maxRainRecord?.rain, 1),
        fs.maxRainRecord?.year || '—',
        round(fs.maxGustRecord?.gust, 1)
      ]);
    });

    // Hoja 2: Serie histórica detallada por fiesta y año
    const detailHeaders = [
      'Festividad', 'Localidad', 'Año', 'Fecha ISO', 'T. media (°C)',
      'T. máx. (°C)', 'T. mín. (°C)', 'Amplitud (ΔT, °C)', 'Lluvia (mm)',
      'Racha máx. (km/h)', 'Dirección viento', 'Humedad media (%)', 'Calificación sinóptica'
    ];
    const detailRows = [detailHeaders];

    festStatsList.forEach((fs) => {
      fs.records.forEach((r) => {
        detailRows.push([
          fs.fest.name,
          fs.fest.place,
          r.year,
          r.isoDate,
          round(r.tmean, 1),
          round(r.tmax, 1),
          round(r.tmin, 1),
          round(r.tamp, 1),
          round(r.rain, 1),
          round(r.gust, 1),
          r.sector || '—',
          round(r.hum, 0),
          r.badgeText.replace(/^[^\wáéíóúÁÉÍÓÚñÑ]+/, '').trim()
        ]);
      });
    });

    // Hoja 3: Ficha metodológica y etnográfica
    const metaHeaders = ['Clave', 'Información'];
    const metaRows = [
      metaHeaders,
      ['Título', 'El tiempo en las festividades y tradiciones de Riotuerto (2022–2026)'],
      ['Estación', 'Barrio de Arriba (Riotuerto, Cantabria, 115 m s. n. m.)'],
      ['Periodo de observación', '2022–2026 (5 años documentados)'],
      ['Criterio de lluvia', 'Precipitación acumulada diaria ≥ 0,2 mm'],
      ['Aviso metodológico', 'Los datos proceden de la estación meteorológica de Barrio de Arriba. Al ser un valle de relieve accidentado, pueden registrarse ligeras diferencias térmicas o de viento en cotas altas como Monte o Rucandio.'],
      ['Fecha de exportación', new Date().toISOString()]
    ];

    exportWorkbookToXLSX({
      'Resumen_Festividades': summaryRows,
      'Historico_2022_2026': detailRows,
      'Ficha_Metodologica': metaRows
    }, 'meteoriotuerto_fiestas_tradiciones_2022_2026.xlsx');
  }

  /* ------------------------------------------------------------------------
   * VISTA UNIFICADA: RIOTUERTO COTIDIANO (LABORES Y FIESTAS)
   * ------------------------------------------------------------------------ */
  async function renderCotidiano(param, subparam) {
    const almanacs = await ensureAllAlmanacsLoaded();
    const container = document.getElementById('view-cotidiano') || document.getElementById('view-fiestas');
    if (!container) return;

    // Determinar la subpestaña activa: 'labores' o 'fiestas'
    let activeTab = 'labores';
    let targetFestId = STATE.festivalSelectedId || 'san_juan';

    if (param === 'fiestas' || param === 'tradiciones') {
      activeTab = 'fiestas';
      if (subparam && FESTIVALS_CATALOG.some((f) => f.id === subparam)) {
        targetFestId = subparam;
      }
    } else if (param && FESTIVALS_CATALOG.some((f) => f.id === param)) {
      activeTab = 'fiestas';
      targetFestId = param;
    } else if (param === 'labores') {
      activeTab = 'labores';
      if (subparam && [2022, 2023, 2024, 2025, 2026].includes(Number(subparam))) {
        STATE.cotidianoYear = Number(subparam);
      }
    }

    STATE.cotidianoTab = activeTab;
    STATE.festivalSelectedId = targetFestId;

    const years = [2022, 2023, 2024, 2025, 2026];
    const selYear = STATE.cotidianoYear && years.includes(Number(STATE.cotidianoYear))
      ? Number(STATE.cotidianoYear)
      : (STATE.selectedYear && years.includes(Number(STATE.selectedYear)) ? Number(STATE.selectedYear) : 2025);
    STATE.cotidianoYear = selYear;
    const alm = almanacs[selYear] || almanacs[2025] || almanacs[2024];

    // Cálculos para la pestaña de labores cotidianas
    const dd = alm.degree_days || { hdd_15_5: 0, cdd_21_0: 0, gdd_10_0: 0 };
    const stA = alm.stats?.air_temperature || {};
    const stP = alm.stats?.precipitation || {};
    const validMonths = (alm.monthly || []).filter((m) => m.valid_days > 0);
    const maxHddMonthObj = validMonths.reduce((prev, curr) => (curr.hdd_15_5 || 0) > (prev?.hdd_15_5 || 0) ? curr : prev, null);
    const maxHddStr = maxHddMonthObj && maxHddMonthObj.hdd_15_5 > 0 ? `${maxHddMonthObj.name} (${fmtNum(maxHddMonthObj.hdd_15_5, 1)} HDD)` : '—';
    const maxGddMonthObj = validMonths.reduce((prev, curr) => (curr.gdd_10_0 || 0) > (prev?.gdd_10_0 || 0) ? curr : prev, null);
    const maxGddStr = maxGddMonthObj && maxGddMonthObj.gdd_10_0 > 0 ? `${maxGddMonthObj.name} (${fmtNum(maxGddMonthObj.gdd_10_0, 1)} GDD)` : '—';
    const vegDaysCount = alm.daily_series?.temp_mean
      ? alm.daily_series.temp_mean.filter((t) => t !== null && t !== undefined && t >= 10.0).length
      : '—';
    const autMonths = (alm.monthly || []).filter((m) => [9, 10, 11].includes(m.month) && m.valid_days > 0);
    const autRain = autMonths.reduce((sum, m) => sum + (m.rain_total || 0), 0);
    const autRainDays = autMonths.reduce((sum, m) => sum + (m.rain_days_02 || 0), 0);

    // Calendario fenológico del año seleccionado
    const pheno = computePhenologicalCalendar(alm.daily_series);
    const phenoRowsHtml = PHENOLOGY_EVENTS.map((ev) => {
      const iso = pheno[ev.key];
      let dateHtml = '';
      let diagHtml = '';
      if (iso) {
        dateHtml = `<span class="pheno-badge-date">${fmtDateES(iso, false)}</span>`;
        const dObj = new Date(iso);
        const startOfYear = new Date(dObj.getFullYear(), 0, 1);
        const dayOfYear = Math.round((dObj - startOfYear) / 86400000) + 1;
        const diff = dayOfYear - ev.refDayOfYear;
        if (diff <= -5) {
          diagHtml = `<span class="pheno-tag-early">Adelantada (${Math.abs(diff)} d.)</span>`;
        } else if (diff >= 5) {
          diagHtml = `<span class="pheno-tag-late">Retrasada (+${diff} d.)</span>`;
        } else {
          diagHtml = `<span class="pheno-tag-ontime">En fecha habitual</span>`;
        }
      } else {
        if (alm.year === 2026) {
          dateHtml = `<span class="pheno-badge-pending">Pendiente (cierre de año)</span>`;
          diagHtml = `<span style="font-size:0.75rem; color:var(--txt-muted)">En curso</span>`;
        } else {
          dateHtml = `<span class="pheno-badge-pending">No alcanzado</span>`;
          diagHtml = `<span style="font-size:0.75rem; color:var(--txt-muted)">Sin registro continuo</span>`;
        }
      }
      return `
        <tr>
          <td>
            <strong>${ev.icon} ${escapeHtml(ev.name)}</strong>
            <span style="display:block; font-size:0.78rem; color:var(--txt-muted); margin-top:2px">${escapeHtml(ev.subtitle)}</span>
          </td>
          <td style="font-size:0.82rem; color:var(--txt-secondary)">${escapeHtml(ev.criteria)}</td>
          <td>${dateHtml}</td>
          <td style="font-size:0.85rem">${escapeHtml(ev.typicalDate)}</td>
          <td>${diagHtml}</td>
        </tr>
      `;
    }).join('');

    // Histórico multianual de labores cotidianas (2022-2026)
    const phenoByYear = {};
    years.forEach((y) => {
      phenoByYear[y] = computePhenologicalCalendar(almanacs[y]?.daily_series);
    });
    const phenoCompRowsHtml = PHENOLOGY_EVENTS.map((ev) => {
      const yearCells = years.map((y) => {
        const val = phenoByYear[y]?.[ev.key];
        if (val) {
          return `<td><span class="pheno-badge-date">${fmtDateES(val, false)}</span></td>`;
        }
        if (y === 2026) {
          return `<td><span class="pheno-badge-pending">Pendiente</span></td>`;
        }
        return `<td><span class="pheno-badge-pending">—</span></td>`;
      }).join('');
      return `
        <tr>
          <td>
            <strong>${ev.icon} ${escapeHtml(ev.name)}</strong>
            <span style="display:block; font-size:0.78rem; color:var(--txt-muted); margin-top:2px">${escapeHtml(ev.subtitle)}</span>
          </td>
          <td style="font-size:0.82rem; color:var(--txt-secondary)">${escapeHtml(ev.criteria)}</td>
          ${yearCells}
          <td style="font-size:0.85rem"><strong>${escapeHtml(ev.typicalDate)}</strong></td>
        </tr>
      `;
    }).join('');

    // Botones selectores de año para labores
    const yearButtonsHtml = years.map((y) => {
      const isCur = y === selYear;
      return `<button type="button" class="year-pill ${isCur ? 'active' : ''}" data-cotidiano-year="${y}">${y}${y === 2026 ? ' *' : ''}</button>`;
    }).join('');

    // Cálculos para la pestaña de Fiestas locales
    const festStatsList = FESTIVALS_CATALOG.map((f) => computeFestivalStats(f, almanacs)).filter(Boolean);
    const activeStat = festStatsList.find((s) => s.fest.id === STATE.festivalSelectedId) || festStatsList[0];
    const f = activeStat.fest;

    const tabsHtml = FESTIVALS_CATALOG.map((item) => {
      const isActive = item.id === f.id;
      return `
        <button type="button" class="festival-tab-btn ${isActive ? 'active' : ''}" data-fest-id="${item.id}" role="tab" aria-selected="${isActive}">
          <span>${item.icon} ${escapeHtml(item.name)}</span>
          <span class="festival-tab-date">${escapeHtml(item.dateLabel)} · ${escapeHtml(item.place)}</span>
        </button>
      `;
    }).join('');

    const detailRowsHtml = activeStat.records.map((r) => {
      return `
        <tr>
          <td><strong>${r.year}</strong></td>
          <td><span class="mono">${fmtDateES(r.isoDate, false)}</span></td>
          <td class="num">${fmtNum(r.tmean, 1)} °C</td>
          <td class="num"><strong>${fmtNum(r.tmax, 1)} °C</strong></td>
          <td class="num">${fmtNum(r.tmin, 1)} °C</td>
          <td class="num">${fmtNum(r.tamp, 1)} °C</td>
          <td class="num">${r.rain > 0 ? `<strong>${fmtNum(r.rain, 1)} mm</strong>` : '<span style="color:var(--txt-muted)">0,0 mm</span>'}</td>
          <td class="num">${r.gust !== null ? `${fmtNum(r.gust, 1)} km/h (${r.sector || '—'})` : '—'}</td>
          <td class="num">${r.hum !== null ? `${fmtNum(r.hum, 0)} %` : '—'}</td>
          <td><span class="${r.badgeClass}">${escapeHtml(r.badgeText)}</span></td>
        </tr>
      `;
    }).join('');

    const summaryRowsHtml = festStatsList.map((fs) => {
      const isCur = fs.fest.id === f.id;
      const rainBadgeClass = fs.rainProbPct <= 25 ? 'fest-badge-dry' : (fs.rainProbPct >= 50 ? 'fest-badge-rain' : '');
      return `
        <tr style="${isCur ? 'background: rgba(37,99,235,0.06); font-weight: 600;' : ''}">
          <td>
            <a href="#cotidiano/fiestas/${fs.fest.id}" class="data-link" data-jump-fest="${fs.fest.id}">
              ${fs.fest.icon} ${escapeHtml(fs.fest.name)}
            </a>
            ${fs.fest.badge ? `<span style="display:block; font-size:0.75rem; color:var(--txt-muted); font-weight:normal;">${escapeHtml(fs.fest.badge)}</span>` : ''}
          </td>
          <td>${escapeHtml(fs.fest.place)}</td>
          <td>${escapeHtml(fs.fest.dateLabel)}</td>
          <td class="num">${fmtNum(fs.avgTmax, 1)} °C</td>
          <td class="num">${fmtNum(fs.avgTmin, 1)} °C</td>
          <td class="num"><span class="${rainBadgeClass}">${fmtNum(fs.rainProbPct, 0)} %</span> (${fs.rainDays}/${fs.totalObservedYears})</td>
          <td class="num">${fmtNum(fs.avgRain, 1)} mm</td>
          <td class="num"><strong>${fmtNum(fs.maxTmaxRecord?.tmax, 1)} °C</strong> <span style="font-size:0.75rem; color:var(--txt-muted);">(${fs.maxTmaxRecord?.year})</span></td>
        </tr>
      `;
    }).join('');

    container.innerHTML = `
      <section class="section-block" style="padding-bottom: 0;">
        <div class="section-header">
          <div>
            <div class="editorial-kicker">INFORMACIÓN METEOROLÓGICA PRÁCTICA · RIOTUERTO</div>
            <h2 id="cotidiano-heading" class="section-title">Riotuerto cotidiano</h2>
            <p class="section-subtitle">
              El tiempo al servicio de nuestros vecinos: pautas claras para las tareas cotidianas del hogar, la huerta y los prados, junto con la memoria climática de nuestras ocho fiestas patronales
            </p>
          </div>
        </div>

        <!-- Subnavegación de la sección -->
        <div class="cotidiano-nav-wrap">
          <div class="cotidiano-subnav" role="tablist" aria-label="Secciones de Riotuerto cotidiano">
            <button type="button" class="cotidiano-subnav-btn ${activeTab === 'labores' ? 'active' : ''}" data-cotidiano-tab="labores" role="tab" aria-selected="${activeTab === 'labores'}">
              <span aria-hidden="true">🌾</span> Labores y vida cotidiana
            </button>
            <button type="button" class="cotidiano-subnav-btn ${activeTab === 'fiestas' ? 'active' : ''}" data-cotidiano-tab="fiestas" role="tab" aria-selected="${activeTab === 'fiestas'}">
              <span aria-hidden="true">🎉</span> Fiestas y tradiciones locales
            </button>
          </div>
        </div>
      </section>

      <!-- SUBPESTAÑA 1: LABORES Y VIDA COTIDIANA -->
      <div id="cotidiano-tab-labores" ${activeTab !== 'labores' ? 'hidden' : ''}>
        <section class="section-block" style="padding-top: 6px;">
          <!-- Selector de año -->
          <div class="cotidiano-year-bar">
            <div>
              <span style="font-weight: 700; font-size: 0.95rem; color: var(--txt-primary);">Año de consulta para labores cotidianas:</span>
              <span style="font-size: 0.85rem; color: var(--txt-muted); display: block;">Consulte cómo influyó el clima en cada ejercicio agrario del municipio</span>
            </div>
            <div class="year-pills" role="group" aria-label="Seleccionar año de consulta para labores">
              ${yearButtonsHtml}
            </div>
          </div>

          <!-- Guía práctica con las 6 tarjetas -->
          <div class="practical-guide-box" style="margin-top: 0;">
            <div class="practical-guide-header">
              <span class="guide-badge">🚜 Guía práctica para vecinos (${alm.year})</span>
              <h3 class="guide-title">Orientación para el hogar, la huerta y el campo</h3>
              <p class="guide-subtitle">
                Cómo trasladar los registros de temperatura, humedad, lluvia y sol del año ${alm.year} a las decisiones y tareas habituales en Riotuerto
              </p>
            </div>
            <div class="practical-cards-grid">
              <div class="practical-card">
                <div class="practical-card-media">
                  <picture>
                    <source srcset="./assets/img/labor-calefaccion-lena.webp" type="image/webp">
                    <img src="./assets/img/labor-calefaccion-lena.jpg" alt="Acopio de leña y calefacción en vivienda tradicional montañesa" class="practical-card-img" loading="lazy" width="800" height="450">
                  </picture>
                </div>
                <div class="practical-card-top">
                  <span class="practical-card-icon">🔥</span>
                  <div>
                    <h5 class="practical-card-title">Calefacción y acopio de leña / pellets</h5>
                    <span class="practical-card-meta">Basado en Grados Día de Calefacción (HDD)</span>
                  </div>
                </div>
                <p class="practical-card-body">
                  Cada punto de HDD refleja demanda térmica de las viviendas. Permite planificar el acopio de combustible y saber cuándo arrancar la caldera en otoño al encadenarse días con más de 4–5 HDD (medias diarias por debajo de 11 °C). En primavera, cuando los HDD caen persistentemente por debajo de 2 HDD/día, es el momento idóneo para pasar la caldera a modo solo agua caliente (ACS).
                </p>
                <div class="practical-card-stat">
                  Demanda en ${alm.year}: <strong>${fmtNum(dd.hdd_15_5, 1)} HDD</strong> (Mes pico: ${maxHddStr})
                </div>
              </div>

              <div class="practical-card">
                <div class="practical-card-media">
                  <picture>
                    <source srcset="./assets/img/labor-robot-cortacesped.webp" type="image/webp">
                    <img src="./assets/img/labor-robot-cortacesped.jpg" alt="Robot cortacésped trabajando sobre pradera verde cuidada" class="practical-card-img" loading="lazy" width="800" height="450">
                  </picture>
                </div>
                <div class="practical-card-top">
                  <span class="practical-card-icon">🤖</span>
                  <div>
                    <h5 class="practical-card-title">Robots cortacésped e invernada de aperos</h5>
                    <span class="practical-card-meta">Basado en el Cero Vegetativo (10,0 °C)</span>
                  </div>
                </div>
                <p class="practical-card-body">
                  El césped y las praderas detienen su crecimiento activo por debajo de 10,0 °C. Indica cuándo retirar a resguardo los robots cortacésped y aperos para invernar a finales de otoño (protegiendo baterías y evitando apelmazar el terreno enfangado) y cuándo volver a ponerlos en marcha en primavera al consolidarse medias diarias &gt;10 °C de forma regular.
                </p>
                <div class="practical-card-stat">
                  Jornadas de crecimiento biológico (&ge;10 °C): <strong>${vegDaysCount} días</strong>
                </div>
              </div>

              <div class="practical-card">
                <div class="practical-card-media">
                  <picture>
                    <source srcset="./assets/img/labor-siega-forraje.webp" type="image/webp">
                    <img src="./assets/img/labor-siega-forraje.jpg" alt="Tractor agrícola realizando la siega de hierba para forraje en praderas" class="practical-card-img" loading="lazy" width="800" height="450">
                  </picture>
                </div>
                <div class="practical-card-top">
                  <span class="practical-card-icon">🚜</span>
                  <div>
                    <h5 class="practical-card-title">Siega de prados y cortes de forraje</h5>
                    <span class="practical-card-meta">Basado en Grados Día Agrícolas (GDD)</span>
                  </div>
                </div>
                <p class="practical-card-body">
                  Las praderas trasmeranas (raigrás, trébol y festuca) acumulan grados día para alcanzar su punto óptimo de biomasa y digestibilidad. El primer corte de forraje suele programarse al alcanzar ~200–250 GDD desde marzo, buscando ventanas sinópticas de 3 a 4 jornadas consecutivas secas con viento sur o brisa de ladera para garantizar un buen curado o ensilado.
                </p>
                <div class="practical-card-stat">
                  Energía biológica acumulada en ${alm.year}: <strong>${fmtNum(dd.gdd_10_0, 1)} GDD</strong> (Pico: ${maxGddStr})
                </div>
              </div>

              <div class="practical-card">
                <div class="practical-card-media">
                  <picture>
                    <source srcset="./assets/img/labor-huerta-tratamientos.webp" type="image/webp">
                    <img src="./assets/img/labor-huerta-tratamientos.jpg" alt="Huerta tradicional con tomateras y cultivos hortícolas cuidados" class="practical-card-img" loading="lazy" width="800" height="450">
                  </picture>
                </div>
                <div class="practical-card-top">
                  <span class="practical-card-icon">🍅</span>
                  <div>
                    <h5 class="practical-card-title">Huerta y sulfatos contra plagas (mildiu y oídio)</h5>
                    <span class="practical-card-meta">Combinación de Temperatura + Humedad relativa</span>
                  </div>
                </div>
                <p class="practical-card-body">
                  Las esporas de hongos proliferan cuando la temperatura media supera los 10–12 °C (crecimiento activo) combinada con humedad relativa sostenida (&gt;85 %) o rocío matinal denso tras jornadas de lluvia. Este indicador señala las fechas críticas para aplicar tratamientos preventivos de cobre o azufre en tomateras y frutales antes de que aparezcan las manchas foliares.
                </p>
                <div class="practical-card-stat">
                  Humedad media anual: <strong>${fmtNum(stA.humidity_mean_pct, 1)} %</strong> · Precipitación: <strong>${fmtNum(stP.total_mm, 1)} mm</strong>
                </div>
              </div>

              <div class="practical-card">
                <div class="practical-card-media">
                  <picture>
                    <source srcset="./assets/img/labor-setas-micologia.webp" type="image/webp">
                    <img src="./assets/img/labor-setas-micologia.jpg" alt="Setas silvestres boletus edulis brotando en robledal y castañar húmedo" class="practical-card-img" loading="lazy" width="800" height="450">
                  </picture>
                </div>
                <div class="practical-card-top">
                  <span class="practical-card-icon">🍄</span>
                  <div>
                    <h5 class="practical-card-title">Temporada de setas y eclosión micológica</h5>
                    <span class="practical-card-meta">Humedad del suelo + Ventanas térmicas en monte</span>
                  </div>
                </div>
                <p class="practical-card-body">
                  Las setas de otoño en los robledales, castañares y pinares de Riotuerto (boletus, cantarelas y senderuelas) requieren una secuencia precisa: un «riego abundante previo» (&gt;40–50 mm acumulados) seguido de 7 a 10 días de temperaturas medias templadas (11–17 °C) sin suradas resecantes que marchiten el micelio. Permite seguir las mejores semanas para la recogida en el monte antes de las primeras heladas invernales.
                </p>
                <div class="practical-card-stat">
                  Lluvia otoñal (sep.–nov.): <strong>${fmtNum(autRain, 1)} mm</strong> (${autRainDays} días con lluvia)
                </div>
              </div>

              <div class="practical-card">
                <div class="practical-card-media">
                  <picture>
                    <source srcset="./assets/img/labor-solar-fotovoltaica.webp" type="image/webp">
                    <img src="./assets/img/labor-solar-fotovoltaica.jpg" alt="Paneles solares fotovoltaicos sobre tejado de teja tradicional para autoconsumo" class="practical-card-img" loading="lazy" width="800" height="450">
                  </picture>
                </div>
                <div class="practical-card-top">
                  <span class="practical-card-icon">☀️</span>
                  <div>
                    <h5 class="practical-card-title">Autoconsumo solar fotovoltaico y térmico</h5>
                    <span class="practical-card-meta">Radiación solar global + Horas de sol</span>
                  </div>
                </div>
                <p class="practical-card-body">
                  Para viviendas y explotaciones con placas solares en tejados o cubiertas. La persistente nubosidad orográfica matinal del fondo de valle modula la captación invernal, pero en primavera y verano y con viento sur la radiación supera los 950–1.050 W/m². Permite estimar el balance energético estacional, dimensionar baterías o acumuladores de agua y maximizar el autoconsumo en horas centrales.
                </p>
                <div class="practical-card-stat">
                  Horas de sol anuales: <strong>${stA.estimated_sunshine_hours !== null && stA.estimated_sunshine_hours !== undefined ? `${fmtNum(stA.estimated_sunshine_hours, 0)} h` : '—'}</strong> (Pico: ${stA.solar_max_wm2 !== null && stA.solar_max_wm2 !== undefined ? `${fmtNum(stA.solar_max_wm2, 1)} W/m²` : '—'})
                </div>
              </div>
            </div>

            <!-- Calendario fenológico y agroclimático del año seleccionado -->
            <div class="phenology-box">
              <div class="phenology-header">
                <h4 style="margin: 0 0 4px 0; font-size: 1.15rem; font-family: var(--font-serif); color: var(--txt-primary);">
                  📅 Calendario fenológico y agroclimático de Riotuerto (${alm.year})
                </h4>
                <p style="margin: 0; font-size: 0.85rem; color: var(--txt-muted);">
                  Fechas exactas del año en que se alcanzaron los umbrales bioclimáticos para calderas, siegas, robots cortacésped, huerta y setas frente a la media habitual
                </p>
              </div>
              <div class="table-responsive">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Labor o actividad cotidiana</th>
                      <th>Criterio agroclimático</th>
                      <th>Fecha observada en ${alm.year}</th>
                      <th>Fecha media habitual</th>
                      <th>Diagnóstico</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${phenoRowsHtml}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        <!-- Calendario histórico multianual de labores -->
        <section class="section-block" aria-labelledby="sec-pheno-multi-title">
          <div class="section-header">
            <div>
              <div class="editorial-kicker">FENOLOGÍA Y RITMOS DEL VALLE · SERIE 2022–2026</div>
              <h3 id="sec-pheno-multi-title" class="section-title">Calendario histórico de labores cotidianas y agroclimatología</h3>
              <p class="section-subtitle">
                Comparativa interanual de fechas exactas en que se alcanzaron los umbrales biofísicos para calderas, huertas, siegas, robots cortacésped y setas
              </p>
            </div>
            <div>
              <button type="button" id="btn-export-phenology-cotidiano-xlsx" class="btn btn-excel">
                📊 Descargar calendario agroclimático (.xlsx)
              </button>
            </div>
          </div>

          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Labor o actividad cotidiana</th>
                  <th>Criterio agroclimático</th>
                  <th>2022</th>
                  <th>2023</th>
                  <th>2024</th>
                  <th>2025</th>
                  <th>2026 (Avance)</th>
                  <th>Fecha media habitual</th>
                </tr>
              </thead>
              <tbody>
                ${phenoCompRowsHtml}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <!-- SUBPESTAÑA 2: FIESTAS Y TRADICIONES LOCALES -->
      <div id="cotidiano-tab-fiestas" ${activeTab !== 'fiestas' ? 'hidden' : ''}>
        <section class="section-block" style="padding-top: 6px;">
          <div class="section-header">
            <div>
              <div class="editorial-kicker">COSTUMBRISMO Y METEOROLOGÍA DE RIOTUERTO · SERIE 2022–2026</div>
              <h3 id="fiestas-heading" class="section-title">El tiempo en las festividades y tradiciones del municipio</h3>
              <p class="section-subtitle">
                Crónica meteorológica retrospectiva, estabilidad y extremos históricos en las 8 celebraciones patronales y eventos de Riotuerto
              </p>
            </div>
            <div class="btn-group">
              <button type="button" class="btn btn-primary btn-excel" id="btn-export-festivals-xlsx">
                📥 Descargar monografía de festividades (.xlsx)
              </button>
            </div>
          </div>

          <!-- Selector de festividades -->
          <div class="festivals-tabs-wrap" role="tablist" aria-label="Festividades de Riotuerto">
            ${tabsHtml}
          </div>

          <!-- Tarjeta Hero de la festividad seleccionada -->
          <div class="festival-card-hero">
            <div class="festival-hero-header">
              <span class="festival-hero-icon">${f.icon}</span>
              <div>
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                  <h3 class="festival-hero-title">${escapeHtml(f.name)}</h3>
                  ${f.badge ? `<span class="badge badge-complete">${escapeHtml(f.badge)}</span>` : ''}
                </div>
                <div class="festival-hero-place">
                  📍 <strong>${escapeHtml(f.place)}</strong> · ${f.dateRule ? `Regla: ${escapeHtml(f.dateRule)}` : `Fecha fija: ${escapeHtml(f.dateLabel)}`}
                </div>
              </div>
            </div>

            <p class="festival-chronicle-p">
              ${escapeHtml(f.culturalNotes)}
            </p>

            <div class="festival-stats-strip">
              <div class="fest-stat-box">
                <div class="fest-stat-label">T. Media histórica</div>
                <div class="fest-stat-val">${fmtNum(activeStat.avgTmean, 1)} °C</div>
              </div>
              <div class="fest-stat-box">
                <div class="fest-stat-label">T. Máxima media</div>
                <div class="fest-stat-val">${fmtNum(activeStat.avgTmax, 1)} °C</div>
              </div>
              <div class="fest-stat-box">
                <div class="fest-stat-label">T. Mínima media</div>
                <div class="fest-stat-val">${fmtNum(activeStat.avgTmin, 1)} °C</div>
              </div>
              <div class="fest-stat-box">
                <div class="fest-stat-label">Probabilidad de lluvia</div>
                <div class="fest-stat-val">${fmtNum(activeStat.rainProbPct, 0)} %</div>
              </div>
              <div class="fest-stat-box">
                <div class="fest-stat-label">Récord de calor</div>
                <div class="fest-stat-val" style="color:#dc2626">${fmtNum(activeStat.maxTmaxRecord?.tmax, 1)} °C <span style="font-size:0.75rem; color:var(--txt-muted);">(${activeStat.maxTmaxRecord?.year})</span></div>
              </div>
              <div class="fest-stat-box">
                <div class="fest-stat-label">Lluvia máxima 24h</div>
                <div class="fest-stat-val" style="color:#2563eb">${fmtNum(activeStat.maxRainRecord?.rain, 1)} mm <span style="font-size:0.75rem; color:var(--txt-muted);">(${activeStat.maxRainRecord?.year})</span></div>
              </div>
            </div>

            <!-- Tabla histórica de los 5 años -->
            <div class="table-responsive">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Año</th>
                    <th>Fecha observada</th>
                    <th class="num">T. media</th>
                    <th class="num">T. máx.</th>
                    <th class="num">T. mín.</th>
                    <th class="num">Amplitud (ΔT)</th>
                    <th class="num">Lluvia (24h)</th>
                    <th class="num">Racha máx.</th>
                    <th class="num">Humedad media</th>
                    <th>Calificación sinóptica</th>
                  </tr>
                </thead>
                <tbody>
                  ${detailRowsHtml}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <!-- Cuadro comparativo de las 8 festividades -->
        <section class="section-block" aria-labelledby="sec-all-fest-title">
          <div class="section-header">
            <div>
              <h3 id="sec-all-fest-title" class="section-title">Cuadro sinóptico comparativo de las fiestas municipales</h3>
              <p class="section-subtitle">
                Resumen interanual conjunto para planificar visitas, romerías y actos al aire libre en Riotuerto
              </p>
            </div>
          </div>

          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Festividad</th>
                  <th>Localidad</th>
                  <th>Fecha habitual</th>
                  <th class="num">T. máx. media</th>
                  <th class="num">T. mín. media</th>
                  <th class="num">Probabilidad de lluvia</th>
                  <th class="num">Lluvia media</th>
                  <th class="num">Récord T. máx.</th>
                </tr>
              </thead>
              <tbody>
                ${summaryRowsHtml}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    `;

    // 1. Listeners para alternar entre subpestañas 'labores' y 'fiestas'
    container.querySelectorAll('.cotidiano-subnav-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-cotidiano-tab');
        if (tab === 'fiestas') {
          window.location.hash = '#cotidiano/fiestas';
        } else {
          window.location.hash = '#cotidiano/labores';
        }
      });
    });

    // 2. Selector de año para labores
    container.querySelectorAll('[data-cotidiano-year]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const y = Number(btn.getAttribute('data-cotidiano-year'));
        if (y) {
          STATE.cotidianoYear = y;
          renderCotidiano('labores', String(y));
        }
      });
    });

    // 3. Exportar Excel fenológico en labores cotidianas
    document.getElementById('btn-export-phenology-cotidiano-xlsx')?.addEventListener('click', () => {
      exportPhenologyCalendarToExcel(almanacs);
    });

    // 4. Selector de festividad
    container.querySelectorAll('.festival-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const festId = btn.getAttribute('data-fest-id');
        if (festId) {
          STATE.festivalSelectedId = festId;
          window.location.hash = `#cotidiano/fiestas/${festId}`;
        }
      });
    });

    // 5. Enlaces de salto en la tabla comparativa de fiestas
    container.querySelectorAll('[data-jump-fest]').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const festId = link.getAttribute('data-jump-fest');
        if (festId) {
          STATE.festivalSelectedId = festId;
          window.location.hash = `#cotidiano/fiestas/${festId}`;
        }
      });
    });

    // 6. Exportar Excel de festividades
    document.getElementById('btn-export-festivals-xlsx')?.addEventListener('click', () => {
      exportFestivalsToExcel(almanacs);
    });
  }

  /* ------------------------------------------------------------------------
   * Delegación de compatibilidad para enlaces antiguos a #fiestas
   * ------------------------------------------------------------------------ */
  async function renderFiestas(param) {
    return renderCotidiano('fiestas', param);
  }

  /* ------------------------------------------------------------------------
   * Enrutador SPA basado en Hash (#portada, #cotidiano, #almanaque/2025, etc.)
   * EVO-031: Enlaces profundos bidireccionales cruzados y parámetros de consulta
   * ------------------------------------------------------------------------ */
  function parseHashRoute() {
    const raw = (window.location.hash || '#portada').replace(/^#/, '');
    const [hashPath, queryStr] = raw.split('?');
    const parts = hashPath.split('/');
    let route = parts[0] || 'portada';
    let param = parts[1] || null;
    let subparam = parts[2] || null;
    let extraparam = parts[3] || null;

    const queryParams = {};
    if (queryStr) {
      queryStr.split('&').forEach((pair) => {
        const [k, v] = pair.split('=');
        if (k) queryParams[decodeURIComponent(k)] = decodeURIComponent(v || '');
      });
    }

    // Compatibilidad y redirección para #fiestas -> #cotidiano/fiestas
    if (route === 'fiestas') {
      route = 'cotidiano';
      subparam = param;
      param = 'fiestas';
    }

    // Compatibilidad para #analisis -> redirige por defecto a #explorador (EVO-030)
    if (route === 'analisis') {
      if (param && ['explorador', 'comparativas', 'metodologia', 'glosario'].includes(param)) {
        route = param;
        param = subparam;
        subparam = null;
      } else {
        route = 'explorador';
      }
    }

    const validRoutes = ['portada', 'cotidiano', 'almanaque', 'explorador', 'records', 'comparativas', 'fiestas', 'metodologia', 'glosario', 'analisis'];
    return {
      route: validRoutes.includes(route) ? route : 'portada',
      param,
      subparam,
      extraparam,
      queryParams,
    };
  }

  async function handleRouteChange() {
    const { route, param, subparam, extraparam, queryParams } = parseHashRoute();
    STATE.route = route;

    // Actualizar pestaña activa en el menú principal (EVO-030: 5 pilares temáticos)
    const ANALISIS_ROUTES = ['explorador', 'comparativas', 'metodologia', 'glosario', 'analisis'];
    document.querySelectorAll('#main-nav .nav-link').forEach((link) => {
      const r = link.getAttribute('data-route');
      let isAct = false;
      if (r === 'portada' && route === 'portada') isAct = true;
      else if (r === 'almanaque' && route === 'almanaque') isAct = true;
      else if (r === 'records' && route === 'records') isAct = true;
      else if (r === 'cotidiano' && (route === 'cotidiano' || route === 'fiestas')) isAct = true;
      else if (r === 'analisis' && ANALISIS_ROUTES.includes(route)) isAct = true;
      else if (r === route) isAct = true;

      link.classList.toggle('active', isAct);
      if (isAct) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    });

    // Actualizar subenlace activo en desplegables de Almanaques y Análisis
    document.querySelectorAll('#main-nav .nav-dropdown-link').forEach((sublink) => {
      const subRoute = sublink.getAttribute('data-route-sub');
      const href = sublink.getAttribute('href') || '';
      let isSubAct = false;
      if (route === 'almanaque' && param && href.includes(`almanaque/${param}`)) {
        isSubAct = true;
      } else if (subRoute && subRoute === route) {
        isSubAct = true;
      }
      sublink.classList.toggle('active-sub', isSubAct);
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

    let scrollToTarget = null;

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
      } else if (route === 'cotidiano' || route === 'fiestas') {
        await renderCotidiano(param, subparam);
      } else if (route === 'almanaque') {
        const targetYear = param && [2022, 2023, 2024, 2025, 2026].includes(Number(param))
          ? Number(param)
          : STATE.selectedYear || 2025;
        await renderAlmanaque(targetYear);

        // EVO-031: Deep link a mes o celda del calendario
        if (subparam) {
          const mMatch = subparam.match(/^mes-(\d{1,2})$/i) || subparam.match(/^(\d{1,2})$/);
          if (mMatch) {
            const mNum = String(parseInt(mMatch[1], 10)).padStart(2, '0');
            scrollToTarget = document.getElementById(`mes-${targetYear}-${mNum}`);
          } else if (subparam.startsWith('cal-') || subparam.includes('-')) {
            const dateId = subparam.startsWith('cal-') ? subparam : `cal-cell-${subparam}`;
            scrollToTarget = document.getElementById(dateId);
          }
        }
      } else if (route === 'explorador') {
        // EVO-031: Preconfigurar explorador desde deep links
        if (param && param.match(/^\d{4}-\d{2}-\d{2}$/)) {
          STATE.explorer.dateFrom = param;
          STATE.explorer.dateTo = (subparam && subparam.match(/^\d{4}-\d{2}-\d{2}$/)) ? subparam : param;
          if (extraparam && EXPLORER_VARIABLES[extraparam]) {
            STATE.explorer.variable = extraparam;
          }
        }
        if (queryParams.from && queryParams.from.match(/^\d{4}-\d{2}-\d{2}$/)) {
          STATE.explorer.dateFrom = queryParams.from;
        }
        if (queryParams.to && queryParams.to.match(/^\d{4}-\d{2}-\d{2}$/)) {
          STATE.explorer.dateTo = queryParams.to;
        }
        if (queryParams.var && EXPLORER_VARIABLES[queryParams.var]) {
          STATE.explorer.variable = queryParams.var;
        }
        await renderExplorador();
      } else if (route === 'records') {
        await renderRecords();
        // EVO-031: Deep link a episodio o ranking
        if (param === 'episodio' && subparam) {
          scrollToTarget = document.getElementById(`episode-${subparam}`) || document.getElementById('extreme-episodes-section');
        } else if (param === 'episodios') {
          if (subparam && ['heatwave', 'coldwave', 'wet_spell', 'dry_spell', 'foehn_spell'].includes(subparam)) {
            STATE.episodes.filterType = subparam;
            const btn = document.querySelector(`.episodes-filter-btn[data-type="${subparam}"]`);
            if (btn) btn.click();
          }
          scrollToTarget = document.getElementById('extreme-episodes-section');
        } else if (param === 'rankings') {
          if (subparam) {
            STATE.recordsRankingKey = subparam;
            const sel = document.getElementById('select-ranking-cat');
            if (sel) {
              sel.value = subparam;
              sel.dispatchEvent(new Event('change'));
            }
          }
          scrollToTarget = document.getElementById('ranking-table-body')?.closest('.section-block');
        } else if (param === 'absolutos') {
          scrollToTarget = document.getElementById('records-heading')?.closest('.editorial-hero')?.nextElementSibling?.nextElementSibling;
        }
      } else if (route === 'comparativas') {
        await renderComparativas();
      } else if (route === 'metodologia') {
        await renderMetodologia();
      } else if (route === 'glosario') {
        await renderGlosario();
      }

      if (loadingEl) loadingEl.hidden = true;
      const activeSectionId = (route === 'cotidiano' || route === 'fiestas') ? 'view-cotidiano' : `view-${route}`;
      const activeSection = document.getElementById(activeSectionId);
      if (activeSection) {
        activeSection.hidden = false;
      }

      if (scrollToTarget) {
        setTimeout(() => {
          scrollToTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
          scrollToTarget.classList.add('table-row-highlight');
        }, 100);
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
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
   * EVO-021 (EVO-F): Registro de Service Worker, PWA y monitor offline
   * ------------------------------------------------------------------------ */
  function initServiceWorkerAndPWA() {
    // 1. Registro del Service Worker
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
          .then((reg) => {
            reg.onupdatefound = () => {
              const installingWorker = reg.installing;
              if (installingWorker) {
                installingWorker.onstatechange = () => {
                  if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    console.log('[MeteoRiotuerto PWA] Nueva versión disponible en segundo plano.');
                  }
                };
              }
            };
          })
          .catch((err) => {
            console.warn('[MeteoRiotuerto PWA] No se pudo registrar sw.js:', err);
          });
      });
    }

    // 2. Monitor de estado online / offline
    const badge = document.getElementById('offline-badge');
    const badgeText = document.getElementById('offline-badge-text');

    function updateOnlineStatus() {
      if (!badge) return;
      if (!navigator.onLine) {
        badge.classList.remove('online-restored');
        if (badgeText) badgeText.textContent = 'Modo sin conexión';
        badge.hidden = false;
      } else {
        if (!badge.hidden && !badge.classList.contains('online-restored')) {
          badge.classList.add('online-restored');
          if (badgeText) badgeText.textContent = 'Conectado';
          setTimeout(() => {
            badge.hidden = true;
            badge.classList.remove('online-restored');
          }, 3500);
        } else {
          badge.hidden = true;
        }
      }
    }

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus();

    // 3. Soporte de instalación como aplicación PWA (beforeinstallprompt)
    let deferredPrompt = null;
    const installBtn = document.getElementById('btn-pwa-install');

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      if (installBtn) {
        installBtn.hidden = false;
        installBtn.onclick = async () => {
          installBtn.hidden = true;
          if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            console.log('[MeteoRiotuerto PWA] Elección de instalación:', outcome);
            deferredPrompt = null;
          }
        };
      }
    });

    window.addEventListener('appinstalled', () => {
      if (installBtn) installBtn.hidden = true;
      deferredPrompt = null;
      console.log('[MeteoRiotuerto PWA] Aplicación instalada con éxito.');
    });
  }

  /* ------------------------------------------------------------------------
   * Conmutador de tema claro / oscuro
   * ------------------------------------------------------------------------ */
  function updateThemeButtonUI() {
    const icon = document.getElementById('theme-icon');
    const label = document.getElementById('theme-label');
    const mobileIcon = document.getElementById('mobile-theme-icon');
    if (STATE.theme === 'dark') {
      if (icon) icon.textContent = '☀';
      if (label) label.textContent = 'Modo claro';
      if (mobileIcon) mobileIcon.textContent = '☀';
    } else {
      if (icon) icon.textContent = '☾';
      if (label) label.textContent = 'Modo oscuro';
      if (mobileIcon) mobileIcon.textContent = '☾';
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
    initServiceWorkerAndPWA();
    document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);
    document.getElementById('mobile-theme-toggle')?.addEventListener('click', toggleTheme);

    // Menú de navegación accesible para dispositivos móviles
    const navToggle = document.getElementById('nav-toggle');
    const mainNav = document.getElementById('main-nav');
    if (navToggle && mainNav) {
      navToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = mainNav.classList.toggle('nav-open');
        navToggle.setAttribute('aria-expanded', String(isOpen));
        navToggle.classList.toggle('active', isOpen);
      });

      // Cerrar menú al hacer clic en cualquier enlace (incluyendo submenús de pilares)
      mainNav.querySelectorAll('.nav-link, .nav-dropdown-link').forEach((link) => {
        link.addEventListener('click', () => {
          if (mainNav.classList.contains('nav-open')) {
            mainNav.classList.remove('nav-open');
            navToggle.setAttribute('aria-expanded', 'false');
            navToggle.classList.remove('active');
          }
        });
      });

      // Cerrar menú al hacer clic fuera
      document.addEventListener('click', (e) => {
        if (mainNav.classList.contains('nav-open') && !mainNav.contains(e.target) && !navToggle.contains(e.target)) {
          mainNav.classList.remove('nav-open');
          navToggle.setAttribute('aria-expanded', 'false');
          navToggle.classList.remove('active');
        }
      });

      // Cerrar menú con la tecla Escape
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && mainNav.classList.contains('nav-open')) {
          mainNav.classList.remove('nav-open');
          navToggle.setAttribute('aria-expanded', 'false');
          navToggle.classList.remove('active');
          navToggle.focus();
        }
      });
    }

    window.addEventListener('hashchange', handleRouteChange);

    // Cerrar modal interactivo de términos
    document.getElementById('modal-term-close')?.addEventListener('click', closeTermModal);
    document.getElementById('term-modal-backdrop')?.addEventListener('click', closeTermModal);

    // Escuchar clics globales en accesos directos con scroll suave y términos contextuales
    document.addEventListener('click', (e) => {
      const scrollTrigger = e.target.closest('[data-scroll-to]');
      if (scrollTrigger) {
        const targetId = scrollTrigger.getAttribute('data-scroll-to');
        const targetEl = document.getElementById(targetId);
        if (targetEl && !targetEl.closest('.view-section[hidden]')) {
          e.preventDefault();
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }
      }

      const termEl = e.target.closest('.glossary-term');
      if (termEl) {
        e.preventDefault();
        const termId = termEl.getAttribute('data-term');
        if (termId) openTermModal(termId);
        return;
      }
      const chipEl = e.target.closest('[data-open-term]');
      if (chipEl) {
        e.preventDefault();
        const termId = chipEl.getAttribute('data-open-term');
        if (termId) openTermModal(termId);
      }
    });

    // Tecla Escape para cerrar modales y atajos de teclado Alt + 1..5 (pilares) y Alt + Flecha Izq/Der
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeTermModal();
        if (mainNav && mainNav.classList.contains('nav-open')) {
          mainNav.classList.remove('nav-open');
          navToggle?.setAttribute('aria-expanded', 'false');
          navToggle?.classList.remove('active');
        }
        return;
      }

      // Atajos de navegación directa para los 5 pilares temáticos: Alt + 1..5 (EVO-030)
      if (e.altKey && ['1', '2', '3', '4', '5'].includes(e.key)) {
        const tag = (e.target && e.target.tagName) || '';
        if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return;
        e.preventDefault();
        if (e.key === '1') window.location.hash = '#portada';
        else if (e.key === '2') {
          const year = STATE.selectedYear || 2025;
          window.location.hash = `#almanaque/${year}`;
        }
        else if (e.key === '3') window.location.hash = '#records';
        else if (e.key === '4') window.location.hash = '#cotidiano';
        else if (e.key === '5') window.location.hash = '#explorador';
        return;
      }

      if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      const tag = (e.target && e.target.tagName) || '';
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return;
      const { route } = parseHashRoute();
      if (route !== 'almanaque' || !STATE.cache.index) return;
      const years = STATE.cache.index.series_overview.years_available || [];
      const curIdx = years.indexOf(STATE.selectedYear);
      if (curIdx < 0) return;
      const targetIdx = e.key === 'ArrowLeft' ? curIdx - 1 : curIdx + 1;
      if (targetIdx >= 0 && targetIdx < years.length) {
        e.preventDefault();
        window.location.hash = `#almanaque/${years[targetIdx]}`;
      }
    });

    handleRouteChange();
  });
})();
