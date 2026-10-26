#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
===============================================================================
validate_data.py — Validación de integridad y coherencia de los JSONs generados
===============================================================================
Verifica que todos los archivos JSON en `data/` existan, sean sintácticamente
válidos, respeten los invariantes físicos y meteorológicos y coincidan con los
valores de referencia comprobados de la estación MeteoRiotuerto.
===============================================================================
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List


REQUIRED_FILES = [
    "index.json",
    "records.json",
    "comparisons.json",
    "glossary.json",
    "station.geojson",
    "schema.json",
    "almanac_2022.json",
    "almanac_2023.json",
    "almanac_2024.json",
    "almanac_2025.json",
    "almanac_2026.json",
]

# Valores de referencia verificados empíricamente sobre los CSVs oficiales
REFERENCE_CHECKS = {
    2022: {"temp_mean": 14.7, "temp_max_abs": 39.4, "temp_min_abs": -2.1, "rain_total": 1604.8, "gust_max": 73.4},
    2023: {"temp_mean": 14.4, "temp_max_abs": 40.4, "temp_min_abs": -1.7, "rain_total": 2140.4, "gust_max": 73.4},
    2024: {"temp_mean": 14.3, "temp_max_abs": 42.1, "temp_min_abs": -3.1, "rain_total": 2047.9, "gust_max": 97.2},
    2025: {"temp_mean": 14.7, "temp_max_abs": 40.2, "temp_min_abs": -2.2, "rain_total": 1706.9, "gust_max": 86.4},
    2026: {"temp_mean": 15.8, "temp_max_abs": 41.3, "temp_min_abs": -1.4, "rain_total": 1504.3, "gust_max": 73.4},
}


def validate_directory(data_dir: Path) -> List[str]:
    errors: List[str] = []

    if not data_dir.exists():
        return [f"El directorio de datos no existe: {data_dir}"]

    loaded: Dict[str, Any] = {}
    for fname in REQUIRED_FILES:
        fpath = data_dir / fname
        if not fpath.exists():
            errors.append(f"Falta el archivo obligatorio: {fname}")
            continue
        if fpath.stat().st_size < 100:
            errors.append(f"El archivo {fname} está vacío o truncado ({fpath.stat().st_size} bytes)")
            continue
        try:
            with open(fpath, encoding="utf-8") as fp:
                loaded[fname] = json.load(fp)
        except Exception as exc:
            errors.append(f"Error de sintaxis JSON en {fname}: {exc}")

    if errors:
        return errors

    # 1. Validar index.json y records.json
    idx = loaded["index.json"]
    rec = loaded["records.json"]
    abs_rec = rec.get("absolute_records", {})
    if abs_rec.get("temp_max", {}).get("value") != 42.1:
        errors.append(f"Récord de temperatura máxima inesperado: {abs_rec.get('temp_max')}")
    if abs_rec.get("temp_min", {}).get("value") != -3.1:
        errors.append(f"Récord de temperatura mínima inesperado (¿contaminación por pico espurio?): {abs_rec.get('temp_min')}")
    if abs_rec.get("max_daily_rain", {}).get("value") != 125.9:
        errors.append(f"Récord de precipitación diaria inesperado: {abs_rec.get('max_daily_rain')}")
    if abs_rec.get("max_wind_gust", {}).get("value") != 97.2:
        errors.append(f"Récord de racha máxima inesperado: {abs_rec.get('max_wind_gust')}")

    # 2. Validar cada almanaque anual
    for year, expected in REFERENCE_CHECKS.items():
        alm = loaded[f"almanac_{year}.json"]
        st_t = alm["stats"]["temperature"]
        st_p = alm["stats"]["precipitation"]
        st_w = alm["stats"]["wind"]

        if st_t["mean"] != expected["temp_mean"]:
            errors.append(f"[{year}] T. media {st_t['mean']} != {expected['temp_mean']}")
        if st_t["max_abs"] != expected["temp_max_abs"]:
            errors.append(f"[{year}] T. máx abs {st_t['max_abs']} != {expected['temp_max_abs']}")
        if st_t["min_abs"] != expected["temp_min_abs"]:
            errors.append(f"[{year}] T. mín abs {st_t['min_abs']} != {expected['temp_min_abs']}")
        # Para años cerrados verificar coincidencia exacta; para año provisional en curso admitir actualización >=
        if year != 2026:
            if st_p["total_mm"] != expected["rain_total"]:
                errors.append(f"[{year}] Lluvia total {st_p['total_mm']} != {expected['rain_total']}")
        else:
            if st_p["total_mm"] < expected["rain_total"]:
                errors.append(f"[{year}] Lluvia total provisional {st_p['total_mm']} menor que referencia {expected['rain_total']}")
        if st_w["max_gust_kmh"] != expected["gust_max"]:
            errors.append(f"[{year}] Racha máx {st_w['max_gust_kmh']} != {expected['gust_max']}")

        # Invariantes físicos en la serie diaria
        ds = alm["daily_series"]
        n_dates = len(ds["dates"])
        for key, arr in ds.items():
            if len(arr) != n_dates:
                errors.append(f"[{year}] Longitud desigual en serie diaria '{key}': {len(arr)} vs {n_dates}")

        for i, d_str in enumerate(ds["dates"]):
            tmin = ds["temp_min"][i]
            tmean = ds["temp_mean"][i]
            tmax = ds["temp_max"][i]
            if tmin is not None and tmax is not None and tmin > tmax:
                errors.append(f"[{year} {d_str}] Invariante térmico violado: Tmin ({tmin}) > Tmax ({tmax})")
            if tmean is not None and tmin is not None and tmax is not None:
                if not (tmin - 0.5 <= tmean <= tmax + 0.5):
                    errors.append(f"[{year} {d_str}] Tmean ({tmean}) fuera de rango [{tmin}, {tmax}]")
            rain = ds["rain_daily"][i]
            if rain is not None and rain < 0:
                errors.append(f"[{year} {d_str}] Lluvia negativa: {rain}")

    # 3. Validar glosario meteorológico y divulgativo (glossary.json)
    glo = loaded.get("glossary.json", {})
    categories = glo.get("categories", [])
    terms = glo.get("terms", [])
    if len(categories) < 6:
        errors.append(f"Número insuficiente de categorías en glosario: {len(categories)} < 6")
    if len(terms) < 30:
        errors.append(f"Número insuficiente de términos en glosario: {len(terms)} < 30")

    cat_ids = {c.get("id") for c in categories if isinstance(c, dict)}
    term_ids = set()
    for t in terms:
        t_id = t.get("id")
        if not t_id:
            errors.append(f"Término en glosario sin identificador: {t}")
            continue
        if t_id in term_ids:
            errors.append(f"Identificador de término duplicado en glosario: {t_id}")
        term_ids.add(t_id)

        c_id = t.get("category_id")
        if c_id not in cat_ids:
            errors.append(f"Categoría desconocida '{c_id}' en término '{t_id}'")

        for req_field in ["term", "short_definition", "full_definition", "riotuerto_context"]:
            if not t.get(req_field):
                errors.append(f"Campo obligatorio '{req_field}' vacío o ausente en término '{t_id}'")

    # Verificar que las referencias cruzadas see_also apunten a términos existentes
    for t in terms:
        for sa in t.get("see_also", []):
            if sa not in term_ids:
                errors.append(f"Término '{t.get('id')}' referencia a término inexistente en see_also: '{sa}'")

    # 4. Validar ficha GeoJSON (station.geojson) y esquema JSON Schema (schema.json) — EVO-010
    geojson = loaded.get("station.geojson", {})
    if geojson.get("type") != "FeatureCollection":
        errors.append(f"station.geojson debe ser FeatureCollection, encontrado: {geojson.get('type')}")
    g_features = geojson.get("features", [])
    if len(g_features) < 3:
        errors.append(f"station.geojson debe incluir al menos 3 entidades (estación + hitos), encontradas: {len(g_features)}")
    else:
        main_feat = g_features[0]
        coords = main_feat.get("geometry", {}).get("coordinates", [])
        if coords != [-3.67, 43.341, 115]:
            errors.append(f"Coordenadas GeoJSON inesperadas en estación principal: {coords}")
        props = main_feat.get("properties", {})
        if props.get("record_temp_max_c") != 42.1 or props.get("record_temp_min_c") != -3.1:
            errors.append("Atributos de récords en station.geojson no coinciden con los valores verificados.")

    schema_doc = loaded.get("schema.json", {})
    if "2020-12/schema" not in str(schema_doc.get("$schema", "")):
        errors.append("schema.json no declara JSON Schema Draft 2020-12.")
    if len(schema_doc.get("variables_dictionary", {})) < 15:
        errors.append("schema.json tiene un diccionario de variables incompleto.")
    if "$defs" not in schema_doc:
        errors.append("schema.json carece del bloque $defs de definiciones formales.")

    # 5. Salvaguarda de seguridad, privacidad doméstica e identificadores físicos en los JSONs
    forbidden_json_patterns = [
        ("Credencial o token expuesto", re.compile(r"(?:ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|APPLICATION_KEY|API_KEY|PASSKEY)")),
        ("Dirección MAC de hardware expuesta", re.compile(r"\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b")),
        ("Dirección IP privada local expuesta", re.compile(r"\b(?:192\.168\.|10\.\d+\.|172\.(?:1[6-9]|2\d|3[01])\.)\d+\.\d+\b")),
        ("Ruta absoluta de usuario local expuesta", re.compile(r"/home/(?!index\b)[a-zA-Z0-9_-]+")),
        ("Coordenada doméstica de alta precisión (>3 decimales) expuesta", re.compile(r"43[.,]3409\d*|3[.,]6698\d*")),
        ("Variable de sensor interior doméstico expuesta", re.compile(r'"(?:interior|indoor|tempin|humidityin|dewpointin|feelslikein)"', re.IGNORECASE)),
    ]
    for fname in REQUIRED_FILES:
        raw_text = (data_dir / fname).read_text(encoding="utf-8")
        for label, pat in forbidden_json_patterns:
            if pat.search(raw_text):
                errors.append(f"[SEGURIDAD/PRIVACIDAD en {fname}] {label}")

    return errors


def main() -> None:
    parser = argparse.ArgumentParser(description="Valida la integridad de los productos JSON de MeteoRiotuerto.")
    parser.add_argument(
        "--data-dir",
        type=str,
        default=str(Path(__file__).resolve().parent.parent / "data"),
        help="Ruta al directorio data/.",
    )
    args = parser.parse_args()
    errs = validate_directory(Path(args.data_dir))
    if errs:
        print("[ERROR] Se detectaron fallos de validación en los datos:")
        for e in errs:
            print(f"  - {e}")
        sys.exit(1)
    print(f"[OK] Validación superada con éxito ({len(REQUIRED_FILES)} archivos JSON e invariantes verificados).")
    sys.exit(0)


if __name__ == "__main__":
    main()
