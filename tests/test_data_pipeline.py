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

    def test_web_structure_and_static_serving(self) -> None:
        # Verificar existencia de archivos clave
        required_paths = [
            ROOT_DIR / "index.html",
            ROOT_DIR / "src" / "css" / "styles.css",
            ROOT_DIR / "src" / "js" / "app.js",
            ROOT_DIR / ".github" / "workflows" / "deploy.yml",
            ROOT_DIR / "docs" / "METODOLOGIA.md",
            ROOT_DIR / "docs" / "GUIA_DESPLIEGUE.md",
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
        ]:
            self.assertIn(f'id="{section_id}"', html_text)

        # Verificar ausencia de credenciales o claves privadas
        for p in required_paths:
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
                    "/src/css/styles.css",
                    "/src/js/app.js",
                    "/data/index.json",
                    "/data/records.json",
                    "/data/comparisons.json",
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
