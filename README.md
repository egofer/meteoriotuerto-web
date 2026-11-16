# MeteoRiotuerto — Almanaque climatológico de Riotuerto

Publicación digital, archivo histórico y notario del clima local de **Barrio de Arriba, municipio de Riotuerto (Cantabria, España · 115 m s. n. m.)**, elaborada a partir de los registros instrumentales de la estación meteorológica automática **MeteoRiotuerto**.

- **Web en producción:** [https://egofer.github.io/meteoriotuerto-web/](https://egofer.github.io/meteoriotuerto-web/)
- **Última actualización documental:** `2026-11-16`

---

## Finalidad y antecedentes

**MeteoRiotuerto** no es una aplicación de predicción meteorológica ni un simple monitor instantáneo (función complementaria que cubren Weather Underground `IRIOTU1`, Weathercloud y Ecowitt). Su misión es **conservar, analizar, interpretar y difundir la memoria atmosférica del municipio**, respondiendo con rigor científico y claridad divulgativa a:

- ¿Cómo fue meteorológicamente cada año en Riotuerto (2022–2026)?
- ¿Qué extremos de temperatura, precipitación, viento, radiación y presión se han registrado y en qué fechas?
- ¿Qué episodios atmosféricos (suradas por efecto Foehn, temporales atlánticos, olas de calor/frío, sequías) caracterizaron cada estación?
- ¿Cómo evolucionan las normales climatológicas del primer quinquenio (2022–2026) y los indicadores agroclimáticos locales?

---

## Objetivos iniciales y alcance alcanzado

- **Estado actual:** Proyecto finalizado en su alcance planificado (`EVO-001` a `EVO-048`, `MEJ-001` a `MEJ-012` e incidencias `INC-001` a `INC-031` cerradas) y en **operación continua** mediante sincronización diaria automatizada en GitHub Actions.
- **Principales resultados obtenidos:**
  - *Pipeline* reproducible en Python (`scripts/`) con depuración no destructiva, validación física y generación atómica de 12 archivos JSON/GeoJSON minificados en `data/` (`1.746` días observados consolidados hasta `2026-11-14`).
  - Aplicación web estática (SPA + PWA *offline* `v1.2.15`) con portada editorial, almanaques anuales (2022–2026), sección de acontecimientos y récords, cuaderno agroclimático y de festividades (`#cotidiano`), comparativas multianuales y normales OMM (`#comparativas`), explorador interactivo (`#explorador`), metodología (`#metodologia`) y glosario (`#glosario`).
  - Exportación nativa a Excel (`.xlsx`), exportación de gráficos a PNG con membrete CC BY 4.0, accesibilidad WCAG 2.2 AA y suite de 64 pruebas automatizadas (`tests/test_data_pipeline.py`).

---

## Estructura general de directorios

```text
meteoriotuerto-web/
├── .github/workflows/deploy.yml   # CI/CD: validación, pruebas, empaquetado y despliegue en GitHub Pages
├── assets/img/                    # Fotografías oficiales, labores cotidianas y tarjetas Open Graph (og/)
├── data/                          # 12 productos JSON/GeoJSON estáticos precompilados y minificados
├── docs/                          # Metodología científica (METODOLOGIA.md) y guía de despliegue (GUIA_DESPLIEGUE.md)
├── scripts/                       # Procesamiento, validación, frescura, tarjetas OG, glosario y sincronización
├── src/                           # Frontend estático (css/styles.css, js/app.js y js/vendor/xlsx.mini.min.js)
├── tests/                         # Suite de 64 pruebas unitarias e invariantes (test_data_pipeline.py)
├── index.html                     # Documento principal de la aplicación
├── sw.js / site.webmanifest       # Service Worker y manifiesto PWA
├── robots.txt / sitemap.xml       # Directivas de rastreo e indexación SEO
└── requirements.txt               # Dependencias Python (numpy, pandas, Pillow)
```

---

## Documentación técnica y de contexto

- **Documentación pública del repositorio:**
  - [`docs/METODOLOGIA.md`](./docs/METODOLOGIA.md): criterios científicos, fórmulas estadísticas, control de calidad y auditoría de datos.
  - [`docs/GUIA_DESPLIEGUE.md`](./docs/GUIA_DESPLIEGUE.md): ejecución local, actualización manual/automática y configuración de GitHub Pages.
- **Documentación interna de contexto (exclusiva del espacio de trabajo local, excluida en `.gitignore`):**
  - `PROJECT_CONTEXT.md`: contexto técnico, arquitectura, flujo de trabajo, incidencias resueltas y limitaciones.
  - `PROJECT_STATUS.md`: estado operativo real, tareas externas pendientes e instrucciones para retomar el mantenimiento.
  - `DECISIONS.md`: registro consolidado de decisiones técnicas y arquitectónicas (`ADR-001` a `ADR-064`).
  - `FILE_INDEX.md`: inventario documental y clasificación de archivos del proyecto.
  - `REPRODUCTION.md`: entorno, versiones, comandos exactos, validación y recuperación ante errores.

---

## Ejecución rápida en local

```bash
python3 scripts/build_data.py
python3 scripts/validate_data.py
python3 -m unittest tests/test_data_pipeline.py
python3 -m http.server 8085
```

Abrir `http://localhost:8085` en el navegador.

---

## Limitaciones conocidas y líneas de continuación

- **Limitaciones conocidas:** 2022 carece de serie semihoraria (`30min.csv`) en el repositorio de origen (solo serie diaria de 365 días, sin cálculo de horas de sol de 2022); 2023 presenta un hueco instrumental de 20 días (`2023-09-22` a `2023-10-12`); el año 2026 es provisional hasta su cierre tras `2026-12-31`.
- **Líneas de continuación:** incorporación opcional de registros históricos de 2020–2021 o de la serie semihoraria de 2022 si se publican en origen, cierre definitivo del almanaque 2026 en enero de 2027 y seguimiento de indexación en Google Search Console.

---

## Fuentes y licencia

- **Repositorio primario de datos abiertos:** [https://github.com/egofer/meteoriotuerto/](https://github.com/egofer/meteoriotuerto/)
- **Licencia:** Los datos y análisis se comparten bajo licencia **Creative Commons Atribución 4.0 Internacional (CC BY 4.0)** citando al proyecto **MeteoRiotuerto**.
