# MeteoRiotuerto — Almanaque meteorológico y climatológico digital de Riotuerto

Publicación digital, archivo histórico y notario del clima local de **Barrio de Arriba, municipio de Riotuerto (Cantabria, España · 115 m s. n. m.)**, elaborada a partir de los registros instrumentales de la estación meteorológica automática **MeteoRiotuerto**.

---

## Propósito editorial

**MeteoRiotuerto** no es una aplicación de predicción meteorológica ni un monitor de condiciones instantáneas (función que ya cubre el [panel en directo de la estación en Ecowitt](https://www.ecowitt.net/home/index?id=33161)). Su misión es **conservar, analizar, interpretar y difundir la memoria atmosférica del municipio**, respondiendo con rigor y claridad divulgativa a preguntas como:

- ¿Cómo fue meteorológicamente cada año en Riotuerto?
- ¿Qué extremos de temperatura, precipitación y viento se han registrado y en qué fechas?
- ¿Cuántos días de helada, calor, noches tropicales o lluvia torrencial se produjeron?
- ¿Cómo se comparan unos años con otros dentro de la serie observada?
- ¿Qué episodios atmosféricos (suradas por efecto Foehn, temporales atlánticos, inversiones térmicas) caracterizaron cada estación?

---

## Arquitectura y organización del repositorio

El proyecto sigue una arquitectura estática desacoplada (**JAMstack**) diseñada para alojarse gratuitamente en **GitHub Pages** sin necesidad de servidores dinámicos ni bases de datos:

```text
meteoriotuerto-web/
├── .github/workflows/
│   └── deploy.yml              # Automatización de pruebas, generación de JSONs y publicación en GitHub Pages
├── contexto/                   # Documentación de gestión de contexto y decisiones técnicas (ADR)
├── data/                       # Productos JSON estáticos precompilados y validados
│   ├── index.json              # Metadatos globales, cobertura y síntesis interanual
│   ├── records.json            # Récords absolutos, rankings Top 10 y extremos por mes
│   ├── comparisons.json        # Matrices comparativas multianuales y anomalías
│   └── almanac_YYYY.json       # Almanaques anuales completos y series diarias (2022–2026)
├── docs/
│   ├── METODOLOGIA.md          # Criterios científicos, fórmulas estadísticas y auditoría de datos
│   └── GUIA_DESPLIEGUE.md      # Instrucciones de ejecución local, actualización y GitHub Pages
├── scripts/
│   ├── build_data.py           # Procesador en Python (limpieza, cálculo estadístico y exportación atómica)
│   └── validate_data.py        # Verificador de esquemas JSON e invariantes físicos
├── src/
│   ├── css/styles.css          # Diseño editorial adaptativo (modo claro y oscuro)
│   └── js/app.js               # Lógica de vistas, almanaques, explorador y gráficos Chart.js
├── tests/
│   └── test_data_pipeline.py   # Suite de pruebas automatizadas sobre los datos reales
├── index.html                  # Documento principal de la aplicación
└── requirements.txt            # Dependencias de procesamiento en Python
```

---

## Uso rápido en local

```bash
# 1. Regenerar los productos JSON desde el repositorio de datos originales
python3 scripts/build_data.py

# 2. Validar la integridad de los datos y ejecutar las pruebas unitarias
python3 scripts/validate_data.py
python3 -m unittest discover -s tests -v

# 3. Servir la aplicación web localmente
python3 -m http.server 8000
```
Abra `http://localhost:8000` en su navegador.

Consulte [`docs/METODOLOGIA.md`](./docs/METODOLOGIA.md) para el detalle de los criterios científicos y [`docs/GUIA_DESPLIEGUE.md`](./docs/GUIA_DESPLIEGUE.md) para las instrucciones paso a paso de publicación en GitHub Pages.

---

## Fuentes y licencia

- **Repositorio primario de datos abiertos:** [https://github.com/egofer/meteoriotuerto/](https://github.com/egofer/meteoriotuerto/)
- **Panel en tiempo real de la estación:** [https://www.ecowitt.net/home/index?id=33161](https://www.ecowitt.net/home/index?id=33161)
- **Atribución:** Los datos y análisis se comparten con fines divulgativos, educativos y científicos citando al proyecto **MeteoRiotuerto**.
