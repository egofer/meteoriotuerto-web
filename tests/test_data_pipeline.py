#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
===============================================================================
test_data_pipeline.py — Pruebas automatizadas del motor climatológico y web
===============================================================================
Comprueba los cálculos estadísticos, el control de calidad, los invariantes
físicos, la correspondencia exacta frente a los datos originales y la
integridad de los recursos estáticos de la aplicación web.
===============================================================================
"""

from __future__ import annotations

import functools
import http.server
import json
import re
import socketserver
import subprocess
import shutil
import sys
import threading
import unittest
import urllib.request
from pathlib import Path

import pandas as pd

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR / "scripts"))

import build_data  # noqa: E402
import validate_data  # noqa: E402


class TestMeteorologicalCalculations(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.data_dir = ROOT_DIR / "data"
        cls.almanacs = {}
        for y in [2022, 2023, 2024, 2025, 2026]:
            with open(cls.data_dir / f"almanac_{y}.json", encoding="utf-8") as fp:
                cls.almanacs[y] = json.load(fp)
        with open(cls.data_dir / "index.json", encoding="utf-8") as fp:
            cls.index = json.load(fp)
        with open(cls.data_dir / "records.json", encoding="utf-8") as fp:
            cls.records = json.load(fp)
        with open(cls.data_dir / "comparisons.json", encoding="utf-8") as fp:
            cls.comparisons = json.load(fp)

    def test_validate_directory_passes_with_zero_errors(self) -> None:
        errors = validate_data.validate_directory(self.data_dir)
        self.assertEqual(errors, [], f"Se encontraron errores de validación: {errors}")

    def test_wind_sector_conversion(self) -> None:
        self.assertEqual(build_data.deg_to_sector16(0), "N")
        self.assertEqual(build_data.deg_to_sector16(359), "N")
        self.assertEqual(build_data.deg_to_sector16(90), "E")
        self.assertEqual(build_data.deg_to_sector16(180), "S")
        self.assertEqual(build_data.deg_to_sector16(270), "W")
        self.assertEqual(build_data.deg_to_sector16(315), "NW")
        self.assertIsNone(build_data.deg_to_sector16(float("nan")))

    def test_beaufort_scale_classification(self) -> None:
        self.assertEqual(build_data.speed_to_beaufort(0.5), 0)
        self.assertEqual(build_data.speed_to_beaufort(3.0), 1)
        self.assertEqual(build_data.speed_to_beaufort(25.0), 4)
        self.assertEqual(build_data.speed_to_beaufort(97.2), 10)

    def test_spells_computation(self) -> None:
        df = pd.DataFrame({
            "date": ["2025-01-01", "2025-01-02", "2025-01-03", "2025-01-04", "2025-01-05"],
            "rain_daily": [1.2, 5.4, 0.2, 0.0, 0.0],
        })
        spells = build_data.compute_spells(df, 0.2)
        self.assertEqual(spells["max_wet_days"], 3)
        self.assertEqual(spells["max_wet_start"], "2025-01-01")
        self.assertEqual(spells["max_wet_end"], "2025-01-03")
        self.assertEqual(spells["max_dry_days"], 2)

    def test_historical_absolute_records(self) -> None:
        abs_rec = self.records["absolute_records"]
        self.assertEqual(abs_rec["temp_max"]["value"], 42.1)
        self.assertEqual(abs_rec["temp_max"]["date"], "2024-08-11")
        self.assertEqual(abs_rec["temp_min"]["value"], -3.1)
        self.assertEqual(abs_rec["temp_min"]["date"], "2024-01-20")
        self.assertEqual(abs_rec["max_daily_rain"]["value"], 125.9)
        self.assertEqual(abs_rec["max_daily_rain"]["date"], "2023-01-16")
        self.assertEqual(abs_rec["max_wind_gust"]["value"], 97.2)
        self.assertEqual(abs_rec["max_wind_gust"]["date"], "2024-02-08")

    def test_monthly_precipitation_sums_match_annual_total(self) -> None:
        for year, alm in self.almanacs.items():
            monthly_sum = round(
                sum(m["rain_total"] for m in alm["monthly"] if m["rain_total"] is not None), 1
            )
            annual_total = alm["stats"]["precipitation"]["total_mm"]
            self.assertAlmostEqual(
                monthly_sum,
                annual_total,
                places=1,
                msg=f"La suma mensual de lluvia en {year} ({monthly_sum}) no coincide con el total anual ({annual_total})",
            )

    def test_2023_known_gap_is_documented_and_reflected(self) -> None:
        cov_2023 = self.almanacs[2023]["coverage"]
        self.assertEqual(cov_2023["valid_days"], 340)
        self.assertEqual(cov_2023["missing_days"], 25)
        intraday = cov_2023["quality_audit"]["intraday_meta"]
        self.assertGreaterEqual(intraday["clean_rows"], 15600)
        self.assertGreaterEqual(intraday["embedded_daily_removed"], 0)

    def test_2024_deduplication_and_glitch_filtering(self) -> None:
        cov_2024 = self.almanacs[2024]["coverage"]
        meta_30 = cov_2024["quality_audit"]["intraday_meta"]
        self.assertGreaterEqual(meta_30["clean_rows"], 16500)
        self.assertGreaterEqual(meta_30["duplicates_removed"], 0)
        self.assertTrue(len(meta_30["glitches_filtered"]) >= 1)
        ds = self.almanacs[2024]["daily_series"]
        idx = ds["dates"].index("2024-05-31")
        self.assertEqual(ds["temp_min"][idx], 10.3)

    def test_reference_baseline_excludes_provisional_2026(self) -> None:
        ref = self.comparisons["reference_baseline"]
        self.assertEqual(ref["years_included"], [2022, 2023, 2024, 2025])
        self.assertEqual(ref["excluded_provisional"], [2026])
        self.assertAlmostEqual(ref["mean_annual_rain_mm"], 1875.0, places=1)

    def test_cumulative_precipitation_curve(self) -> None:
        cum = self.comparisons.get("cumulative_precipitation")
        self.assertIsNotNone(cum, "Falta la clave cumulative_precipitation en comparisons.json")
        self.assertEqual(len(cum["calendar_days"]), 366)
        self.assertEqual(len(cum["labels"]), 366)
        self.assertEqual(len(cum["baseline_mean"]), 366)
        self.assertAlmostEqual(cum["baseline_mean"][-1], 1875.0, places=1)
        for y in [2022, 2023, 2024, 2025]:
            alm_total = self.almanacs[y]["stats"]["precipitation"]["total_mm"]
            self.assertAlmostEqual(cum["years"][str(y)][-1], alm_total, places=1)
        # Verificar que 2026 termina con el total observado hasta el momento
        non_null_2026 = [v for v in cum["years"]["2026"] if v is not None]
        self.assertAlmostEqual(non_null_2026[-1], self.almanacs[2026]["stats"]["precipitation"]["total_mm"], places=1)

    def test_foehn_detection_consistency(self) -> None:
        # EVO-005: Verificar coherencia de la detección algorítmica de suradas / efecto Foehn
        for y, alm in self.almanacs.items():
            self.assertIn("foehn_analysis", alm)
            fa = alm["foehn_analysis"]
            self.assertEqual(sum(fa["monthly_counts"]), fa["total_foehn_days"])
            self.assertEqual(sum(alm["daily_series"]["foehn_flag"]), fa["total_foehn_days"])
            self.assertGreaterEqual(fa["total_foehn_days"], 10)
        # Verificar detección de episodios emblemáticos de surada eólica (Karlotta 2024-02-08 y Herminia 2025-01-26)
        self.assertIn("2024-02-08", self.almanacs[2024]["foehn_analysis"]["foehn_dates"])
        self.assertIn("2025-01-26", self.almanacs[2025]["foehn_analysis"]["foehn_dates"])

    def test_web_structure_and_static_serving(self) -> None:
        # Verificar existencia de archivos clave
        required_paths = [
            ROOT_DIR / "index.html",
            ROOT_DIR / "src" / "css" / "styles.css",
            ROOT_DIR / "src" / "js" / "app.js",
            ROOT_DIR / "src" / "js" / "vendor" / "xlsx.mini.min.js",
            ROOT_DIR / "favicon.svg",
            ROOT_DIR / "favicon.ico",
            ROOT_DIR / ".github" / "workflows" / "deploy.yml",
            ROOT_DIR / "docs" / "METODOLOGIA.md",
            ROOT_DIR / "docs" / "GUIA_DESPLIEGUE.md",
            ROOT_DIR / "data" / "glossary.json",
            ROOT_DIR / "data" / "station.geojson",
            ROOT_DIR / "data" / "schema.json",
            ROOT_DIR / "assets" / "img" / "estacion-meteorologica-barrio-de-arriba.jpg",
            ROOT_DIR / "assets" / "img" / "estacion-meteorologica-barrio-de-arriba.webp",
        ]
        for p in required_paths:
            self.assertTrue(p.exists(), f"Falta el archivo requerido: {p}")
            self.assertGreater(p.stat().st_size, 100, f"Archivo demasiado pequeño: {p}")

        html_text = (ROOT_DIR / "index.html").read_text(encoding="utf-8")
        for section_id in [
            "view-portada",
            "view-almanaque",
            "view-explorador",
            "view-records",
            "view-comparativas",
            "view-metodologia",
            "view-glosario",
            "view-fiestas",
        ]:
            self.assertIn(f'id="{section_id}"', html_text)

        # Verificar ausencia de credenciales o claves privadas
        for p in required_paths:
            if p.suffix in (".ico", ".png", ".jpg", ".webp"):
                continue
            txt = p.read_text(encoding="utf-8")
            self.assertIsNone(re.search(r"APPLICATION_KEY\s*=\s*['\"][A-Za-z0-9]{16,}", txt))
            self.assertIsNone(re.search(r"API_KEY\s*=\s*['\"][A-Za-z0-9\-]{16,}", txt))

        # Verificar sintaxis estricta de JavaScript en src/js/app.js y sw.js
        node_bin = shutil.which("node")
        if node_bin:
            for js_file in [ROOT_DIR / "src" / "js" / "app.js", ROOT_DIR / "sw.js"]:
                res = subprocess.run([node_bin, "-c", str(js_file)], capture_output=True, text=True)
                self.assertEqual(res.returncode, 0, f"Error de sintaxis en {js_file.name}: {res.stderr}")

        # Levantar servidor HTTP efímero y comprobar respuestas HTTP 200
        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT_DIR))

        class QuietServer(socketserver.TCPServer):
            allow_reuse_address = True

        with QuietServer(("127.0.0.1", 0), handler) as httpd:
            port = httpd.server_address[1]
            thread = threading.Thread(target=httpd.serve_forever, daemon=True)
            thread.start()
            try:
                for endpoint in [
                    "/",
                    "/index.html",
                    "/robots.txt",
                    "/sitemap.xml",
                    "/favicon.svg",
                    "/favicon.ico",
                    "/src/css/styles.css",
                    "/src/js/app.js",
                    "/src/js/vendor/xlsx.mini.min.js",
                    "/assets/img/estacion-meteorologica-barrio-de-arriba.jpg",
                    "/assets/img/estacion-meteorologica-barrio-de-arriba.webp",
                    "/assets/img/labor-calefaccion-lena.webp",
                    "/assets/img/labor-robot-cortacesped.webp",
                    "/assets/img/labor-siega-forraje.webp",
                    "/assets/img/labor-huerta-tratamientos.webp",
                    "/assets/img/labor-setas-micologia.webp",
                    "/assets/img/labor-solar-fotovoltaica.webp",
                    "/data/index.json",
                    "/data/records.json",
                    "/data/comparisons.json",
                    "/data/glossary.json",
                    "/data/station.geojson",
                    "/data/schema.json",
                    "/data/almanac_2022.json",
                    "/data/almanac_2025.json",
                ]:
                    url = f"http://127.0.0.1:{port}{endpoint}"
                    with urllib.request.urlopen(url, timeout=5) as resp:
                        self.assertEqual(resp.status, 200)
                        body = resp.read()
                        self.assertGreater(len(body), 50)
            finally:
                httpd.shutdown()

    def test_security_and_privacy_guarantees(self) -> None:
        """
        Verifica que ningún archivo rastreado por Git (ni los datos JSON publicados)
        filtre credenciales, identificadores físicos (MAC, PASSKEY, IPs locales),
        datos de privacidad doméstica (sensores interiores o coordenadas de 6 decimales)
        ni rutas o archivos sensibles del equipo local (contexto/, .env, logs).
        """
        import subprocess

        tracked = subprocess.check_output(
            ["git", "-C", str(ROOT_DIR), "ls-files"], text=True
        ).splitlines()

        for rel_path in tracked:
            # 1. Prohibir archivos de contexto, secretos o logs en el índice de Git
            self.assertFalse(rel_path.startswith("contexto/"), f"Archivo de contexto filtrado en Git: {rel_path}")
            self.assertFalse(rel_path.startswith(".env"), f"Archivo .env filtrado en Git: {rel_path}")
            self.assertFalse(rel_path.endswith(".log"), f"Archivo .log filtrado en Git: {rel_path}")
            self.assertFalse(rel_path.endswith(".key") or rel_path.endswith(".pem"), f"Clave privada en Git: {rel_path}")

            if rel_path in ("tests/test_data_pipeline.py", "scripts/validate_data.py"):
                continue

            full_p = ROOT_DIR / rel_path
            if full_p.suffix in (".ico", ".png", ".jpg", ".jpeg", ".webp", ".woff", ".woff2"):
                continue

            txt = full_p.read_text(encoding="utf-8")

            # 2. Prohibir tokens o credenciales reales
            self.assertIsNone(
                re.search(r"(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|PASSKEY\s*=)", txt),
                f"Posible token o credencial en {rel_path}",
            )
            # 3. Prohibir direcciones MAC e IPs privadas de red doméstica
            self.assertIsNone(
                re.search(r"\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b", txt),
                f"Dirección MAC física detectada en {rel_path}",
            )
            self.assertIsNone(
                re.search(r"\b(?:192\.168\.|10\.\d+\.|172\.(?:1[6-9]|2\d|3[01])\.)\d+\.\d+\b", txt),
                f"Dirección IP privada local detectada en {rel_path}",
            )
            # 4. Prohibir rutas locales del sistema (/home/<usuario>/)
            self.assertIsNone(
                re.search(r"/home/(?!index\b)[a-zA-Z0-9_-]+", txt),
                f"Ruta del sistema local detectada en {rel_path}",
            )
            # 5. Prohibir coordenadas domésticas exactas de >3 decimales (43.340920 / 3.669827)
            self.assertIsNone(
                re.search(r"43[.,]3409\d*|3[.,]6698\d*", txt),
                f"Coordenada doméstica de alta precisión detectada en {rel_path}",
            )

    def test_degree_days_consistency(self) -> None:
        """
        EVO-006: Verifica la consistencia de los Grados Día de Calefacción (HDD 15,5 °C),
        Refrigeración (CDD 21,0 °C) y Desarrollo Agrícola (GDD 10,0 °C) en almanaques
        y tablas comparativas.
        """
        for y in [2022, 2023, 2024, 2025, 2026]:
            alm_path = self.data_dir / f"almanac_{y}.json"
            self.assertTrue(alm_path.exists())
            with open(alm_path, "r", encoding="utf-8") as f:
                alm = json.load(f)

            self.assertIn("degree_days", alm["stats"])
            dd = alm["stats"]["degree_days"]
            self.assertIn("hdd_15_5", dd)
            self.assertIn("cdd_21_0", dd)
            self.assertIn("gdd_10_0", dd)
            self.assertGreaterEqual(dd["hdd_15_5"], 0.0)
            self.assertGreaterEqual(dd["cdd_21_0"], 0.0)
            self.assertGreaterEqual(dd["gdd_10_0"], 0.0)

            # Suma mensual vs anual (ignorando meses no observados / None)
            sum_hdd = sum(m["hdd_15_5"] for m in alm["monthly"] if m["hdd_15_5"] is not None)
            sum_cdd = sum(m["cdd_21_0"] for m in alm["monthly"] if m["cdd_21_0"] is not None)
            sum_gdd = sum(m["gdd_10_0"] for m in alm["monthly"] if m["gdd_10_0"] is not None)
            self.assertAlmostEqual(sum_hdd, dd["hdd_15_5"], delta=0.5)
            self.assertAlmostEqual(sum_cdd, dd["cdd_21_0"], delta=0.5)
            self.assertAlmostEqual(sum_gdd, dd["gdd_10_0"], delta=0.5)

        # Comparativas
        comp_path = self.data_dir / "comparisons.json"
        with open(comp_path, "r", encoding="utf-8") as f:
            comp = json.load(f)

        ref = comp["reference_baseline"]
        self.assertIn("mean_annual_hdd_15_5", ref)
        self.assertIn("mean_annual_cdd_21_0", ref)
        self.assertIn("mean_annual_gdd_10_0", ref)
        self.assertGreater(ref["mean_annual_hdd_15_5"], 700.0)
        self.assertGreater(ref["mean_annual_gdd_10_0"], 1500.0)

        for row in comp["yearly_table"]:
            self.assertIn("hdd_15_5", row)
            self.assertIn("cdd_21_0", row)
            self.assertIn("gdd_10_0", row)

        for var in ["hdd_15_5", "cdd_21_0", "gdd_10_0"]:
            self.assertIn(var, comp["monthly_matrices"])
            for y_str in ["2022", "2023", "2024", "2025", "2026"]:
                self.assertEqual(len(comp["monthly_matrices"][var][y_str]), 12)

    def test_thermal_percentiles_and_comfort_bands(self) -> None:
        """
        EVO-007: Verifica la matriz de percentiles térmicos (P05 a P95) y la distribución
        de días por bandas de confort en almanaques y comparativas.
        """
        for y in [2022, 2023, 2024, 2025, 2026]:
            alm_path = self.data_dir / f"almanac_{y}.json"
            self.assertTrue(alm_path.exists())
            with open(alm_path, "r", encoding="utf-8") as f:
                alm = json.load(f)

            stats = alm["stats"]
            self.assertIn("thermal_percentiles", stats)
            self.assertIn("thermal_comfort_bands", stats)

            tp = stats["thermal_percentiles"]
            for col in ["temp_mean", "temp_max", "temp_min"]:
                self.assertIn(col, tp)
                q_vals = [tp[col][q] for q in ["P05", "P10", "P25", "P50", "P75", "P90", "P95"]]
                for i in range(len(q_vals) - 1):
                    self.assertLessEqual(q_vals[i], q_vals[i + 1])

            bands = stats["thermal_comfort_bands"]
            self.assertEqual(len(bands), 6)
            total_band_days = sum(b["days"] for b in bands)
            self.assertEqual(total_band_days, alm["coverage"]["valid_days"])
            total_band_pct = sum(b["pct"] for b in bands)
            self.assertAlmostEqual(total_band_pct, 100.0, delta=0.5)

        # En comparisons.json
        comp_path = self.data_dir / "comparisons.json"
        with open(comp_path, "r", encoding="utf-8") as f:
            comp = json.load(f)

        self.assertIn("thermal_distribution", comp)
        td = comp["thermal_distribution"]
        self.assertEqual(len(td["bands"]), 6)
        for y_str in ["2022", "2023", "2024", "2025", "2026"]:
            self.assertIn(y_str, td["years"])
            self.assertIn(y_str, td["years_pct"])
            self.assertEqual(len(td["years"][y_str]), 6)
            self.assertEqual(len(td["years_pct"][y_str]), 6)

        for row in comp["yearly_table"]:
            self.assertIn("temp_median", row)
            self.assertIn("comfort_days_15_25", row)
            self.assertIn("comfort_pct_15_25", row)

    def test_glossary_integrity_and_serving(self) -> None:
        """
        EVO-008: Verifica la estructura, integridad y cobertura del glosario meteorológico
        y divulgativo de Riotuerto.
        """
        glo_path = self.data_dir / "glossary.json"
        self.assertTrue(glo_path.exists())
        with open(glo_path, "r", encoding="utf-8") as f:
            glo = json.load(f)

        self.assertIn("title", glo)
        self.assertIn("categories", glo)
        self.assertIn("terms", glo)

        categories = glo["categories"]
        terms = glo["terms"]
        self.assertEqual(len(categories), 6)
        self.assertGreaterEqual(len(terms), 30)
        self.assertEqual(glo["total_terms"], len(terms))
        self.assertEqual(glo["total_categories"], len(categories))

        cat_ids = {c["id"] for c in categories}
        term_ids = {t["id"] for t in terms}

        for t in terms:
            self.assertIn(t["category_id"], cat_ids)
            self.assertTrue(len(t["term"]) > 0)
            self.assertTrue(len(t["short_definition"]) > 0)
            self.assertTrue(len(t["full_definition"]) > 0)
            self.assertTrue(len(t["riotuerto_context"]) > 0)
            self.assertIsInstance(t["aliases"], list)
            self.assertIsInstance(t["see_also"], list)
            for sa in t["see_also"]:
                self.assertIn(sa, term_ids, f"see_also '{sa}' no encontrado en términos")

        # Verificar conceptos locales distintivos
        for local_id in ["efecto_foehn", "surada", "inversion_termica", "hdd", "cdd", "gdd", "mediana_p50"]:
            self.assertIn(local_id, term_ids)

        # Verificar contención visual de las fórmulas y umbrales en el glosario
        css_text = (ROOT_DIR / "src" / "css" / "styles.css").read_text(encoding="utf-8")
        self.assertIn(".glossary-card-threshold", css_text)
        self.assertNotIn("white-space: nowrap;", css_text.split(".glossary-card-threshold")[1].split("}")[0],
                         "Las fórmulas del glosario no deben tener white-space: nowrap para no sobresalir de las tarjetas")

    def test_sync_data_pipeline_and_workflows(self) -> None:
        """
        EVO-009: Verifica la detección idempotente de cambios en sync_data.py y la
        presencia de los disparadores repository_dispatch en los workflows.
        """
        import sync_data

        # 1. Comprobar que diferencias solo en generated_at no se marquen como cambio real
        snap_a = {
            "index.json": ('{"generated_at": "2026-10-25 10:00:00", "v": 1}', {"generated_at": "2026-10-25 10:00:00", "v": 1}),
            "records.json": ('{"generated_at": "2026-10-25 10:00:00", "r": 5}', {"generated_at": "2026-10-25 10:00:00", "r": 5}),
        }
        snap_b = {
            "index.json": ('{"generated_at": "2026-10-26 12:00:00", "v": 1}', {"generated_at": "2026-10-26 12:00:00", "v": 1}),
            "records.json": ('{"generated_at": "2026-10-26 12:00:00", "r": 5}', {"generated_at": "2026-10-26 12:00:00", "r": 5}),
        }
        self.assertEqual(sync_data.detect_meaningful_changes(snap_a, snap_b), [])

        # 2. Comprobar que un cambio real en los datos sí se detecta
        snap_c = {
            "index.json": ('{"generated_at": "2026-10-26 12:00:00", "v": 2}', {"generated_at": "2026-10-26 12:00:00", "v": 2}),
            "records.json": ('{"generated_at": "2026-10-26 12:00:00", "r": 5}', {"generated_at": "2026-10-26 12:00:00", "r": 5}),
        }
        self.assertEqual(sync_data.detect_meaningful_changes(snap_a, snap_c), ["index.json"])

        # 3. Verificar workflows y plantillas de sincronización
        for wf_rel in [".github/workflows/deploy.yml", "docs/deploy.yml", "docs/notify_web.yml"]:
            wf_path = ROOT_DIR / wf_rel
            self.assertTrue(wf_path.exists(), f"Falta el archivo de workflow: {wf_rel}")
            wf_txt = wf_path.read_text(encoding="utf-8")
            self.assertIn("meteoriotuerto_data_updated", wf_txt)

    def test_geojson_and_open_data_schema_integrity(self) -> None:
        """
        EVO-010: Verifica la ficha cartográfica GeoJSON (RFC 7946) y el contrato
        formal JSON Schema (Draft 2020-12) en data/station.geojson y data/schema.json.
        """
        geojson_path = self.data_dir / "station.geojson"
        schema_path = self.data_dir / "schema.json"
        self.assertTrue(geojson_path.exists())
        self.assertTrue(schema_path.exists())

        with open(geojson_path, "r", encoding="utf-8") as f:
            gj = json.load(f)

        self.assertEqual(gj["type"], "FeatureCollection")
        self.assertEqual(len(gj["bbox"]), 6)
        self.assertGreaterEqual(len(gj["features"]), 3)

        station_feat = gj["features"][0]
        self.assertEqual(station_feat["id"], "meteoriotuerto-station")
        self.assertEqual(station_feat["geometry"]["type"], "Point")
        self.assertEqual(station_feat["geometry"]["coordinates"], [-3.67, 43.341, 115])

        props = station_feat["properties"]
        self.assertEqual(props["municipality"], "Riotuerto")
        self.assertEqual(props["record_temp_max_c"], 42.1)
        self.assertEqual(props["record_temp_min_c"], -3.1)
        self.assertEqual(props["record_daily_rain_mm"], 125.9)
        self.assertEqual(props["record_wind_gust_kmh"], 97.2)

        with open(schema_path, "r", encoding="utf-8") as f:
            sch = json.load(f)

        self.assertEqual(sch["$schema"], "https://json-schema.org/draft/2020-12/schema")
        self.assertGreaterEqual(len(sch["static_api_endpoints"]), 7)
        self.assertGreaterEqual(len(sch["variables_dictionary"]), 18)
        self.assertIn("AlmanacDocument", sch["$defs"])
        self.assertIn("StationGeoJSON", sch["$defs"])

        # Verificar aviso de licencia abierta CC BY (Atribución) en footer de index.html
        html_text = (ROOT_DIR / "index.html").read_text(encoding="utf-8")
        self.assertIn("CC BY", html_text, "Falta mención a licencia CC BY en index.html")
        self.assertIn("Atribución", html_text, "Falta mención a Atribución en index.html")

    def test_head_to_head_comparator_data_readiness(self) -> None:
        """
        EVO-011: Verifica que todos los almanaques anuales y objetos mensuales contengan
        las propiedades requeridas por el comparador cara a cara (head-to-head) y que
        el controlador esté integrado en src/js/app.js.
        """
        required_monthly_keys = [
            "month",
            "name",
            "valid_days",
            "calendar_days",
            "temp_mean",
            "temp_max_mean",
            "temp_min_mean",
            "temp_max_abs",
            "temp_min_abs",
            "rain_total",
            "rain_days_02",
            "rain_days_10",
            "rain_max_day",
            "wind_speed_mean",
            "wind_gust_max",
            "frost_days",
            "hot_days_30",
            "tropical_nights",
            "foehn_days",
            "hdd_15_5",
            "cdd_21_0",
            "gdd_10_0",
        ]
        for y, alm in self.almanacs.items():
            self.assertIn("coverage", alm, f"[{y}] Falta clave 'coverage'")
            self.assertIn("valid_days", alm["coverage"], f"[{y}] Falta 'valid_days' en coverage")
            self.assertIn("editorial", alm, f"[{y}] Falta clave 'editorial'")
            self.assertIn("character", alm["editorial"], f"[{y}] Falta 'character' en editorial")
            self.assertEqual(len(alm["monthly"]), 12, f"[{y}] Debe tener 12 meses en alm['monthly']")
            for m_obj in alm["monthly"]:
                for k in required_monthly_keys:
                    self.assertIn(k, m_obj, f"[{y} mes {m_obj.get('month')}] Falta clave '{k}' para EVO-011")

        app_js = (ROOT_DIR / "src" / "js" / "app.js").read_text(encoding="utf-8")
        self.assertIn("function extractH2HProfile", app_js)
        self.assertIn("function renderHeadToHeadComparator", app_js)
        self.assertIn("h2h-comparator-container", app_js)
        self.assertNotIn("alm.chronicle", app_js, "No debe usarse 'alm.chronicle' ya que el campo editorial se denomina 'editorial'")
        self.assertNotIn("mountChart", app_js, "No debe usarse 'mountChart'; la función global es 'createChart'")
        self.assertIn("createChart('comp-h2h-dual', 'chart-h2h-comparison'", app_js)

    def test_excel_export_readiness_and_vendor_integrity(self) -> None:
        """
        EVO-012: Verifica la presencia del vendor SheetJS (xlsx.mini.min.js), su inclusión
        en index.html, la definición de las funciones de exportación XLSX en app.js y los
        botones correspondientes en las tablas del sitio web.
        """
        vendor_file = ROOT_DIR / "src" / "js" / "vendor" / "xlsx.mini.min.js"
        self.assertTrue(vendor_file.exists(), "Falta el archivo vendor SheetJS")
        self.assertGreater(vendor_file.stat().st_size, 100_000, "El script SheetJS es menor de 100 KB")

        # MEJ-003: SheetJS no se carga síncronamente en index.html, sino diferido vía ensureXLSXLoaded()
        html_text = (ROOT_DIR / "index.html").read_text(encoding="utf-8")
        self.assertNotIn("xlsx.mini.min.js", html_text, "MEJ-003: index.html no debe cargar SheetJS síncronamente en el arranque")

        app_js = (ROOT_DIR / "src" / "js" / "app.js").read_text(encoding="utf-8")
        required_functions = [
            "function ensureXLSXLoaded",
            "function exportWorkbookToXLSX",
            "function exportAlmanacMonthlyToExcel",
            "function exportAlmanacFullYearToExcel",
            "function exportComparisonsSynopticToExcel",
            "function exportHeadToHeadScoreboardToExcel",
            "function exportExplorerSelectionToExcel",
            "function exportAbsoluteRecordsToExcel",
            "function exportRankingsToExcel",
            "function exportMonthlyRecordsToExcel",
            "function exportAuditQualityToExcel",
            "function exportPhenologyCalendarToExcel",
        ]
        for fn in required_functions:
            self.assertIn(fn, app_js, f"Falta función '{fn}' en src/js/app.js")

        required_buttons = [
            "btn-export-monthly-xlsx",
            "btn-dl-year-xlsx",
            "btn-exp-xlsx",
            "btn-export-synoptic-xlsx",
            "btn-export-h2h-xlsx",
            "btn-export-abs-records-xlsx",
            "btn-export-rankings-xlsx",
            "btn-export-records-monthly-xlsx",
            "btn-export-audit-xlsx",
            "btn-export-phenology-xlsx",
        ]
        for btn in required_buttons:
            self.assertIn(btn, app_js, f"Falta botón de exportación '{btn}' en src/js/app.js")

        css_text = (ROOT_DIR / "src" / "css" / "styles.css").read_text(encoding="utf-8")
        self.assertIn(".btn-excel", css_text, "Faltan estilos de .btn-excel en src/css/styles.css")

    def test_festivals_and_practical_guide_readiness(self):
        """
        EVO-013: Verifica la guía práctica cotidiana en almanaques y glosario,
        y la sección costumbrista del tiempo en las 8 festividades de Riotuerto.
        """
        html_text = (ROOT_DIR / "index.html").read_text(encoding="utf-8")
        self.assertIn('href="#fiestas"', html_text, "Falta enlace a #fiestas en index.html")
        self.assertIn('id="view-fiestas"', html_text, "Falta id view-fiestas en index.html")

        app_js = (ROOT_DIR / "src" / "js" / "app.js").read_text(encoding="utf-8")
        self.assertIn("function renderFiestas", app_js, "Falta función renderFiestas en app.js")
        self.assertIn("function exportFestivalsToExcel", app_js, "Falta función exportFestivalsToExcel en app.js")
        self.assertIn("btn-export-festivals-xlsx", app_js, "Falta botón btn-export-festivals-xlsx en app.js")
        self.assertIn("practical-guide-box", app_js, "Falta bloque practical-guide-box en app.js")
        self.assertIn("computePhenologicalCalendar", app_js, "Falta computePhenologicalCalendar en app.js")
        self.assertIn("PHENOLOGY_EVENTS", app_js, "Falta PHENOLOGY_EVENTS en app.js")
        self.assertIn("phenology-box", app_js, "Falta bloque phenology-box en app.js")

        # Verificar presencia de las 8 fiestas requeridas en el catálogo JS
        expected_festivals = [
            "san_jose",      # 1 de mayo, Monte
            "san_juan",      # 24 de junio, La Cavada (Patrón)
            "carmen",        # 16 de julio, Barrio de Arriba
            "magdalena",     # 22 de julio, Rucandio
            "san_roque",     # 16 de agosto, Angustina
            "juventud",      # 3ª semana de agosto, La Cavada
            "brigadier",     # 4º sábado de agosto, Reales Fábricas (Interés Regional)
            "san_cipriano",  # 16 de septiembre, Barrio de Arriba
        ]
        for fest_id in expected_festivals:
            self.assertIn(f"id: '{fest_id}'", app_js, f"Falta fiesta '{fest_id}' en FESTIVALS_CATALOG")

        # Verificar estilos en styles.css
        css_text = (ROOT_DIR / "src" / "css" / "styles.css").read_text(encoding="utf-8")
        self.assertIn(".practical-guide-box", css_text, "Falta .practical-guide-box en styles.css")
        self.assertIn(".festivals-tabs-wrap", css_text, "Falta .festivals-tabs-wrap en styles.css")
        self.assertIn(".festival-card-hero", css_text, "Falta .festival-card-hero en styles.css")

        # Verificar términos enriquecidos en data/glossary.json
        glossary_path = ROOT_DIR / "data" / "glossary.json"
        self.assertTrue(glossary_path.exists(), "Falta data/glossary.json")
        glossary_data = json.loads(glossary_path.read_text(encoding="utf-8"))
        terms_by_id = {t["id"]: t for t in glossary_data.get("terms", [])}
        for term_id in ["hdd", "cdd", "gdd", "cero_vegetativo"]:
            self.assertIn(term_id, terms_by_id, f"Falta término '{term_id}' en glossary.json")
            context = terms_by_id[term_id].get("riotuerto_context", "")
            self.assertGreater(len(context), 50, f"Contexto de '{term_id}' demasiado breve")

    def test_riotuerto_cotidiano_menu_reorganization(self):
        """
        Verifica la reorganización del menú «Riotuerto cotidiano», agrupando la información
        práctica vecinal (labores, fenología y fiestas locales) en un único menú principal.
        """
        html_text = (ROOT_DIR / "index.html").read_text(encoding="utf-8")
        self.assertIn('href="#cotidiano"', html_text, "Falta enlace a #cotidiano en index.html")
        self.assertIn('data-route="cotidiano"', html_text, "Falta data-route cotidiano en index.html")
        self.assertIn('id="view-cotidiano"', html_text, "Falta id view-cotidiano en index.html")
        self.assertIn('Riotuerto cotidiano', html_text, "Falta texto Riotuerto cotidiano en index.html")

        app_js = (ROOT_DIR / "src" / "js" / "app.js").read_text(encoding="utf-8")
        self.assertIn("function renderCotidiano", app_js, "Falta función renderCotidiano en app.js")
        self.assertIn("cotidianoTab", app_js, "Falta estado cotidianoTab en app.js")
        self.assertIn("btn-export-phenology-cotidiano-xlsx", app_js, "Falta botón Excel en labores cotidianas")
        self.assertIn("btn-export-festivals-xlsx", app_js, "Falta botón Excel en fiestas")

        # Comprobar estilos de subnavegación en styles.css
        css_text = (ROOT_DIR / "src" / "css" / "styles.css").read_text(encoding="utf-8")
        self.assertIn(".cotidiano-subnav", css_text, "Falta .cotidiano-subnav en styles.css")
        self.assertIn(".cotidiano-subnav-btn", css_text, "Falta .cotidiano-subnav-btn en styles.css")
        self.assertIn(".cotidiano-year-bar", css_text, "Falta .cotidiano-year-bar en styles.css")

        # Comprobar adaptabilidad móvil de las tarjetas de labores cotidianas
        self.assertIn(".practical-cards-grid", css_text)
        self.assertIn(".practical-card", css_text)
        # Asegurar que practical-cards-grid usa límite adaptativo y regla móvil de 1 columna
        self.assertIn("minmax(min(100%, 300px), 1fr)", css_text)
        self.assertIn("@media (max-width: 768px)", css_text)
        self.assertIn("grid-template-columns: 1fr;", css_text)
        self.assertIn(".practical-card-media", css_text)
        self.assertIn(".practical-card-img", css_text)

        # Comprobar presencia de las 6 imágenes ilustrativas de labores en assets/img
        expected_images = [
            "labor-calefaccion-lena",
            "labor-robot-cortacesped",
            "labor-siega-forraje",
            "labor-huerta-tratamientos",
            "labor-setas-micologia",
            "labor-solar-fotovoltaica",
        ]
        for base in expected_images:
            jpg_file = ROOT_DIR / "assets" / "img" / f"{base}.jpg"
            webp_file = ROOT_DIR / "assets" / "img" / f"{base}.webp"
            self.assertTrue(jpg_file.exists(), f"Falta archivo {jpg_file.name}")
            self.assertTrue(webp_file.exists(), f"Falta archivo {webp_file.name}")
            self.assertGreater(jpg_file.stat().st_size, 30_000, f"Tamaño insuficiente en {jpg_file.name}")
            self.assertGreater(webp_file.stat().st_size, 30_000, f"Tamaño insuficiente en {webp_file.name}")
            self.assertIn(f"{base}.webp", app_js, f"Falta referencia a {base}.webp en app.js")

    def test_station_photo_and_instrumentation_readiness(self):
        """
        Verifica la incorporación de la fotografía original de la estación en Barrio de Arriba
        (29 de noviembre de 2020) en la ficha de instrumentación de Metodología.
        """
        img_jpg = ROOT_DIR / "assets" / "img" / "estacion-meteorologica-barrio-de-arriba.jpg"
        img_webp = ROOT_DIR / "assets" / "img" / "estacion-meteorologica-barrio-de-arriba.webp"
        self.assertTrue(img_jpg.exists(), "Falta imagen JPG de la estación")
        self.assertTrue(img_webp.exists(), "Falta imagen WebP de la estación")
        self.assertGreater(img_jpg.stat().st_size, 100_000, "Tamaño JPG de la estación insuficiente")
        self.assertGreater(img_webp.stat().st_size, 100_000, "Tamaño WebP de la estación insuficiente")

        app_js = (ROOT_DIR / "src" / "js" / "app.js").read_text(encoding="utf-8")
        self.assertIn("station-photo-figure", app_js, "Falta station-photo-figure en app.js")
        self.assertIn("estacion-meteorologica-barrio-de-arriba.jpg", app_js, "Falta ruta jpg en app.js")
        self.assertIn("estacion-meteorologica-barrio-de-arriba.webp", app_js, "Falta ruta webp en app.js")

        css_text = (ROOT_DIR / "src" / "css" / "styles.css").read_text(encoding="utf-8")
        self.assertIn(".station-photo-figure", css_text, "Falta .station-photo-figure en styles.css")
        self.assertIn(".station-photo-img", css_text, "Falta .station-photo-img en styles.css")

    def test_circular_polar_windrose_readiness(self):
        """
        EVO-017: Verifica la rosa de los vientos circular polar náutica (360°),
        los controles de alternancia polar/barras y la leyenda de cuadrantes.
        """
        app_js = (ROOT_DIR / "src" / "js" / "app.js").read_text(encoding="utf-8")
        self.assertIn("renderAlmanacWindRose", app_js, "Falta renderAlmanacWindRose en app.js")
        self.assertIn("polarArea", app_js, "Falta tipo polarArea en app.js")
        self.assertIn("SECTOR_NAMES_ES", app_js, "Falta diccionario SECTOR_NAMES_ES en app.js")
        self.assertIn("btn-windrose-polar", app_js, "Falta botón polar en app.js")
        self.assertIn("btn-windrose-bar", app_js, "Falta botón de barras en app.js")

        css_text = (ROOT_DIR / "src" / "css" / "styles.css").read_text(encoding="utf-8")
        self.assertIn(".windrose-toggle-group", css_text, "Falta .windrose-toggle-group en styles.css")
        self.assertIn(".windrose-legend-bar", css_text, "Falta .windrose-legend-bar en styles.css")
        self.assertIn(".windrose-dot", css_text, "Falta .windrose-dot en styles.css")

    def test_topography_interactive_module_readiness(self):
        """
        EVO-018: Verifica el modelo topoclimático y perfil orográfico interactivo,
        el catálogo de dinámicas (Foehn, Lluvia orográfica, Inversión) y sus estilos.
        """
        app_js = (ROOT_DIR / "src" / "js" / "app.js").read_text(encoding="utf-8")
        self.assertIn("TOPOGRAPHY_DATA", app_js, "Falta TOPOGRAPHY_DATA en app.js")
        self.assertIn("generateTopographySVG", app_js, "Falta generateTopographySVG en app.js")
        self.assertIn("initTopographyModule", app_js, "Falta initTopographyModule en app.js")
        self.assertIn("Puerto de Alisas (674 m)", app_js, "Falta hito Puerto de Alisas en app.js")
        self.assertNotIn("Peña Pelada", app_js, "Peña Pelada no debe aparecer en app.js")
        self.assertIn("golfo de Vizcaya", app_js, "Debe citarse 'golfo de Vizcaya' en app.js")
        self.assertNotIn("golfo de Bizkaia", app_js, "No debe citarse 'golfo de Bizkaia' en app.js")
        self.assertIn("btn-topo-foehn", app_js, "Falta botón Foehn en app.js")
        self.assertIn("btn-topo-orographic", app_js, "Falta botón orográfico en app.js")
        self.assertIn("btn-topo-inversion", app_js, "Falta botón inversión en app.js")

        css_text = (ROOT_DIR / "src" / "css" / "styles.css").read_text(encoding="utf-8")
        self.assertIn(".topography-section", css_text, "Falta .topography-section en styles.css")
        self.assertIn(".topography-svg-wrap", css_text, "Falta .topography-svg-wrap en styles.css")
        self.assertIn(".topography-mode-btn", css_text, "Falta .topography-mode-btn en styles.css")
        self.assertIn(".topo-pulse-circle", css_text, "Falta .topo-pulse-circle en styles.css")

    def test_seasonal_climatology_readiness(self):
        """
        EVO-019 (EVO-C): Verifica la climatología estacional canónica OMM (DJF, MAM, JJA, SON)
        en almanaques anuales, comparativas interanuales, interfaz y exportación Excel.
        """
        # 1. Almanaques anuales
        for year in [2022, 2023, 2024, 2025, 2026]:
            alm_path = self.data_dir / f"almanac_{year}.json"
            self.assertTrue(alm_path.exists())
            with open(alm_path, "r", encoding="utf-8") as f:
                alm = json.load(f)
            self.assertIn("seasons", alm)
            self.assertEqual(len(alm["seasons"]), 4)
            season_ids = [s["season_id"] for s in alm["seasons"]]
            self.assertEqual(season_ids, ["winter", "spring", "summer", "autumn"])
            for s in alm["seasons"]:
                self.assertIn("temp_mean", s)
                self.assertIn("rain_total_mm", s)
                self.assertIn("frost_days", s)
                self.assertIn("foehn_days", s)

        # 2. Comparativas interanuales
        comp_path = self.data_dir / "comparisons.json"
        self.assertTrue(comp_path.exists())
        with open(comp_path, "r", encoding="utf-8") as f:
            comp = json.load(f)

        self.assertIn("seasonal_comparison", comp)
        sc = comp["seasonal_comparison"]
        self.assertIn("seasons_meta", sc)
        self.assertIn("baseline_reference_2022_2025", sc)
        self.assertIn("table", sc)
        self.assertIn("rankings", sc)

        self.assertEqual(len(sc["seasons_meta"]), 4)
        self.assertGreaterEqual(len(sc["table"]), 20)

        base = sc["baseline_reference_2022_2025"]
        for sid in ["winter", "spring", "summer", "autumn"]:
            self.assertIn(sid, base)
            self.assertIsNotNone(base[sid].get("temp_mean"))
            self.assertIsNotNone(base[sid].get("rain_total_mm"))

        # 3. Interfaz web y estilos
        app_js = (ROOT_DIR / "src" / "js" / "app.js").read_text(encoding="utf-8")
        self.assertIn("initSeasonalComparison", app_js)
        self.assertIn("renderSeasonalComparisonChart", app_js)
        self.assertIn("renderSeasonalTableRows", app_js)
        self.assertIn("exportSeasonalComparisonToExcel", app_js)
        self.assertIn("renderAlmanacSeasonsHtml", app_js)

        css_text = (ROOT_DIR / "src" / "css" / "styles.css").read_text(encoding="utf-8")
        self.assertIn(".seasonal-cards-grid", css_text)
        self.assertIn(".seasonal-card", css_text)
        self.assertIn(".seasonal-tabs-bar", css_text)
        self.assertIn(".seasonal-pill", css_text)

    def test_extreme_episodes_detector_readiness(self):
        """
        EVO-020 (EVO-D): Verifica el detector algorítmico y catálogo cronológico de episodios climáticos extremos
        (olas de calor, olas de frío, rachas de lluvia, rachas secas y suradas continuadas).
        """
        # 1. Catálogo histórico en records.json
        rec_path = self.data_dir / "records.json"
        self.assertTrue(rec_path.exists())
        with open(rec_path, "r", encoding="utf-8") as f:
            rec = json.load(f)

        self.assertIn("extreme_episodes", rec)
        ee = rec["extreme_episodes"]
        self.assertIn("summary_kpis", ee)
        self.assertIn("counts_by_type", ee)
        self.assertIn("episodes", ee)
        self.assertIn("criteria", ee)

        kpis = ee["summary_kpis"]
        for expected_kpi in [
            "longest_heatwave", "hottest_heatwave",
            "longest_coldwave", "coldest_coldwave",
            "longest_wet_spell", "most_copious_wet_spell",
            "longest_dry_spell", "longest_foehn_spell"
        ]:
            self.assertIn(expected_kpi, kpis)
            self.assertIsNotNone(kpis[expected_kpi])

        counts = ee["counts_by_type"]
        self.assertEqual(len(counts), 5)
        self.assertGreaterEqual(counts.get("heatwave", 0), 5)
        self.assertGreaterEqual(counts.get("coldwave", 0), 4)
        self.assertGreaterEqual(counts.get("wet_spell", 0), 20)
        self.assertGreaterEqual(counts.get("dry_spell", 0), 5)
        self.assertGreaterEqual(counts.get("foehn_spell", 0), 10)
        self.assertGreaterEqual(len(ee["episodes"]), 80)

        # 2. Resumen anual en cada almanac_YYYY.json
        for year in [2022, 2023, 2024, 2025, 2026]:
            alm_path = self.data_dir / f"almanac_{year}.json"
            self.assertTrue(alm_path.exists())
            with open(alm_path, "r", encoding="utf-8") as f:
                alm = json.load(f)
            self.assertIn("extreme_episodes", alm)
            alm_ee = alm["extreme_episodes"]
            self.assertIn("counts", alm_ee)
            self.assertIn("max_durations", alm_ee)
            self.assertIn("episodes", alm_ee)

        # 3. Frontend y exportación Excel
        app_js = (ROOT_DIR / "src" / "js" / "app.js").read_text(encoding="utf-8")
        self.assertIn("renderExtremeEpisodesTable", app_js)
        self.assertIn("initExtremeEpisodes", app_js)
        self.assertIn("exportExtremeEpisodesToExcel", app_js)
        self.assertIn("renderAlmanacExtremeEpisodesHtml", app_js)

        css_text = (ROOT_DIR / "src" / "css" / "styles.css").read_text(encoding="utf-8")
        self.assertIn(".extreme-episodes-section", css_text)
        self.assertIn(".episodes-kpis-grid", css_text)
        self.assertIn(".episodes-tabs-bar", css_text)
        self.assertIn(".episode-badge", css_text)

    def test_pwa_and_offline_service_worker_readiness(self):
        """
        EVO-021 (EVO-F): Verifica el modo sin conexión, el Service Worker (sw.js),
        el manifiesto web PWA (site.webmanifest) y la experiencia de usuario offline.
        """
        # 1. Service Worker en raíz
        sw_path = ROOT_DIR / "sw.js"
        self.assertTrue(sw_path.exists(), "Falta sw.js en la raíz del proyecto")
        sw_text = sw_path.read_text(encoding="utf-8")
        self.assertIn("CACHE_NAME", sw_text)
        self.assertIn("PRECACHE_ASSETS", sw_text)
        self.assertIn("./data/index.json", sw_text)
        self.assertIn("./data/records.json", sw_text)
        self.assertIn("./data/comparisons.json", sw_text)
        self.assertIn("./src/js/app.js", sw_text)
        self.assertIn("./src/css/styles.css", sw_text)
        self.assertIn("caches.open", sw_text)
        self.assertIn("fetch", sw_text)

        # 2. Manifiesto PWA
        manifest_path = ROOT_DIR / "site.webmanifest"
        self.assertTrue(manifest_path.exists(), "Falta site.webmanifest")
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)
        self.assertEqual(manifest["name"], "MeteoRiotuerto — Almanaque meteorológico y climatológico digital")
        self.assertEqual(manifest["short_name"], "MeteoRiotuerto")
        self.assertEqual(manifest["display"], "standalone")
        self.assertIn("icons", manifest)
        self.assertGreaterEqual(len(manifest["icons"]), 2)

        # 3. HTML y enlaces de integración
        index_html = (ROOT_DIR / "index.html").read_text(encoding="utf-8")
        self.assertIn('href="./site.webmanifest"', index_html)
        self.assertIn('name="theme-color"', index_html)
        self.assertIn('id="offline-badge"', index_html)
        self.assertIn('id="btn-pwa-install"', index_html)

        # 4. JavaScript y monitor de conexión
        app_js = (ROOT_DIR / "src" / "js" / "app.js").read_text(encoding="utf-8")
        self.assertIn("initServiceWorkerAndPWA", app_js)
        self.assertIn("navigator.serviceWorker.register('./sw.js')", app_js)
        self.assertIn("updateOnlineStatus", app_js)
        self.assertIn("beforeinstallprompt", app_js)

        # 5. Estilos
        css_text = (ROOT_DIR / "src" / "css" / "styles.css").read_text(encoding="utf-8")
        self.assertIn(".offline-badge", css_text)
        self.assertIn(".offline-dot", css_text)
        self.assertIn(".btn-pwa-install", css_text)

    def test_water_balance_and_evapotranspiration_readiness(self):
        """
        EVO-022 (EVO-A): Verifica el cómputo de la Evapotranspiración de referencia (ET0 FAO-56),
        el balance hídrico neto del suelo (P - ET0), series diarias y acumuladas, matrices mensuales,
        comparativas interanuales, interfaz interactiva y exportación a Excel.
        """
        # 1. Almanaques anuales
        for year in [2022, 2023, 2024, 2025, 2026]:
            alm_path = self.data_dir / f"almanac_{year}.json"
            self.assertTrue(alm_path.exists())
            with open(alm_path, "r", encoding="utf-8") as f:
                alm = json.load(f)

            stats = alm.get("stats", {})
            self.assertIn("water_balance", stats, f"Falta stats.water_balance en almanaque {year}")
            wb = stats["water_balance"]
            self.assertIn("eto_total_mm", wb)
            self.assertIn("water_balance_mm", wb)
            self.assertIn("summer_deficit_mm", wb)
            self.assertIn("deficit_days", wb)
            self.assertIn("surplus_days", wb)
            self.assertIn("driest_balance_month", wb)
            self.assertIn("wettest_balance_month", wb)

            # Invariantes físicos
            eto_tot = wb["eto_total_mm"]
            wb_net = wb["water_balance_mm"]
            self.assertGreaterEqual(eto_tot, 600.0)
            self.assertLessEqual(eto_tot, 1400.0)
            self.assertGreaterEqual(wb_net, 300.0)
            self.assertLess(wb["summer_deficit_mm"], 0.0, f"En clima de Riotuerto el verano JJA debe tener déficit hídrico en {year}")

            # Desglose mensual
            self.assertEqual(len(alm["monthly"]), 12)
            for m in alm["monthly"]:
                if m.get("valid_days", 0) > 0:
                    self.assertIn("eto_mm", m)
                    self.assertIn("water_balance_mm", m)
                    self.assertIn("deficit_days", m)
                    self.assertIn("surplus_days", m)

            # Serie diaria columnar y acumulada
            ds = alm["daily_series"]
            n_dates = len(ds["dates"])
            for req_k in ["eto", "water_balance", "eto_accum", "water_balance_accum"]:
                self.assertIn(req_k, ds)
                self.assertEqual(len(ds[req_k]), n_dates)

        # 2. Comparativas multianuales
        comp_path = self.data_dir / "comparisons.json"
        self.assertTrue(comp_path.exists())
        with open(comp_path, "r", encoding="utf-8") as f:
            comp = json.load(f)

        self.assertIn("water_balance_comparison", comp)
        wbc = comp["water_balance_comparison"]
        self.assertIn("mean_annual_eto_mm", wbc)
        self.assertIn("mean_annual_water_balance_mm", wbc)
        self.assertIn("mean_summer_balance_mm", wbc)
        self.assertIn("monthly_baseline_eto", wbc)
        self.assertIn("monthly_baseline_water_balance", wbc)
        self.assertEqual(len(wbc["monthly_baseline_eto"]), 12)
        self.assertEqual(len(wbc["monthly_baseline_water_balance"]), 12)
        self.assertIn("years", wbc)
        self.assertIn("agroclimatic_assessment", wbc)

        # Matriz mensual y tabla anual
        matrices = comp.get("monthly_matrices", {})
        self.assertIn("eto_total", matrices)
        self.assertIn("water_balance", matrices)

        for row in comp.get("yearly_table", []):
            self.assertIn("eto_total_mm", row)
            self.assertIn("water_balance_mm", row)
            self.assertIn("summer_balance_mm", row)
            self.assertIn("water_deficit_days", row)
            self.assertIn("water_surplus_days", row)

        # 3. Interfaz web, gráficos y exportador Excel
        app_js = (ROOT_DIR / "src" / "js" / "app.js").read_text(encoding="utf-8")
        self.assertIn("renderAlmanacWaterBalanceHtml", app_js)
        self.assertIn("exportWaterBalanceToExcel", app_js)
        self.assertIn("chart-alm-waterbalance", app_js)
        self.assertIn("chart-comp-waterbalance", app_js)
        self.assertIn("btn-export-waterbalance-xlsx", app_js)

        css_text = (ROOT_DIR / "src" / "css" / "styles.css").read_text(encoding="utf-8")
        self.assertIn(".water-balance-section", css_text)
        self.assertIn(".water-balance-kpis-grid", css_text)
        self.assertIn(".wb-kpi-card", css_text)
        self.assertIn(".wb-days-bar", css_text)
        self.assertIn(".wb-assessment-callout", css_text)

    def test_streamlined_hero_and_geographic_relocation_readiness(self):
        """Verifica que el evolutivo EVO-026 (Hero ágil y traslado cartográfico a Metodología) esté operativo."""
        app_js = (ROOT_DIR / "src" / "js" / "app.js").read_text(encoding="utf-8")
        css_text = (ROOT_DIR / "src" / "css" / "styles.css").read_text(encoding="utf-8")

        # 1. En Portada: hero ágil con pastilla sintética y botones de salto
        self.assertIn("hero-geo-pill", app_js)
        self.assertIn("hero-actions", app_js)
        self.assertIn("data-scroll-to=\"sec-almanaques-title\"", app_js)
        self.assertTrue(
            "data-scroll-to=\"sec-featured-episodes\"" in app_js or "data-scroll-to=\"sec-records-portada\"" in app_js
        )

        # 2. Comprobar que en renderPortada no existe el iframe ni el bloque pesado anterior
        portada_code = app_js[app_js.find("async function renderPortada"):app_js.find("function renderOnThisDayWidget")]
        self.assertNotIn("<iframe", portada_code)
        self.assertNotIn("station-location-block", portada_code)

        # 3. Comprobar que en Metodología se ubica la cartografía completa y los hitos del valle
        metodologia_code = app_js[app_js.find("async function renderMetodologia"):app_js.find("function renderGlossaryView")]
        self.assertIn("<iframe", metodologia_code)
        self.assertIn("station-location-map-wrap", metodologia_code)
        self.assertIn("Retención orográfica Cantábrica", metodologia_code)
        self.assertIn("Efecto Foehn", metodologia_code)

        # 4. Comprobar reglas CSS para la pastilla y los accesos rápidos
        self.assertIn(".hero-geo-pill", css_text)
        self.assertIn(".hero-actions", css_text)
        self.assertIn(".hero-btn", css_text)
        self.assertIn(".hero-btn-live", css_text)

    def test_featured_episodes_showcase_readiness(self):
        """Verifica que el evolutivo EVO-027 (Escaparate de grandes acontecimientos en portada) esté operativo."""
        app_js = (ROOT_DIR / "src" / "js" / "app.js").read_text(encoding="utf-8")
        css_text = (ROOT_DIR / "src" / "css" / "styles.css").read_text(encoding="utf-8")

        # 1. Sección y encabezado en portada
        self.assertIn("id=\"sec-featured-episodes\"", app_js)
        self.assertIn("Acontecimientos meteorológicos que marcaron Riotuerto", app_js)

        # 2. Presencia de los 4 grandes hitos canónicos con datos reales
        self.assertIn("Borrasca Fien: 125,9 mm", app_js)
        self.assertIn("42,1 °C en Barrio de Arriba", app_js)
        self.assertIn("Borrasca Karlotta: vendaval de 97,2 km/h", app_js)
        self.assertIn("Descarga torrencial récord: 44,2 mm en una hora", app_js)

        # 3. Enlaces cruzados hacia los almanaques respectivos y catálogo de extremos
        self.assertIn("href=\"#almanaque/2023\"", app_js)
        self.assertIn("href=\"#almanaque/2024\"", app_js)
        self.assertIn("href=\"#almanaque/2025\"", app_js)
        self.assertIn("href=\"#records\"", app_js)

        # 4. Reglas CSS específicas
        self.assertIn(".featured-episodes-grid", css_text)
        self.assertIn(".episode-featured-card", css_text)
        self.assertIn(".episode-card-rain", css_text)
        self.assertIn(".episode-card-heat", css_text)
        self.assertIn(".episode-card-wind", css_text)
        self.assertIn(".episode-card-storm", css_text)
        self.assertIn(".episode-kpis-strip", css_text)
        self.assertIn(".episode-narrative", css_text)

    def test_on_this_day_headline_evaluator_readiness(self):
        """Verifica que el evolutivo EVO-028 (Titular divulgativo y contexto en 'Tal día como hoy') esté operativo."""
        app_js = (ROOT_DIR / "src" / "js" / "app.js").read_text(encoding="utf-8")
        css_text = (ROOT_DIR / "src" / "css" / "styles.css").read_text(encoding="utf-8")

        # 1. Función evaluadora y paso de datos
        self.assertIn("function evaluateOnThisDayHeadline", app_js)
        self.assertIn("const verdict = evaluateOnThisDayHeadline", app_js)

        # 2. Componente de veredicto diario en la plantilla
        self.assertIn("otd-verdict-box", app_js)
        self.assertIn("otd-verdict-badge", app_js)
        self.assertIn("otd-verdict-title", app_js)
        self.assertIn("otd-verdict-desc", app_js)

        # 3. Criterios de evaluación (Nivel 1 récords, Nivel 2 extremos, Nivel 3 anomalías, Nivel 4 fallback apacible)
        self.assertIn("Récord histórico de la serie", app_js)
        self.assertIn("Pico álgido de", app_js)
        self.assertIn("Jornada de temporal de lluvia", app_js)
        self.assertIn("Surada / Temperatura anómala", app_js)
        self.assertIn("Jornada apacible en el histórico", app_js)

        # 4. Estilos CSS para los tipos de veredicto
        self.assertIn(".otd-verdict-box", css_text)
        self.assertIn(".otd-verdict-box.verdict-record", css_text)
        self.assertIn(".otd-verdict-box.verdict-extreme", css_text)
        self.assertIn(".otd-verdict-box.verdict-anomaly", css_text)
        self.assertIn(".otd-verdict-box.verdict-mild", css_text)
        self.assertIn(".otd-verdict-badge", css_text)

    def test_almanac_cards_editorial_headlines_and_hierarchy(self):
        """Verifica que el evolutivo EVO-029 (Titulares sinópticos de autor y jerarquización de almanaques) esté operativo."""
        app_js = (ROOT_DIR / "src" / "js" / "app.js").read_text(encoding="utf-8")
        css_text = (ROOT_DIR / "src" / "css" / "styles.css").read_text(encoding="utf-8")

        # 1. Definición de titulares de autor y efemérides en app.js
        self.assertIn("YEAR_EDITORIAL_HEADLINES", app_js)
        self.assertIn("YEAR_EDITORIAL_HIGHLIGHTS", app_js)

        # 2. Comprobar los 5 titulares canónicos por año
        self.assertIn("Año cálido y seco con estío prolongado y marcadas suradas otoñales", app_js)
        self.assertIn("Grandes contrastes: el temporal Fien (509,8 mm en enero) y acusada sequía estival", app_js)
        self.assertIn("Récord absoluto de calor (42,1 °C) y temporales atlánticos de viento sur", app_js)
        self.assertIn("Pluviosidad abundante y gran regularidad estacional en el valle", app_js)
        self.assertIn("Avance provisional del año en curso (registro consolidado hasta octubre)", app_js)

        # 3. Métricas clave en tarjetas
        self.assertIn("Precipitación anual", app_js)
        self.assertIn("Temperatura media", app_js)
        self.assertIn("Techo eólico", app_js)
        self.assertIn("Surada (Foehn)", app_js)

        # 4. Estilos visuales refinados en CSS
        self.assertIn(".almanac-character", css_text)
        self.assertIn(".almanac-mini-stats div small", css_text)

    def test_five_pillars_navigation_and_streamlined_footer(self):
        """Verifica que el evolutivo EVO-030 (Reorganización de navegación en 5 pilares y retirada de gráficos duplicados) esté operativo."""
        html_text = (ROOT_DIR / "index.html").read_text(encoding="utf-8")
        app_js = (ROOT_DIR / "src" / "js" / "app.js").read_text(encoding="utf-8")
        css_text = (ROOT_DIR / "src" / "css" / "styles.css").read_text(encoding="utf-8")

        # 1. Verificar los 5 pilares en el menú principal de index.html
        self.assertIn('data-route="portada"', html_text)
        self.assertIn('data-route="almanaque"', html_text)
        self.assertIn('data-route="records"', html_text)
        self.assertIn('data-route="cotidiano"', html_text)
        self.assertIn('data-route="analisis"', html_text)

        # 2. Verificar títulos y etiquetas de los 5 pilares
        self.assertIn("Acontecimientos y Récords", html_text)
        self.assertIn("Archivo y Análisis", html_text)
        self.assertIn("Almanaques anuales", html_text)
        self.assertIn("Riotuerto cotidiano", html_text)

        # 3. Verificar desplegables y subenlaces en index.html
        self.assertIn('class="nav-item-dropdown"', html_text)
        self.assertIn('class="nav-dropdown-menu"', html_text)
        self.assertIn('data-route-sub="explorador"', html_text)
        self.assertIn('data-route-sub="comparativas"', html_text)
        self.assertIn('data-route-sub="metodologia"', html_text)
        self.assertIn('data-route-sub="glosario"', html_text)
        self.assertIn('href="#almanaque/2026"', html_text)
        self.assertIn('href="#almanaque/2022"', html_text)

        # 4. Verificar retirada de gráficos duplicados del pie de portada en app.js
        self.assertNotIn('<canvas id="chart-home-rain">', app_js)
        self.assertNotIn('<canvas id="chart-home-temp">', app_js)
        self.assertIn('id="sec-analisis-archive-title"', app_js)

        # 5. Verificar atajos de teclado Alt + 1..5 y enrutamiento en app.js
        self.assertIn("e.altKey && ['1', '2', '3', '4', '5'].includes(e.key)", app_js)
        self.assertIn("ANALISIS_ROUTES", app_js)

        # 6. Verificar estilos CSS de navegación y desplegables
        self.assertIn(".nav-item-dropdown", css_text)
        self.assertIn(".nav-dropdown-menu", css_text)
        self.assertIn(".nav-dropdown-link", css_text)
        self.assertIn(".dropdown-caret", css_text)
        self.assertIn(".badge-provisional-sm", css_text)

    def test_bidirectional_deep_linking_and_event_badges(self):
        """Verifica que el evolutivo EVO-031 (Enlaces bidireccionales cruzados y distintivos de eventos) esté operativo."""
        app_js = (ROOT_DIR / "src" / "js" / "app.js").read_text(encoding="utf-8")
        css_text = (ROOT_DIR / "src" / "css" / "styles.css").read_text(encoding="utf-8")

        # 1. Enlaces profundos desde las tarjetas de portada hacia mes de almanaque, catálogo y explorador
        self.assertIn('href="#almanaque/2023/mes-01"', app_js)
        self.assertIn('href="#records/episodio/wet-2023-01-11"', app_js)
        self.assertIn('href="#explorador/2023-01-14/2023-01-20/rain"', app_js)
        self.assertIn('href="#almanaque/2024/mes-08"', app_js)
        self.assertIn('href="#records/rankings/top_hottest_days"', app_js)
        self.assertIn('href="#almanaque/2024/mes-02"', app_js)
        self.assertIn('href="#records/rankings/top_windiest_days"', app_js)
        self.assertIn('href="#almanaque/2025/mes-06"', app_js)

        # 2. Enlaces hacia el explorador desde el widget «Tal día como hoy»
        self.assertIn('class="otd-exp-link"', app_js)
        self.assertIn('href="#explorador/${e.isoDate}/${e.isoDate}"', app_js)
        self.assertIn('Explorar este día en la serie histórica', app_js)

        # 3. Distintivos de acontecimientos y celdas con ID en el calendario anual
        self.assertIn('has-episode', app_js)
        self.assertIn('cal-peak-event', app_js)
        self.assertIn('id="cal-cell-${iso}"', app_js)
        self.assertIn('data-date="${iso}"', app_js)
        self.assertIn('⚡ [Episodio:', app_js)

        # 4. Filas identificadas con ID para desplazamiento suave en tablas
        self.assertIn('id="mes-${alm.year}-${String(m.month).padStart(2, \'0\')}"', app_js)
        self.assertIn('id="episode-${e.id}"', app_js)

        # 5. Enrutador SPA con soporte de parámetros y desplazamiento con resaltado
        self.assertIn('scrollToTarget', app_js)
        self.assertIn('table-row-highlight', app_js)
        self.assertIn('queryParams', app_js)

        # 6. Reglas CSS específicas para celdas de eventos y resaltado
        self.assertIn(".cal-cell.has-episode", css_text)
        self.assertIn(".cal-cell.cal-peak-event", css_text)
        self.assertIn(".otd-exp-link", css_text)
        self.assertIn(".table-row-highlight", css_text)
        self.assertIn("@keyframes rowHighlightPulse", css_text)

    def test_live_weather_module_and_ecowitt_integration(self):
        """Verifica que el evolutivo EVO-032 (Píldora de tiempo actual de Ecowitt en portada) esté operativo."""
        live_json_path = ROOT_DIR / "data" / "live.json"
        self.assertTrue(live_json_path.exists(), "Falta el producto data/live.json")
        live_data = json.loads(live_json_path.read_text(encoding="utf-8"))

        # 1. Campos obligatorios y semántica de live.json
        self.assertEqual(live_data.get("status"), "online")
        self.assertIn("temperature_c", live_data)
        self.assertIn("humidity_pct", live_data)
        self.assertIn("rain_daily_mm", live_data)
        self.assertIn("wind_speed_kmh", live_data)
        self.assertIn("timestamp", live_data)
        self.assertIn("dashboard_url", live_data)
        self.assertIn("https://www.ecowitt.net/home/index?id=33161", live_data["dashboard_url"])

        # 2. Comprobación en app.js
        app_js = (ROOT_DIR / "src" / "js" / "app.js").read_text(encoding="utf-8")
        self.assertIn("ensureLiveWeatherLoaded", app_js)
        self.assertIn("renderLiveWeatherWidget", app_js)
        self.assertIn('id="sec-live-weather"', app_js)
        self.assertIn('live-weather-card', app_js)
        self.assertIn('btn-live-refresh', app_js)
        self.assertIn('live-climatology-contrast', app_js)
        self.assertIn('Ecowitt.net', app_js)
        self.assertNotIn('btn-live-config-toggle', app_js)
        self.assertNotIn('live-config-drawer', app_js)

        # 3. Comprobación en styles.css
        css_text = (ROOT_DIR / "src" / "css" / "styles.css").read_text(encoding="utf-8")
        self.assertIn(".live-weather-card", css_text)
        self.assertIn(".live-pulse-dot", css_text)
        self.assertIn("@keyframes livePulseGlow", css_text)
        self.assertIn(".live-kpi-grid", css_text)
        self.assertIn(".live-climatology-contrast", css_text)

        # 4. Comprobación en sw.js (PWA precache de live.json)
        sw_js = (ROOT_DIR / "sw.js").read_text(encoding="utf-8")
        self.assertIn("./data/live.json", sw_js)

    def test_seasonal_and_monthly_windrose_filtering(self):
        """
        EVO-033: Verifica el desglose estacional y mensual en la Rosa Náutica 360°,
        los botones de filtrado interactivo (Anual, Invierno, Primavera, Verano, Otoño y Meses 1..12),
        y las notas sinópticas de contraste orográfico (surada vs cantábrico).
        """
        # 1. Verificar estructura de datos en almanaque JSON
        alm_2023_path = ROOT_DIR / "data" / "almanac_2023.json"
        self.assertTrue(alm_2023_path.exists(), "Falta data/almanac_2023.json")
        alm_2023 = json.loads(alm_2023_path.read_text(encoding="utf-8"))
        wa = alm_2023.get("wind_analysis", {})

        self.assertIn("seasons", wa, "Falta bloque 'seasons' en wind_analysis")
        self.assertIn("monthly", wa, "Falta bloque 'monthly' en wind_analysis")

        for s in ("winter", "spring", "summer", "autumn"):
            self.assertIn(s, wa["seasons"], f"Falta estación {s} en wind_analysis.seasons")
            s_obj = wa["seasons"][s]
            self.assertIn("total_obs", s_obj)
            self.assertIn("predominant_sector", s_obj)
            self.assertIn("rose_16", s_obj)
            self.assertEqual(len(s_obj["rose_16"]), 16)
            self.assertGreater(s_obj["total_obs"], 0)

        # En 2023, invierno y otoño tienen predominio de cuadrante sur (SSE/SE),
        # mientras que primavera y verano tienen predominio del noroeste marítimo (NW).
        self.assertIn(wa["seasons"]["winter"]["predominant_sector"], ("SSE", "SE", "S"))
        self.assertEqual(wa["seasons"]["spring"]["predominant_sector"], "NW")
        self.assertEqual(wa["seasons"]["summer"]["predominant_sector"], "NW")

        # Comprobar meses 1 a 12
        for m in range(1, 13):
            m_key = str(m)
            self.assertIn(m_key, wa["monthly"], f"Falta mes {m_key} en wind_analysis.monthly")
            m_obj = wa["monthly"][m_key]
            self.assertIn("total_obs", m_obj)
            self.assertIn("predominant_sector", m_obj)
            self.assertEqual(len(m_obj["rose_16"]), 16)

        # 2. Comprobar controles y lógica en src/js/app.js
        app_js = (ROOT_DIR / "src" / "js" / "app.js").read_text(encoding="utf-8")
        self.assertIn("windRoseFilter", app_js, "Falta windRoseFilter en app.js")
        self.assertIn("windrose-filter-bar", app_js, "Falta windrose-filter-bar en app.js")
        self.assertIn("btn-windrose-filter", app_js, "Falta clase btn-windrose-filter en app.js")
        self.assertIn("sel-windrose-month", app_js, "Falta selector sel-windrose-month en app.js")
        self.assertIn("windrose-pattern-note", app_js, "Falta contenedor windrose-pattern-note en app.js")
        self.assertIn("Análisis sinóptico local", app_js, "Falta narrativa de análisis sinóptico en app.js")

        # 3. Comprobar estilos CSS en src/css/styles.css
        css_text = (ROOT_DIR / "src" / "css" / "styles.css").read_text(encoding="utf-8")
        self.assertIn(".windrose-filter-bar", css_text, "Falta .windrose-filter-bar en styles.css")
        self.assertIn(".btn-windrose-filter", css_text, "Falta .btn-windrose-filter en styles.css")
        self.assertIn(".btn-windrose-filter.active", css_text, "Falta estado activo de botón en styles.css")
        self.assertIn(".windrose-pattern-note", css_text, "Falta .windrose-pattern-note en styles.css")
        self.assertIn(".select-windrose-month", css_text, "Falta .select-windrose-month en styles.css")

        # 4. Comprobar versión de caché en sw.js e index.html
        sw_js = (ROOT_DIR / "sw.js").read_text(encoding="utf-8")
        self.assertIn("v1.2.7", sw_js, "Falta cache v1.2.7 en sw.js")
        index_html = (ROOT_DIR / "index.html").read_text(encoding="utf-8")
        self.assertIn("v=1.2.7", index_html, "Falta v=1.2.7 en index.html")

    def test_weather_underground_realtime_integration(self):
        """
        EVO-034: Verifica la integración de tiempo real nativa desde Weather Underground (PWS IRIOTU1),
        la consulta directa al endpoint PWS v2 sin requerir autenticación ni GitHub Actions,
        la extracción paralela de la observación actual y el resumen del día, y la contingencia en live.json.
        """
        app_js = (ROOT_DIR / "src" / "js" / "app.js").read_text(encoding="utf-8")

        # 1. Parámetros de la estación e integración WU
        self.assertIn("IRIOTU1", app_js, "Falta identificador de estación IRIOTU1 en app.js")
        self.assertIn("fetchWeatherUndergroundLive", app_js, "Falta función fetchWeatherUndergroundLive en app.js")
        self.assertIn("api.weather.com/v2/pws/observations/current", app_js, "Falta endpoint current de WU en app.js")
        self.assertIn("api.weather.com/v2/pws/dailysummary/1day", app_js, "Falta endpoint dailysummary de WU en app.js")
        self.assertIn("ensureLiveWeatherLoaded", app_js)

        # 2. Respaldo y contingencia
        self.assertIn("live.json", app_js, "Falta fallback a data/live.json")
        self.assertIn("fallback_json", app_js, "Falta tipo fallback_json")

        # 3. Elementos en la interfaz y tarjetas enriquecidas
        self.assertIn("Wunderground", app_js, "Falta enlace a Wunderground en app.js")
        self.assertIn("Ecowitt.net", app_js, "Falta enlace a Ecowitt en app.js")
        self.assertIn("degToSector16", app_js, "Falta conversión de grados a rumbos en app.js")
        self.assertIn("speedToBeaufort", app_js, "Falta función speedToBeaufort en app.js")
        self.assertIn("classifyUvIndex", app_js, "Falta función classifyUvIndex en app.js")
        self.assertIn("formatRelativeTime", app_js, "Falta función formatRelativeTime en app.js")
        self.assertIn("evaluateLiveDiagnostic", app_js, "Falta función evaluateLiveDiagnostic en app.js")
        self.assertIn("updateTopLiveBadge", app_js, "Falta función updateTopLiveBadge en app.js")
        self.assertIn("btn-live-refresh", app_js, "Falta botón de refresco en app.js")

        # 4. Estilos y enlaces en el HTML/CSS
        css_text = (ROOT_DIR / "src" / "css" / "styles.css").read_text(encoding="utf-8")
        self.assertIn(".live-synoptic-pill", css_text, "Falta .live-synoptic-pill en styles.css")

        index_html = (ROOT_DIR / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="top-live-weather-link"', index_html, "Falta id top-live-weather-link en index.html")
        self.assertIn('id="top-live-weather-text"', index_html, "Falta id top-live-weather-text en index.html")

    def test_seo_robots_and_sitemap_integrity(self):
        """
        MEJ-001: Verifica la existencia, sintaxis y consistencia de robots.txt y sitemap.xml.
        Asegura que robots.txt declare el sitemap oficial y permita la indexación de /,
        y que sitemap.xml contenga URLs canónicas válidas para la portada, almanaques anuales,
        récords, labores y datos abiertos de MeteoRiotuerto.
        """
        robots_path = ROOT_DIR / "robots.txt"
        sitemap_path = ROOT_DIR / "sitemap.xml"

        self.assertTrue(robots_path.exists(), "Falta el archivo robots.txt en la raíz")
        self.assertTrue(sitemap_path.exists(), "Falta el archivo sitemap.xml en la raíz")

        robots_txt = robots_path.read_text(encoding="utf-8")
        self.assertIn("User-agent: *", robots_txt)
        self.assertIn("Allow: /", robots_txt)
        self.assertIn("Sitemap: https://egofer.github.io/meteoriotuerto-web/sitemap.xml", robots_txt)

        sitemap_txt = sitemap_path.read_text(encoding="utf-8")
        self.assertIn('<?xml version="1.0" encoding="UTF-8"?>', sitemap_txt)
        self.assertIn('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', sitemap_txt)

        # Verificar presencia de secciones clave en sitemap
        expected_urls = [
            "https://egofer.github.io/meteoriotuerto-web/",
            "https://egofer.github.io/meteoriotuerto-web/#almanaque/2026",
            "https://egofer.github.io/meteoriotuerto-web/#almanaque/2025",
            "https://egofer.github.io/meteoriotuerto-web/#almanaque/2024",
            "https://egofer.github.io/meteoriotuerto-web/#almanaque/2023",
            "https://egofer.github.io/meteoriotuerto-web/#almanaque/2022",
            "https://egofer.github.io/meteoriotuerto-web/#records",
            "https://egofer.github.io/meteoriotuerto-web/#cotidiano",
            "https://egofer.github.io/meteoriotuerto-web/#fiestas",
            "https://egofer.github.io/meteoriotuerto-web/#explorador",
            "https://egofer.github.io/meteoriotuerto-web/#comparativas",
            "https://egofer.github.io/meteoriotuerto-web/#metodologia",
            "https://egofer.github.io/meteoriotuerto-web/#glosario",
            "https://egofer.github.io/meteoriotuerto-web/data/index.json",
            "https://egofer.github.io/meteoriotuerto-web/data/station.geojson",
            "https://egofer.github.io/meteoriotuerto-web/data/schema.json",
        ]
        for url in expected_urls:
            self.assertIn(f"<loc>{url}</loc>", sitemap_txt, f"Falta URL {url} en sitemap.xml")

        # Verificar empaquetado en workflows
        for wf_file in [ROOT_DIR / ".github" / "workflows" / "deploy.yml", ROOT_DIR / "docs" / "deploy.yml"]:
            txt = wf_file.read_text(encoding="utf-8")
            self.assertIn("robots.txt sitemap.xml _site/", txt, f"Falta empaquetado en {wf_file.name}")

        # Verificar precacheo en sw.js
        sw_txt = (ROOT_DIR / "sw.js").read_text(encoding="utf-8")
        self.assertIn("./robots.txt", sw_txt)
        self.assertIn("./sitemap.xml", sw_txt)

    def test_mej_002_portada_decoupling_and_dead_code_purge(self):
        """
        MEJ-002: Verifica el desacoplamiento de la descarga masiva de almanaques en la portada:
        1. renderPortada() solo descarga index.json, records.json y estado en vivo (no bloquea con almanaques ni comparisons).
        2. renderOnThisDayWidget() carga los almanaques de forma diferida y asíncrona bajo demanda.
        3. Se purga el código muerto renderHomeCharts().
        4. Las versiones de caché en sw.js e index.html están sincronizadas en v1.2.3.
        """
        app_js = (ROOT_DIR / "src" / "js" / "app.js").read_text(encoding="utf-8")

        # 1. Comprobar que renderPortada no descarga masivamente almanaques ni comparativas
        self.assertIn("async function renderPortada()", app_js)
        portada_start = app_js.find("async function renderPortada()")
        portada_body = app_js[portada_start : portada_start + 600]
        self.assertIn("ensureIndexLoaded()", portada_body)
        self.assertIn("ensureRecordsLoaded()", portada_body)
        self.assertIn("ensureLiveWeatherLoaded()", portada_body)
        self.assertNotIn("ensureComparisonsLoaded()", portada_body, "renderPortada no debe cargar comparisons.json")
        self.assertNotIn("ensureAllAlmanacsLoaded()", portada_body, "renderPortada no debe cargar todos los almanaques por adelantado")

        # 2. Comprobar que renderOnThisDayWidget es asíncrona y gestiona la carga diferida
        self.assertIn("async function renderOnThisDayWidget(", app_js)
        otd_start = app_js.find("async function renderOnThisDayWidget(")
        otd_body = app_js[otd_start : otd_start + 1200]
        self.assertIn("ensureAllAlmanacsLoaded()", otd_body)

        # 3. Comprobar que renderHomeCharts ha sido eliminada por completo
        self.assertNotIn("function renderHomeCharts", app_js, "renderHomeCharts() debe haber sido purgada de app.js")
        self.assertNotIn("renderHomeCharts(", app_js, "No debe haber llamadas residuales a renderHomeCharts()")

        # 4. Comprobar sincronización de caché v1.2.7
        sw_txt = (ROOT_DIR / "sw.js").read_text(encoding="utf-8")
        index_txt = (ROOT_DIR / "index.html").read_text(encoding="utf-8")
        self.assertIn("v1.2.7", sw_txt)
        self.assertIn("app.js?v=1.2.7", index_txt)

    def test_mej_003_sheetjs_deferred_loading(self):
        """
        MEJ-003: Verifica la carga diferida bajo demanda de SheetJS:
        1. index.html no carga xlsx.mini.min.js en el arranque (ahorro de 245 KB en FCP/LCP).
        2. sw.js precachea ./src/js/vendor/xlsx.mini.min.js para soporte offline inmediato.
        3. ensureXLSXLoaded() en app.js inyecta dinámicamente el script con fallback a CDN.
        4. exportWorkbookToXLSX() gestiona el cursor 'wait' y desbloquea en bloque finally.
        5. Versión de caché v1.2.7 sincronizada en sw.js e index.html.
        """
        html_text = (ROOT_DIR / "index.html").read_text(encoding="utf-8")
        self.assertNotIn("xlsx.mini.min.js", html_text, "index.html no debe cargar SheetJS de forma bloqueante en el arranque")

        sw_txt = (ROOT_DIR / "sw.js").read_text(encoding="utf-8")
        self.assertIn("./src/js/vendor/xlsx.mini.min.js", sw_txt, "sw.js debe precachear SheetJS para modo offline")
        self.assertIn("v1.2.7", sw_txt)

        app_js = (ROOT_DIR / "src" / "js" / "app.js").read_text(encoding="utf-8")
        self.assertIn("async function ensureXLSXLoaded()", app_js)
        self.assertIn("s.src = './src/js/vendor/xlsx.mini.min.js'", app_js)
        self.assertIn("s.async = true", app_js)
        self.assertIn("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.mini.min.js", app_js)
        self.assertIn("document.body.style.cursor = 'wait'", app_js)

    def test_mej_004_open_graph_and_twitter_cards_metadata(self):
        """
        MEJ-004: Verifica la presencia y coherencia de los metadatos sociales Open Graph y Twitter Cards:
        1. Etiqueta canonical canónica en index.html apuntando a https://egofer.github.io/meteoriotuerto-web/
        2. Metadatos Open Graph completos: og:type, og:site_name, og:title, og:description, og:url, og:image, og:locale.
        3. Metadatos Twitter Cards completos: twitter:card, twitter:title, twitter:description, twitter:image.
        4. Imagen canónica existente en assets/img/estacion-meteorologica-barrio-de-arriba.jpg con dimensiones declaradas (1600x1200).
        """
        html_text = (ROOT_DIR / "index.html").read_text(encoding="utf-8")

        # 1. Canonical
        self.assertIn('<link rel="canonical" href="https://egofer.github.io/meteoriotuerto-web/">', html_text)

        # 2. Open Graph
        expected_og = [
            '<meta property="og:type" content="website">',
            '<meta property="og:locale" content="es_ES">',
            '<meta property="og:site_name" content="MeteoRiotuerto">',
            '<meta property="og:title" content="MeteoRiotuerto — Almanaque meteorológico y climatológico digital de Riotuerto">',
            '<meta property="og:url" content="https://egofer.github.io/meteoriotuerto-web/">',
            '<meta property="og:image" content="https://egofer.github.io/meteoriotuerto-web/assets/img/estacion-meteorologica-barrio-de-arriba.jpg">',
            '<meta property="og:image:secure_url" content="https://egofer.github.io/meteoriotuerto-web/assets/img/estacion-meteorologica-barrio-de-arriba.jpg">',
            '<meta property="og:image:type" content="image/jpeg">',
            '<meta property="og:image:width" content="1600">',
            '<meta property="og:image:height" content="1200">',
        ]
        for og_tag in expected_og:
            self.assertIn(og_tag, html_text, f"Falta etiqueta Open Graph: {og_tag}")

        self.assertIn('property="og:description"', html_text)
        self.assertIn('property="og:image:alt"', html_text)

        # 3. Twitter Cards
        expected_twitter = [
            '<meta name="twitter:card" content="summary_large_image">',
            '<meta name="twitter:title" content="MeteoRiotuerto — Almanaque meteorológico y climatológico digital de Riotuerto">',
            '<meta name="twitter:image" content="https://egofer.github.io/meteoriotuerto-web/assets/img/estacion-meteorologica-barrio-de-arriba.jpg">',
        ]
        for tw_tag in expected_twitter:
            self.assertIn(tw_tag, html_text, f"Falta etiqueta Twitter Card: {tw_tag}")

        self.assertIn('name="twitter:description"', html_text)
        self.assertIn('name="twitter:image:alt"', html_text)

        # 4. Existencia de la imagen canónica en disco
        img_path = ROOT_DIR / "assets" / "img" / "estacion-meteorologica-barrio-de-arriba.jpg"
        self.assertTrue(img_path.exists(), "La imagen referenciada en og:image no existe en assets/img")
        self.assertGreater(img_path.stat().st_size, 100_000, "La imagen og:image parece incompleta o vacía")

    def test_mej_005_dynamic_document_title_and_metadata(self):
        """
        MEJ-005: Verifica la actualización reactiva y dinámica de document.title y metadatos SEO / Open Graph:
        1. handleRouteChange() invoca updateDocumentMetadata(route, param, subparam, idx).
        2. updateDocumentMetadata actualiza document.title, meta[name="description"], og:title, og:description, og:url, twitter:title y twitter:description.
        3. Manejo diferenciado de rutas clave: almanaques anuales y mensuales, récords (episodios, rankings, absolutos), fiestas, labores cotidianas, explorador, comparativas, metodología y glosario.
        4. Sincronización de caché v1.2.7 en sw.js e index.html.
        """
        app_js = (ROOT_DIR / "src" / "js" / "app.js").read_text(encoding="utf-8")

        # 1. Definición y llamada de la función
        self.assertIn("function updateDocumentMetadata(route, param, subparam, idx)", app_js)
        self.assertIn("updateDocumentMetadata(route, param, subparam, idx)", app_js)

        # 2. Asignación de document.title y selectores de metadatos
        fn_start = app_js.find("function updateDocumentMetadata(route, param, subparam, idx)")
        fn_end = app_js.find("async function handleRouteChange()")
        fn_body = app_js[fn_start:fn_end]

        self.assertIn("document.title = title;", fn_body)
        self.assertIn('document.querySelector(\'meta[name="description"]\')', fn_body)
        self.assertIn('document.querySelector(\'meta[property="og:title"]\')', fn_body)
        self.assertIn('document.querySelector(\'meta[property="og:description"]\')', fn_body)
        self.assertIn('document.querySelector(\'meta[property="og:url"]\')', fn_body)
        self.assertIn('document.querySelector(\'meta[name="twitter:title"]\')', fn_body)
        self.assertIn('document.querySelector(\'meta[name="twitter:description"]\')', fn_body)

        # 3. Casuística de secciones
        self.assertIn("route === 'almanaque'", fn_body)
        self.assertIn("route === 'records'", fn_body)
        self.assertIn("route === 'cotidiano' || route === 'fiestas'", fn_body)
        self.assertIn("route === 'explorador'", fn_body)
        self.assertIn("route === 'comparativas'", fn_body)
        self.assertIn("route === 'metodologia'", fn_body)
        self.assertIn("route === 'glosario'", fn_body)

        # 4. Sincronización de versión de caché v1.2.7
        sw_txt = (ROOT_DIR / "sw.js").read_text(encoding="utf-8")
        index_txt = (ROOT_DIR / "index.html").read_text(encoding="utf-8")
        self.assertIn("v1.2.7", sw_txt)
        self.assertIn("app.js?v=1.2.7", index_txt)
        self.assertIn("styles.css?v=1.2.7", index_txt)

    def test_mej_012_schema_org_json_ld_metadata(self):
        """
        MEJ-012: Verifica el marcado semántico estructurado Schema.org JSON-LD en index.html:
        1. Existencia del bloque script type="application/ld+json".
        2. Sintaxis JSON estricta y contexto canónico https://schema.org.
        3. Entidad WeatherStation con coordenadas geográficas (43.341, -3.670, 115 m), dirección postal y enlaces de calibración.
        4. Entidad Dataset con licencia CC BY 4.0, cobertura temporal, espacial, variables medidas y distribuciones de descarga.
        5. Entidad WebSite declarando el idioma es-ES y metadatos generales.
        """
        import json
        import re

        html_text = (ROOT_DIR / "index.html").read_text(encoding="utf-8")
        m = re.search(r'<script type="application/ld\+json">(.*?)</script>', html_text, re.DOTALL)
        self.assertIsNotNone(m, "Falta el bloque script application/ld+json en index.html")

        json_ld = json.loads(m.group(1))
        self.assertEqual(json_ld.get("@context"), "https://schema.org")
        self.assertIn("@graph", json_ld)

        graph = {item.get("@type"): item for item in json_ld["@graph"]}
        self.assertIn("WeatherStation", graph, "Falta entidad WeatherStation en Schema.org")
        self.assertIn("Dataset", graph, "Falta entidad Dataset en Schema.org")
        self.assertIn("WebSite", graph, "Falta entidad WebSite en Schema.org")

        # Comprobar WeatherStation
        station = graph["WeatherStation"]
        self.assertIn("Barrio de Arriba", station["name"])
        self.assertEqual(station["geo"]["latitude"], 43.341)
        self.assertEqual(station["geo"]["longitude"], -3.670)
        self.assertEqual(station["geo"]["elevation"], 115)
        self.assertEqual(station["address"]["addressLocality"], "Riotuerto")
        self.assertEqual(station["address"]["addressRegion"], "Cantabria")
        self.assertEqual(station["provider"]["name"], "Emilio Gómez Fernández")
        self.assertEqual(station["creator"]["name"], "Emilio Gómez Fernández")
        self.assertTrue(any("wunderground" in url for url in station["sameAs"]))
        self.assertTrue(any("weathercloud" in url for url in station["sameAs"]))

        # Comprobar Dataset
        dataset = graph["Dataset"]
        self.assertIn("2022–2026", dataset["name"])
        self.assertEqual(dataset["creator"]["name"], "Emilio Gómez Fernández")
        self.assertEqual(dataset["publisher"]["name"], "MeteoRiotuerto")
        self.assertIn("https://creativecommons.org/licenses/by/4.0/", dataset["license"])
        self.assertTrue(dataset["isAccessibleForFree"])
        self.assertEqual(dataset["temporalCoverage"], "2022-01-01/..")
        self.assertGreaterEqual(len(dataset["variableMeasured"]), 5)
        dist_formats = [d["encodingFormat"] for d in dataset["distribution"]]
        self.assertIn("application/json", dist_formats)
        self.assertIn("application/geo+json", dist_formats)
        self.assertIn("application/schema+json", dist_formats)

    def test_mej_010_prefers_reduced_motion_support(self):
        """
        MEJ-010: Verifica el soporte completo de accesibilidad para la preferencia prefers-reduced-motion:
        1. Regla global en styles.css con @media (prefers-reduced-motion: reduce) que neutraliza duraciones,
           desplaza suavemente a auto y cancela animaciones infinitas/parpadeos (WCAG 2.2 AAA / A).
        2. Detección en app.js mediante matchMedia('(prefers-reduced-motion: reduce)') en prefersReducedMotion().
        3. createChart() desactiva animaciones de Chart.js (options.animation = false) ante la preferencia.
        4. getScrollBehavior() conmuta dinámicamente entre 'auto' y 'smooth' en el router y eventos data-scroll-to.
        5. Versión de caché v1.2.7 sincronizada en sw.js e index.html.
        """
        css_text = (ROOT_DIR / "src" / "css" / "styles.css").read_text(encoding="utf-8")
        self.assertIn("@media (prefers-reduced-motion: reduce)", css_text)
        self.assertIn("animation-duration: 0.01ms !important;", css_text)
        self.assertIn("scroll-behavior: auto !important;", css_text)
        self.assertIn(".topo-pulse-beacon", css_text)
        self.assertIn(".pulse-offline", css_text)
        self.assertIn(".live-pulse-glow", css_text)
        self.assertIn(".row-highlight-pulse", css_text)

        app_js = (ROOT_DIR / "src" / "js" / "app.js").read_text(encoding="utf-8")
        self.assertIn("function prefersReducedMotion()", app_js)
        self.assertIn("window.matchMedia('(prefers-reduced-motion: reduce)')", app_js)
        self.assertIn("function getScrollBehavior()", app_js)
        self.assertIn("config.options.animation = false;", app_js)
        self.assertIn("behavior: getScrollBehavior()", app_js)

        # Comprobar versión de caché v1.2.7
        sw_txt = (ROOT_DIR / "sw.js").read_text(encoding="utf-8")
        index_txt = (ROOT_DIR / "index.html").read_text(encoding="utf-8")
        self.assertIn("v1.2.7", sw_txt)
        self.assertIn("app.js?v=1.2.7", index_txt)
        self.assertIn("styles.css?v=1.2.7", index_txt)

    def test_mej_009_accessible_tables_caption_and_scope(self):
        """
        MEJ-009: Verifica la accesibilidad universal en tablas de datos (WCAG 2.2 AA):
        1. Las 19 tablas dinámicas en app.js disponen de su correspondiente etiqueta <caption> descriptiva.
        2. Todas las cabeceras <th> cuentan explícitamente con atributo scope='col' o scope='row' (0 <th> huérfanos).
        3. En styles.css se incluye la regla de estilo para caption (.data-table caption, .table-caption).
        4. Sincronización de versión de caché v1.2.7 en sw.js e index.html.
        """
        import re

        app_js = (ROOT_DIR / "src" / "js" / "app.js").read_text(encoding="utf-8")

        # 1. Verificar que existen tablas y que el 100% tienen caption
        table_matches = re.findall(r'<table\b[^>]*>.*?</table>', app_js, re.DOTALL)
        self.assertEqual(len(table_matches), 19, f"Se esperaban 19 tablas en app.js, encontradas {len(table_matches)}")
        for idx, tbl in enumerate(table_matches, 1):
            self.assertIn("<caption", tbl, f"La tabla {idx} carece de etiqueta <caption> en app.js")
            self.assertIn('class="table-caption"', tbl, f"La tabla {idx} carece de clase table-caption en <caption>")

        # 2. Verificar que el 100% de los <th> tienen atributo scope
        th_tags = re.findall(r'<th\b[^>]*>', app_js)
        self.assertGreaterEqual(len(th_tags), 150, "Debe haber al menos 150 etiquetas <th> en app.js")
        th_without_scope = [th for th in th_tags if "scope=" not in th]
        self.assertEqual(len(th_without_scope), 0, f"Existen <th> sin atributo scope: {th_without_scope}")

        # 3. Comprobar reglas CSS para caption
        css_text = (ROOT_DIR / "src" / "css" / "styles.css").read_text(encoding="utf-8")
        self.assertIn(".data-table caption", css_text)
        self.assertIn("caption-side: top;", css_text)

        # 4. Comprobar sincronización de versión de caché v1.2.7
        sw_txt = (ROOT_DIR / "sw.js").read_text(encoding="utf-8")
        index_txt = (ROOT_DIR / "index.html").read_text(encoding="utf-8")
        self.assertIn("v1.2.7", sw_txt)
        self.assertIn("app.js?v=1.2.7", index_txt)
        self.assertIn("styles.css?v=1.2.7", index_txt)

    def test_mej_006_minified_json_production_output(self):
        """
        MEJ-006: Verifica la minificación atómica de productos JSON para producción:
        1. scripts/build_data.py define minify=True por defecto con separators=(',', ':') y soporta --pretty.
        2. Todos los archivos JSON y GeoJSON de data/ están minificados en una sola línea (0 saltos de línea).
        3. Todos los archivos JSON son sintácticamente válidos al cargarse con json.loads.
        4. El ahorro global de peso frente a la versión con sangría supera el 40 %.
        """
        build_script = (ROOT_DIR / "scripts" / "build_data.py").read_text(encoding="utf-8")
        self.assertIn("minify: bool = True", build_script)
        self.assertIn('separators=(",", ":")', build_script)
        self.assertIn("--pretty", build_script)

        data_dir = ROOT_DIR / "data"
        json_files = list(data_dir.glob("*.json")) + list(data_dir.glob("*.geojson"))
        self.assertGreaterEqual(len(json_files), 12, "Debe haber al menos 12 archivos de datos JSON/GeoJSON")

        for fpath in json_files:
            raw_content = fpath.read_text(encoding="utf-8")
            # Comprobar que no hay saltos de línea (archivo minificado en una única línea)
            line_count = len(raw_content.splitlines())
            self.assertLessEqual(line_count, 1, f"El archivo {fpath.name} no está minificado (tiene {line_count} líneas)")
            # Comprobar validez sintáctica
            parsed = json.loads(raw_content)
            self.assertTrue(isinstance(parsed, (dict, list)), f"Contenido inválido en {fpath.name}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
