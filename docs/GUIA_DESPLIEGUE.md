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
python3 -m http.server 8000
```
A continuación, abra en su navegador:
- `http://localhost:8000/` (Portada)
- `http://localhost:8000/#almanaque/2025` (Almanaque anual 2025)
- `http://localhost:8000/#explorador` (Explorador de datos históricos)
- `http://localhost:8000/#records` (Récords meteorológicos)
- `http://localhost:8000/#comparativas` (Comparativas entre años)
- `http://localhost:8000/#metodologia` (Metodología y calidad de los datos)

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

## 4. Proceso de actualización de los datos

Existen dos mecanismos complementarios y seguros para mantener actualizado el almanaque digital:

### Opción A: Actualización automática en la nube (GitHub Actions)
El archivo `.github/workflows/deploy.yml` incluye un disparador programado (`cron: '30 6 * * *'`) y un disparador manual (`workflow_dispatch`):
1. Descarga la última versión disponible del repositorio de datos `egofer/meteoriotuerto`.
2. Ejecuta `python3 scripts/build_data.py` de forma atómica.
3. Ejecuta `python3 scripts/validate_data.py` y la batería de pruebas `unittest`.
4. **Salvaguarda de integridad:** Si se produjera cualquier error de descarga, formato corrupto o fallo en algún test, el flujo se detiene inmediatamente en el paso de validación y **no ejecuta el despliegue**, preservando intacta la última versión válida publicada en GitHub Pages.

### Opción B: Actualización desde el flujo diario local (`run_daily.sh`)
Si desea que la máquina local regenere y publique también los JSONs del repositorio web tras sincronizar `meteoriotuerto`, basta con añadir al final de su rutina local:
```bash
cd /ruta/a/meteoriotuerto-web
python3 scripts/build_data.py && python3 scripts/validate_data.py
git add data/
if ! git diff --cached --quiet; then
    git commit -m "data: actualización automática de productos JSON del almanaque [$(date '+%Y-%m-%d')]"
    git push origin main
fi
```
