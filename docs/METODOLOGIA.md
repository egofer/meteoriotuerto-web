# Metodología científica, criterios estadísticos y control de calidad

## 1. Objeto y alcance del documento
Este documento describe con rigor metodológico los procedimientos empleados en **MeteoRiotuerto** para transformar los registros instrumentales de la estación meteorológica automática de Barrio de Arriba (Riotuerto, Cantabria) en los indicadores climáticos, series históricas, efemérides y comparativas publicados en la web.

---

## 2. Emplazamiento e instrumentación verificada

### 2.1. Coordenadas y entorno fisiográfico
- **Localidad y municipio:** Barrio de Arriba, Riotuerto (Cantabria, España).
- **Coordenadas geográficas:** `43.341° N, -3.670° O` (sistema de referencia WGS84 / EPSG:4326).
- **Altitud:** 115 metros sobre el nivel del mar.
- **Zona horaria de referencia:** `Europe/Madrid` (UTC+1 en horario de invierno, UTC+2 en horario de verano).
- **Singularidades topográficas:** Ubicada en el fondo del valle del río Covadal (afluente de la cuenca del Miera), a 14 km de la costa cantábrica y a 5 km del puerto de Alisas. Presenta una acusada retención orográfica ante flujos húmedos del noroeste y episodios de recalentamiento adiabático (efecto Foehn) durante advecciones del sur.

### 2.2. Equipamiento meteorológico
- **Conjunto de sensores exteriores:** Estación automática **Sainlogic WS3500** instalada en mástil de 3 metros libre de obstáculos inmediatos.
- **Pasarela de adquisición:** **Ecowitt GW1200**.
- **Intervalo de muestreo y archivo:** 30 minutos.
- **Inicio de operaciones:** 29 de noviembre de 2020 (serie consolidada en el repositorio de datos abiertos desde el 1 de enero de 2022).

---

## 3. Cobertura temporal y auditoría de los archivos originales

Antes de generar los productos JSON, el motor de procesamiento (`scripts/build_data.py`) audita los archivos CSV del repositorio primario `egofer/meteoriotuerto`:

1. **Año 2022 (`riotuerto_2022_daily.csv`):**
   - Serie diaria completa con **365 días válidos sobre 365 (100 %)**.
   - No existe archivo semihorario (`30min.csv`) publicado en el repositorio para 2022. En consecuencia, para este año las estadísticas diarias, mensuales y anuales son exactas, pero no se calculan horas de insolación directa ni extremos subdiarios.
2. **Año 2023 (`riotuerto_2023_daily.csv` y `riotuerto_2023_30min.csv`):**
   - Serie diaria con **340 días válidos sobre 365 (93,2 %)**. Existe una interrupción técnica documentada de 20 días entre el 22 de septiembre y el 12 de octubre de 2023 (además de 5 jornadas aisladas).
   - En el archivo bruto `riotuerto_2023_30min.csv` se detectó un bloque incrustado de 340 filas de resúmenes diarios (índices 42 a 381) y 288 filas correspondientes a enero de 2024. El procesador filtra automáticamente ambos bloques sin alterar el archivo original, conservando los **15.629 registros intradiarios** propios de 2023.
3. **Año 2024 (`riotuerto_2024_diario.csv` y `riotuerto_2024_30min.csv`):**
   - Año bisiesto con **359 días válidos sobre 366 (98,1 %)**.
   - El archivo `riotuerto_2024_diario.csv` emplea coma decimal entrecomillada (`"10,7"`), cabeceras de categoría en español e incluye 6 columnas de temperatura y humedad interior. El procesador normaliza el separador decimal y excluye los sensores interiores para mantener la homogeneidad estricta con el resto de la serie exterior.
   - El archivo bruto `riotuerto_2024_30min.csv` contenía el año concatenado por duplicado (33.366 filas). Tras deduplicar marcas temporales y excluir registros de 2023 y 2025, se obtienen **16.582 registros semihorarios únicos**.
4. **Año 2025 (`riotuerto_2025_daily.csv` y `riotuerto_2025_30min.csv`):**
   - Serie prácticamente íntegra con **364 días válidos sobre 365 (99,7 %)** y **17.244 registros semihorarios**. Incorpora la variable de déficit de presión de vapor (`VPD`) a partir de agosto de 2025.
5. **Año 2026 (`riotuerto_2026_daily.csv` y `riotuerto_2026_30min.csv`):**
   - Año actualmente en curso con **298 días válidos (100 % del periodo transcurrido entre el 01/01/2026 y el 25/10/2026)** y **14.197 registros semihorarios**. Se identifica en toda la web con etiqueta de **carácter provisional** y se excluye del cálculo de la media interanual de referencia (2022–2025).

---

## 4. Definición matemática de los indicadores

### 4.1. Termometría
- **Temperatura media diaria ($T_{\text{med}}$):** Promedio aritmético de los registros de 30 minutos del día natural (`00:00` a `23:59` hora local).
- **Temperatura máxima ($T_{\text{máx}}$) y mínima diaria ($T_{\text{mín}}$):** Valor máximo de la columna `Temperature High(℃)` y valor mínimo de `Temperature Low(℃)` registrados durante el día natural.
- **Amplitud u oscilación térmica diaria ($\Delta T$):** Diferencia $\Delta T = T_{\text{máx}} - T_{\text{mín}}$ en un mismo día natural.
- **Umbrales térmicos contabilizados:**
  - *Día de helada:* $T_{\text{mín}} \le 0,0\text{ °C}$.
  - *Día cálido:* $T_{\text{máx}} \ge 25,0\text{ °C}$.
  - *Día de calor:* $T_{\text{máx}} \ge 30,0\text{ °C}$.
  - *Día de calor intenso:* $T_{\text{máx}} \ge 35,0\text{ °C}$.
  - *Día de calor extremo:* $T_{\text{máx}} \ge 40,0\text{ °C}$.
  - *Noche tropical:* $T_{\text{mín}} \ge 20,0\text{ °C}$.
  - *Noche ecuatorial o tórrida:* $T_{\text{mín}} \ge 25,0\text{ °C}$.

### 4.2. Pluviometría
- **Precipitación diaria ($P_{\text{día}}$):** Acumulado máximo diario alcanzado por el contador pluviométrico (`Daily(mm)`) al cierre del día natural.
- **Umbrales de días de lluvia:**
  - *Día de lluvia apreciable:* $P_{\text{día}} \ge 0,2\text{ mm}$ (paso mínimo de báscula del pluviómetro).
  - *Día de lluvia significativa:* $P_{\text{día}} \ge 1,0\text{ mm}$.
  - *Día de lluvia abundante:* $P_{\text{día}} \ge 10,0\text{ mm}$.
  - *Día de lluvia muy fuerte o torrencial:* $P_{\text{día}} \ge 30,0\text{ mm}$.
- **Rachas húmedas y secas:** Número máximo de días consecutivos con observación válida que cumplen $P_{\text{día}} \ge 0,2\text{ mm}$ (racha húmeda) o $P_{\text{día}} < 0,2\text{ mm}$ (racha seca). Si existe un hueco instrumental de días sin datos, la secuencia se corta para no fusionar periodos separados por una incógnita.

### 4.3. Anemometría
- **Velocidad media diaria y anual:** Media aritmética de la velocidad del viento en $\text{km/h}$.
- **Racha máxima:** Valor máximo alcanzado por `Wind Gust(km/h)` en el día, mes o año.
- **Rosa de los vientos (16 sectores):** Clasificación de los acimuts en 16 sectores de $22,5^\circ$ centrados en los rumbos cardinales, colaterales y subcolaterales ($\text{N}, \text{NNE}, \dots, \text{NNW}$).

### 4.4. Radiación solar e insolación estimada
- **Irradiancia solar máxima validada:** Valor máximo en $\text{W/m}^2$ que no supere la constante solar extraterrestre ($1.361\text{ W/m}^2$).
- **Horas de insolación directa estimada:** Siguiendo el criterio de la OMM, suma de intervalos semihorarios con irradiancia media $\ge 120\text{ W/m}^2$ multiplicada por $0,5\text{ h}$.

### 4.5. Identificación algorítmica de patrones compatibles con «surada» y efecto Foehn (EVO-005)
Dado que una estación meteorológica en superficie registra variables locales en un único punto del valle y no el campo barométrico sinóptico tridimensional, el procesador identifica **patrones instrumentales compatibles con episodios de «surada» / efecto Foehn** cuando concurren:
1. **Umbral direccional empírico (`120°–245°`):** Rumbo medio diario o al menos 4 intervalos semihorarios ($\ge 2\text{ h}$) con humedad relativa $\le 45\text{ \%}$ comprendidos entre $120^\circ$ y $245^\circ$. Este intervalo amplía ligeramente el cuadrante sur meteorológico estándar ($135^\circ\text{–}225^\circ$, SE–S–SO) de forma empírica para cubrir la canalización local del flujo observada en la veleta de Barrio de Arriba tanto en episodios de compresión térmica encauzados desde el SE–SSE ($124^\circ\text{–}159^\circ$) como en vendavales del SSO–SO ($203^\circ\text{–}233^\circ$).
2. **Ausencia de precipitación frontal relevante:** Precipitación diaria $< 5,0\text{ mm}$.
3. **Firma termohigrométrica o eólica:**
   - *Patrón eólico:* racha máxima diaria $\ge 35,0\text{ km/h}$ y humedad relativa mínima $\le 45\text{ \%}$.
   - *Patrón de compresión adiabática cálida:* humedad relativa mínima $\le 38\text{ \%}$ acompañada de temperatura máxima $\ge 28,0\text{ °C}$ o amplitud térmica diaria $\ge 16,0\text{ °C}$ (con racha $\ge 22,0\text{ km/h}$).

---

## 5. Control de calidad y tratamiento de anomalías

1. **Prohibición de interpolación:** Los huecos temporales se mantienen explícitamente como `null`. Nunca se inventan ni interpolan valores para rellenar días ausentes.
2. **Detección de paquetes de radiofrecuencia corruptos:**
   - En la auditoría de `riotuerto_2024_30min.csv` se identificó en la marca `2024-05-31 04:30:00` un paquete de telemetría espurio con $T_{\text{mín}} = -14,6\text{ °C}$, humedad mínima del $1\text{ \%}$ e irradiancia de $1.655,2\text{ W/m}^2$ en plena noche (mientras a las `04:00` y `05:00` la temperatura era de $10,4\text{ °C}$ y $11,1\text{ °C}$ con $99\text{ \%}$ de humedad). En el archivo diario oficial `riotuerto_2024_diario.csv` la temperatura mínima ya había sido corregida por el titular de la estación a $10,3\text{ °C}$. Nuestro pipeline aplica esa misma depuración sobre el registro intradiario y sobre la humedad/radiación de ese paquete, dejando constancia auditable en el bloque `quality_audit` del JSON anual.
   - Asimismo, lecturas aisladas de `UVI >= 13` en horario nocturno o con radiación nula se anulan en la serie validada, conservando el valor bruto en el campo `uvi_max_raw` a efectos de trazabilidad instrumental.

---

## 6. Longitud de serie, representatividad climatológica y tendencias

1. **Utilidad de las comparaciones anuales:** Los almanaques anuales y las herramientas de comparativa interanual permiten contrastar de forma rigurosa la variabilidad meteorológica reciente en Barrio de Arriba (Riotuerto), identificar episodios extremos y conocer cómo se comportó cada ejercicio respecto a los demás años observados.
2. **Limitación temporal según normativa OMM:** De acuerdo con las normas de la Organización Meteorológica Mundial (OMM), la fijación de «normales climatológicas estándar» exige series continuadas y homogéneas de al menos 30 años (e.g. 1991–2020).
3. **No atribución de tendencias:** Con registros completos desde 2022, **la web todavía no permite establecer normales climatológicas oficiales ni atribuir tendencias climáticas sólidas con garantías estadísticas**. Las anomalías calculadas en la web toman como referencia exclusivamente la línea base de los años completos observados (2022–2025) a efectos meramente descriptivos.
