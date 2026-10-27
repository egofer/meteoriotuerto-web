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
                    "/favicon.svg",
                    "/favicon.ico",
                    "/src/css/styles.css",
                    "/src/js/app.js",
                    "/src/js/vendor/xlsx.mini.min.js",
                    "/assets/img/estacion-meteorologica-barrio-de-arriba.jpg",
                    "/assets/img/estacion-meteorologica-barrio-de-arriba.webp",
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

        html_text = (ROOT_DIR / "index.html").read_text(encoding="utf-8")
        self.assertIn("xlsx.mini.min.js", html_text, "Falta la carga de SheetJS en index.html")

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


if __name__ == "__main__":
    unittest.main(verbosity=2)
