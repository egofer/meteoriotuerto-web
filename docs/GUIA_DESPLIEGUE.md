# Guía de ejecución local, actualización de datos y publicación en GitHub Pages

## 1. Requisitos del entorno local
- **Python:** versión 3.10 o superior.
- **Dependencias de Python:** `pandas>=2.0.0`, `numpy>=1.24.0` (instalables mediante `pip install -r requirements.txt`).
- **Navegador web moderno:** cualquier navegador compatible con ES6 (Firefox, Chrome, Chromium, Safari, Edge).
- **Servidor HTTP estático local:** el módulo nativo `http.server` de Python (no requiere Node.js ni servidores complejos).

---

## 2. Ejecución del proyecto en local

Desde el directorio raíz del proyecto (`meteoriotuerto-web`):

### Paso 1. Regenerar los productos JSON a partir de los datos originales
```bash
python3 scripts/build_data.py
```
- Si existe el repositorio local hermano `../meteoriotuerto`, el script lo detecta automáticamente y lee los archivos CSV sin modificarlos.
- Si no existe dicha carpeta local (por ejemplo en un entorno limpio o en GitHub Actions), el script descarga automáticamente los CSVs desde `https://github.com/egofer/meteoriotuerto` hacia `.cache/meteoriotuerto/`.

### Paso 2. Validar los datos y ejecutar las pruebas automatizadas
```bash
python3 scripts/validate_data.py
python3 -m unittest discover -s tests -v
```

### Paso 3. Levantar el servidor web local y abrir la aplicación
```bash
python3 -m http.server 8085
```
A continuación, abra en su navegador:
- `http://localhost:8085/` (Portada)
- `http://localhost:8085/#almanaque/2025` (Almanaque anual 2025)
- `http://localhost:8085/#explorador` (Explorador de datos históricos)
- `http://localhost:8085/#records` (Récords meteorológicos)
- `http://localhost:8085/#comparativas` (Comparativas entre años)
- `http://localhost:8085/#metodologia` (Metodología y calidad de los datos)

---

## 3. Publicación en un repositorio independiente y configuración de GitHub Pages

### Paso 1. Crear el repositorio remoto en GitHub
1. Acceda a [https://github.com/new](https://github.com/new) con la cuenta `egofer`.
2. Nombre del repositorio: **`meteoriotuerto-web`**.
3. Visibilidad: **Public** (necesario para utilizar GitHub Pages de forma gratuita).
4. Deje desmarcadas las opciones de inicializar con `README`, `.gitignore` o licencia (ya están creados en este directorio).

### Paso 2. Vincular y subir el repositorio local
Desde el directorio raíz de `meteoriotuerto-web`:
```bash
git remote add origin https://github.com/egofer/meteoriotuerto-web.git
git branch -M main
git push -u origin main
```

### Paso 3. Activar GitHub Pages mediante GitHub Actions
1. En el repositorio `https://github.com/egofer/meteoriotuerto-web`, abra la pestaña **Settings** → menú lateral **Pages**.
2. En el apartado **Build and deployment** → **Source**, seleccione **GitHub Actions** en el desplegable.
3. Abra la pestaña **Actions** del repositorio: verá el flujo **«Actualizar datos, validar y desplegar en GitHub Pages»** (`.github/workflows/deploy.yml`).
4. Una vez finalizada la acción (aproximadamente 45 segundos), la web quedará publicada en:
   **`https://egofer.github.io/meteoriotuerto-web/`**

> **Nota sobre rutas en subdirectorios:** Toda la aplicación utiliza rutas relativas (`./data/...`, `./src/...`) y enrutamiento por *hash* (`#almanaque/2025`), por lo que funciona sin ninguna configuración adicional tanto en un subdirectorio (`/meteoriotuerto-web/`) como en la raíz de un dominio propio.

---

## 4. Proceso de actualización automática de los datos

Existen tres formas complementarias e idempotentes de mantener actualizado el ecosistema de datos de MeteoRiotuerto:

### Opción 1: Automatización 100 % Cloud en GitHub Actions (Recomendada)
Toda la cadena de descarga, procesado, sincronización y despliegue web se ejecuta de manera autónoma en la nube de GitHub sin depender de tener encendido ningún ordenador ni NAS:
1. **Flujo de origen en `egofer/ecowitt_downloader` (`.github/workflows/daily_sync.yml`):**
   - Se ejecuta diariamente a las 05:00 UTC (06:00/07:00 hora peninsular) o bajo demanda mediante *workflow_dispatch*.
   - Utiliza secretos seguros de GitHub (`ECOWITT_APPLICATION_KEY`, `ECOWITT_API_KEY`, `ECOWITT_DEVICE_MAC`, `GH_PAT`).
   - Descarga los datos de la estación con `ecowitt_downloader.py`.
   - Genera resúmenes y gráficos con `sync_meteoriotuerto.py`.
   - Realiza `git commit` y `push` automático al repositorio de datos `egofer/meteoriotuerto`.
   - Dispara un evento `repository_dispatch` hacia `egofer/meteoriotuerto-web`.
2. **Flujo receptor en `egofer/meteoriotuerto-web` (`.github/workflows/deploy.yml`):**
   - Recibe el evento `meteoriotuerto_data_updated`.
   - Compila los productos JSON optimizados (`scripts/sync_data.py`).
   - Ejecuta la batería de validaciones y tests automatizados (21 tests).
   - Publica los cambios y despliega automáticamente la nueva versión en GitHub Pages.

### Opción 2: Sincronización atómica desde el flujo diario local (`scripts/sync_data.py` y `run_daily.sh`)
El script `scripts/sync_data.py` orquesta en un solo paso la compilación (`build_data.py`), la auditoría de invariantes (`validate_data.py`), las pruebas unitarias (`unittest`), la comparación semántica de cambios (ignorando marcas de tiempo efímeras si no hay datos nuevos) y la publicación en GitHub:
```bash
python3 scripts/sync_data.py --push
```
En la rutina diaria `run_daily.sh` de `ecowitt_downloader`, este comando se ejecuta automáticamente como **Paso 4** inmediatamente después de actualizar el repositorio primario `meteoriotuerto`. Si cualquier test o validación fallara, `sync_data.py` restaura automáticamente la instantánea previa de `data/*.json` y aborta sin publicar datos corruptos.

### Opción B: Disparo reactivo entre repositorios en la nube (`repository_dispatch`)
1. **En el repositorio primario (`egofer/meteoriotuerto`):**
   - Se configura el secreto `DISPATCH_TOKEN` en *Settings → Secrets and variables → Actions*.
   - El flujo `.github/workflows/notify_web.yml` (cuya plantilla se incluye en `docs/notify_web.yml`) envía el evento `meteoriotuerto_data_updated` a la API de GitHub cada vez que se actualizan los archivos `**/data/*.csv`, o bien puede dispararse desde línea de comandos con:
     ```bash
     DISPATCH_TOKEN="..." python3 scripts/sync_data.py --dispatch-only
     ```
2. **En este repositorio (`egofer/meteoriotuerto-web`):**
   - El archivo `.github/workflows/deploy.yml` (y su copia en `docs/deploy.yml`) escucha `repository_dispatch: types: [meteoriotuerto_data_updated]`, además del `cron` diario (`30 6 * * *`) y `workflow_dispatch`.
   - Ejecuta `python3 scripts/sync_data.py --source-dir .cache/meteoriotuerto --output-dir data`, confirma los nuevos JSON en `main` si hubo cambios reales y despliega en GitHub Pages.
