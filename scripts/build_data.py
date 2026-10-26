#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
===============================================================================
build_data.py — Procesamiento climatológico y generación de JSONs para la web
===============================================================================
Lee los archivos CSV originales del repositorio MeteoRiotuerto (2022–2026),
normaliza formatos y cabeceras, aplica controles de calidad documentados sin
alterar los archivos fuente, calcula indicadores meteorológicos y climatológicos
verificables y genera de forma atómica los productos JSON estáticos en `data/`.
===============================================================================
"""

from __future__ import annotations

import argparse
import calendar
import json
import math
import shutil
import sys
import tempfile
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

try:
    from scripts.glossary_data import get_glossary_payload
except ImportError:
    from glossary_data import get_glossary_payload

# -----------------------------------------------------------------------------
# Constantes geográficas, meteorológicas y editoriales
# -----------------------------------------------------------------------------
STATION_META = {
    "name": "MeteoRiotuerto",
    "Title": "MeteoRiotuerto — Almanaque meteorológico y climatológico digital de Riotuerto",
    "subtitle": "Archivo histórico y notario del clima local de Barrio de Arriba (Riotuerto, Cantabria)",
    "location": {
        "locality": "Barrio de Arriba",
        "municipality": "Riotuerto",
        "region": "Cantabria",
        "country": "España",
        "valley": "Valle del río Covadal (cuenca alta-media del Miera, Trasmiera)",
        "latitude": 43.341,
        "longitude": -3.670,
        "altitude_msnm": 115,
        "crs": "WGS84 (EPSG:4326)",
        "coordinates_display": "43.341° N, 3.670° W",
        "timezone": "Europe/Madrid",
        "distance_coast_km": 14,
        "distance_santander_airport_km": 16,
        "distance_alisas_pass_km": 5,
    },
    "hardware": {
        "station_model": "Sainlogic WS3500",
        "gateway_model": "Ecowitt GW1200",
        "mounting": "Mástil de 3 metros sin obstáculos circundantes",
        "sampling_interval_min": 30,
        "series_start": "2020-11-29",
        "consolidated_years": [2022, 2023, 2024, 2025, 2026],
        "complete_years": [2022, 2023, 2024, 2025],
        "provisional_years": [2026],
    },
    "links": {
        "data_repo": "https://github.com/egofer/meteoriotuerto/",
        "weathercloud": "https://app.weathercloud.net/d6619283754",
        "ecowitt_live": "https://www.ecowitt.net/home/index?id=33161",
        "openstreetmap": "https://www.openstreetmap.org/?mlat=43.341&mlon=-3.670#map=15/43.341/-3.670",
    },
}

MONTH_NAMES_ES = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
]
MONTH_SHORT_ES = [
    "Ene", "Feb", "Mar", "Abr", "May", "Jun",
    "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"
]

WIND_SECTORS_16 = [
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"
]

BEAUFORT_SCALE = [
    (0, 1.0, "F0 · Calma (<1 km/h)"),
    (1, 5.0, "F1 · Ventolina (1–5 km/h)"),
    (2, 11.0, "F2 · Flojito (6–11 km/h)"),
    (3, 19.0, "F3 · Flojo (12–19 km/h)"),
    (4, 28.0, "F4 · Bonancible (20–28 km/h)"),
    (5, 38.0, "F5 · Fresquito (29–38 km/h)"),
    (6, 49.0, "F6 · Fresco (39–49 km/h)"),
    (7, 61.0, "F7 · Frescachón (50–61 km/h)"),
    (8, 74.0, "F8 · Temporal (62–74 km/h)"),
    (9, 88.0, "F9 · Temporal fuerte (75–88 km/h)"),
    (10, 102.0, "F10 · Temporal duro (89–102 km/h)"),
    (11, 999.0, "F11+ · Temporal muy duro (>102 km/h)"),
]

# Constante solar extraterrestre (W/m²) y umbral OMM de insolación directa (120 W/m²)
SOLAR_CONSTANT_MAX_WM2 = 1361.0
WMO_SUNSHINE_THRESHOLD_WM2 = 120.0

RAW_GITHUB_BASE = "https://raw.githubusercontent.com/egofer/meteoriotuerto/main"

EXPECTED_YEAR_FILES = {
    2022: {"daily": "2022/data/riotuerto_2022_daily.csv", "30min": None},
    2023: {"daily": "2023/data/riotuerto_2023_daily.csv", "30min": "2023/data/riotuerto_2023_30min.csv"},
    2024: {"daily": "2024/data/riotuerto_2024_diario.csv", "30min": "2024/data/riotuerto_2024_30min.csv"},
    2025: {"daily": "2025/data/riotuerto_2025_daily.csv", "30min": "2025/data/riotuerto_2025_30min.csv"},
    2026: {"daily": "2026/data/riotuerto_2026_daily.csv", "30min": "2026/data/riotuerto_2026_30min.csv"},
}

# Textos editoriales y crónicas sinópticas verificadas por año
EDITORIAL_CHRONICLES: Dict[int, Dict[str, Any]] = {
    2022: {
        "character": "Cálido y húmedo",
        "headline": "Verano contrastado, noviembre muy lluvioso y amplitud térmica marcada",
        "synoptic_summary": (
            "El año 2022 en Barrio de Arriba (Riotuerto) cerró con una temperatura media anual de 14,7 °C "
            "y una precipitación acumulada de 1604,8 mm repartida en 211 días de lluvia apreciable (≥0,2 mm). "
            "Destacó la fuerte insolación y calidez estival, con 28 días por encima de los 30 °C, en contraste "
            "con un invierno de frecuentes inversiones térmicas que dejó 20 días de helada."
        ),
        "thermal_notes": (
            "La máxima absoluta alcanzó los 39,4 °C el 17 de julio durante una intensa advección cálida del sur, "
            "mientras que la mínima descendió hasta -2,1 °C el 23 de enero. Pese al calor diurno estival, "
            "el enfriamiento nocturno del valle impidió que se registrasen noches tropicales (la mínima más alta "
            "fue de 19,5 °C el 3 de agosto). El 11 de septiembre se observó una oscilación térmica diaria de 24,4 °C."
        ),
        "rain_notes": (
            "El régimen pluviométrico mostró dos extremos muy marcados: un verano e inicio de otoño secos "
            "(julio con solo 27,4 mm, mayo con 34,1 mm y octubre con 37,1 mm) frente a un noviembre muy húmedo "
            "(261,1 mm) y un enero activo (206,2 mm) que dejó la mayor precipitación diaria del año el 9 de enero (67,1 mm)."
        ),
        "wind_notes": (
            "La velocidad media anual se mantuvo en 2,6 km/h por el abrigo orográfico del valle, pero se registraron "
            "35 días con rachas iguales o superiores a 40 km/h, culminando el 31 de diciembre con una racha máxima de 73,4 km/h."
        ),
        "episodes": [
            {"date": "2022-01-09", "type": "lluvia", "title": "Temporal invernal de enero", "value": "67,1 mm", "description": "Día más lluvioso del año durante un episodio persistente del noroeste que dejó 206,2 mm en enero."},
            {"date": "2022-01-23", "type": "frio", "title": "Mínima absoluta anual e inversiones térmicas", "value": "-2,1 °C", "description": "Madrugada más fría de un año que contabilizó 20 jornadas de helada ( récord de la serie observada)."},
            {"date": "2022-07-17", "type": "calor", "title": "Pico de calor estival en julio", "value": "39,4 °C", "description": "Techo térmico anual asociado a entrada de aire cálido subtropical y viento sur."},
            {"date": "2022-09-11", "type": "amplitud", "title": "Gran oscilación térmica de septiembre", "value": "24,4 °C", "description": "Diferencia de 24,4 °C entre la mínima matinal y la máxima diurna."},
            {"date": "2022-12-31", "type": "viento", "title": "Despedida de año con temporal del sur", "value": "73,4 km/h", "description": "Racha máxima anual registrada en la última jornada del año."},
        ],
        "data_note": (
            "Para el año 2022 el repositorio público conserva íntegramente la serie climatológica diaria (365 días), "
            "sin archivo desglosado a resolución de 30 minutos."
        ),
    },
    2023: {
        "character": "Extremadamente húmedo y muy cálido",
        "headline": "El año de los más de 2100 mm, el diluvio de enero y el octubre con noche tropical",
        "synoptic_summary": (
            "El año 2023 quedó definido como el año más lluvioso de la serie registrada en MeteoRiotuerto, "
            "superando la barrera de los 2100 mm (2140,4 mm acumulados), pese a contar con una interrupción técnica "
            "de 20 días entre finales de septiembre y mediados de octubre. Estuvo marcado por una dualidad estacional "
            "extrema: trenes de borrascas invernales y otoñales frente a anomalías cálidas notables."
        ),
        "thermal_notes": (
            "Con una temperatura media anual de 14,4 °C, el hito térmico estival se produjo el 23 de agosto al alcanzarse "
            "los 40,4 °C bajo una intensa surada que disparó los termómetros en toda Cantabria. En otoño destacó la madrugada "
            "del 18 de octubre, cuando no se bajó de 20,3 °C, configurando una noche tropical en pleno otoño astronómico. "
            "La mínima absoluta anual fue de -1,7 °C el 11 de febrero, con 14 días de helada."
        ),
        "rain_notes": (
            "Enero de 2023 fue extraordinario con 509,8 mm acumulados bajo el impacto de las borrascas Fien y Gérard; "
            "el 16 de enero se recogieron 125,9 mm en una sola jornada (récord diario absoluto de toda la serie). "
            "Noviembre sumó otros 424,3 mm, mientras que julio fue el mes más seco con 56,9 mm."
        ),
        "wind_notes": (
            "Se contabilizaron 43 días con rachas de al menos 40 km/h y una velocidad media anual de 2,5 km/h. "
            "La racha máxima alcanzó 73,4 km/h el 4 de noviembre durante el paso de la borrasca de gran impacto Domingos."
        ),
        "episodes": [
            {"date": "2023-01-16", "type": "lluvia", "title": "Diluvio histórico con la borrasca Fien", "value": "125,9 mm", "description": "Récord absoluto de precipitación en 24 horas de la estación, dentro de un mes de enero que acumuló 509,8 mm."},
            {"date": "2023-02-11", "type": "frio", "title": "Mínima anual invernal", "value": "-1,7 °C", "description": "Descenso térmico nocturno tras la estabilización post-frontal de febrero."},
            {"date": "2023-08-23", "type": "calor", "title": "Ola de calor de agosto (>40 °C)", "value": "40,4 °C", "description": "Superación del umbral de 40 °C a las 13:30 h impulsada por viento sur."},
            {"date": "2023-10-18", "type": "calor", "title": "Noche tropical en pleno octubre", "value": "20,3 °C (mín.)", "description": "Mínima diaria más alta del año registrada en pleno otoño por advección del sur."},
            {"date": "2023-11-04", "type": "viento", "title": "Temporal por las borrascas Ciarán y Domingos", "value": "73,4 km/h", "description": "Racha máxima anual en un mes de noviembre que además acumuló 424,3 mm de lluvia."},
        ],
        "data_note": (
            "Incidencia técnica documentada: no existen registros entre el 22 de septiembre y el 12 de octubre de 2023 "
            "(340 días válidos sobre 365). En consecuencia, el acumulado anual real fue igual o superior a los 2140,4 mm medidos."
        ),
    },
    2024: {
        "character": "Extremadamente húmedo y de contrastes térmicos agudos",
        "headline": "Récord histórico de calor (42,1 °C), temporal Karlotta (97,2 km/h) y más de 2000 mm",
        "synoptic_summary": (
            "El año 2024 combinó una circulación atlántica muy persistente —que dejó 2047,9 mm en 233 días de lluvia "
            "apreciable (el 64,9 % de los días con registro)— con los dos extremos meteorológicos más violentos de toda la "
            "serie histórica de la estación: la temperatura máxima absoluta (42,1 °C) y la racha máxima absoluta (97,2 km/h)."
        ),
        "thermal_notes": (
            "La temperatura media anual se situó en 14,3 °C, con solo 3 días de helada (mínima de -3,1 °C el 20 de enero, "
            "récord frío de la serie). El 11 de agosto una súbita e intensa entrada de aire sahariano canalizada por viento "
            "sur disparó el termómetro hasta los 42,1 °C a las 14:30 h (bajo aviso rojo de AEMET en Cantabria), generando ese "
            "mismo día una amplitud térmica de 23,7 °C."
        ),
        "rain_notes": (
            "Rompiendo el esquema estacional clásico, septiembre fue el mes más lluvioso del año con 291,7 mm debido al paso "
            "ininterrumpido de frentes del oeste y noroeste, seguido de febrero (284,4 mm) y diciembre (267,5 mm). "
            "Mayo fue el mes más seco con 71,9 mm y el día más lluvioso fue el 2 de octubre con 57,2 mm."
        ),
        "wind_notes": (
            "El 8 de febrero de 2024, durante el paso de la profunda borrasca Karlotta, el anemómetro registró una racha de "
            "97,2 km/h a las 16:00 h, récord absoluto de viento en MeteoRiotuerto. Se sumaron 43 días con rachas ≥40 km/h."
        ),
        "episodes": [
            {"date": "2024-01-20", "type": "frio", "title": "Mínima absoluta histórica de la serie", "value": "-3,1 °C", "description": "Madrugada anticiclónica de fuerte irradiación nocturna en el fondo del valle."},
            {"date": "2024-02-08", "type": "viento", "title": "Borrasca Karlotta: racha máxima histórica", "value": "97,2 km/h", "description": "Temporal del sur asociado a la borrasca Karlotta que dejó la mayor racha de toda la serie."},
            {"date": "2024-08-11", "type": "calor", "title": "Techo térmico histórico en Riotuerto", "value": "42,1 °C", "description": "Episodio extremo de efecto Foehn con aviso rojo en Cantabria y 23,7 °C de amplitud térmica diaria."},
            {"date": "2024-09-30", "type": "lluvia", "title": "Septiembre inusualmente lluvioso", "value": "291,7 mm/mes", "description": "Mes más húmedo del año por circulación zonal constante al final del verano."},
            {"date": "2024-10-02", "type": "lluvia", "title": "Jornada de mayor precipitación de 2024", "value": "57,2 mm", "description": "Frente activo otoñal con lluvias persistentes."},
        ],
        "data_note": (
            "Serie anual con 359 días válidos sobre 366 (98,1 % de cobertura). El registro espurio de radiofrecuencia "
            "del 31 de mayo a las 04:30 en el archivo semihorario fue filtrado y corregido en la serie diaria oficial."
        ),
    },
    2025: {
        "character": "Muy húmedo y cálido",
        "headline": "Precipitación persistente (1706,9 mm), borrasca Herminia (86,4 km/h) y pico de 40,2 °C",
        "synoptic_summary": (
            "El año 2025 mantuvo una temperatura media anual de 14,7 °C y un acumulado pluviométrico de 1706,9 mm "
            "repartidos en 218 días de precipitación apreciable (prácticamente 6 de cada 10 días del año). La dinámica "
            "atmosférica alternó frentes atlánticos invernales y otoñales con suradas puntuales muy marcadas."
        ),
        "thermal_notes": (
            "El invierno dejó 10 jornadas de helada, con una mínima absoluta de -2,2 °C el 14 de enero por inversión térmica. "
            "En verano se contabilizaron 15 días con máximas iguales o superiores a 30 °C y 5 días de al menos 35 °C, "
            "alcanzando el máximo anual el 15 de agosto con 40,2 °C tras la noche más cálida del año (19,4 °C el 14 de agosto)."
        ),
        "rain_notes": (
            "El otoño mostró un fuerte contraste entre un octubre anticiclónico —que resultó ser el mes más seco del año "
            "con 77,2 mm— y un noviembre muy lluvioso que descargó 286,4 mm y concentró el día más lluvioso del año "
            "(67,8 mm el 24 de noviembre). El 10 de junio una tormenta vespertina alcanzó una intensidad punta de 145,2 mm/h."
        ),
        "wind_notes": (
            "Fue el año con mayor número de jornadas ventosas de la serie (48 días con rachas ≥40 km/h y velocidad media "
            "de 2,7 km/h). El 26 de enero la borrasca Herminia dejó una racha máxima de 86,4 km/h."
        ),
        "episodes": [
            {"date": "2025-01-14", "type": "frio", "title": "Helada invernal bajo bloqueo anticiclónico", "value": "-2,2 °C", "description": "Temperatura mínima anual durante una secuencia de inversiones térmicas en enero."},
            {"date": "2025-01-26", "type": "viento", "title": "Impacto de la borrasca Herminia", "value": "86,4 km/h", "description": "Racha máxima anual registrada a las 08:00 h durante el paso de la profunda borrasca Herminia."},
            {"date": "2025-06-10", "type": "lluvia", "title": "Tormenta convectiva de alta intensidad", "value": "145,2 mm/h", "description": "Mayor tasa instantánea de precipitación y 44,2 mm en una hora a las 20:30 h."},
            {"date": "2025-08-15", "type": "calor", "title": "Advección cálida y efecto Foehn de agosto", "value": "40,2 °C", "description": "Temperatura máxima anual precedida por una mínima de 19,4 °C la jornada anterior."},
            {"date": "2025-11-24", "type": "lluvia", "title": "Temporal lluvioso del noroeste en noviembre", "value": "67,8 mm", "description": "Máximo diario anual en un mes de noviembre que totalizó 286,4 mm."},
        ],
        "data_note": (
            "Cobertura prácticamente íntegra con 364 días válidos sobre 365 (99,7 %). A partir de agosto de 2025 el "
            "registro incorpora también el cálculo de déficit de presión de vapor (VPD)."
        ),
    },
    2026: {
        "character": "Provisional (año en curso: cálido y húmedo hasta octubre)",
        "headline": "Avance provisional hasta el 25 de octubre: verano cálido, 4 noches tropicales y 1504,3 mm",
        "synoptic_summary": (
            "AVISO DE PROVISIONALIDAD: Los datos de 2026 corresponden al periodo observado entre el 1 de enero y el "
            "25 de octubre de 2026 (298 días). Durante estos casi diez meses la temperatura media acumulada es de 15,8 °C "
            "(condicionada por no incluir todavía noviembre ni diciembre completos) y la precipitación suma 1504,3 mm."
        ),
        "thermal_notes": (
            "Hasta el 25 de octubre se han registrado 31 días con temperaturas de al menos 30 °C, 11 días de ≥35 °C "
            "y un pico temprano de 41,3 °C el 24 de junio. Asimismo, se han contabilizado 4 noches tropicales (mínima ≥20 °C) "
            "y solo 2 días de helada en invierno (-1,4 °C el 4 de enero)."
        ),
        "rain_notes": (
            "Se acumulan 1504,3 mm en 154 días de lluvia apreciable. Marzo ha sido hasta la fecha el mes más húmedo "
            "(302,0 mm), mientras que el 7 de octubre se recogieron 83,8 mm en un solo día."
        ),
        "wind_notes": (
            "La racha máxima provisional del año es de 73,4 km/h, registrada el 21 de enero, acumulando 30 jornadas "
            "con rachas iguales o superiores a 40 km/h."
        ),
        "episodes": [
            {"date": "2026-01-04", "type": "frio", "title": "Mínima invernal provisional", "value": "-1,4 °C", "description": "Registro más bajo en lo que va de año 2026."},
            {"date": "2026-01-21", "type": "viento", "title": "Temporal invernal de enero", "value": "73,4 km/h", "description": "Racha máxima registrada hasta octubre de 2026."},
            {"date": "2026-03-31", "type": "lluvia", "title": "Marzo muy lluvioso", "value": "302,0 mm/mes", "description": "Mes con mayor precipitación acumulada en el avance anual."},
            {"date": "2026-06-24", "type": "calor", "title": "Episodio extremo de calor en junio", "value": "41,3 °C", "description": "Segundo registro más alto de toda la serie histórica de la estación, alcanzado a finales de junio."},
            {"date": "2026-10-07", "type": "lluvia", "title": "Lluvia torrencial otoñal", "value": "83,8 mm", "description": "Segundo mayor registro diario de precipitación de toda la serie tras el 16 de enero de 2023."},
        ],
        "data_note": (
            "Año en curso (datos consolidados desde el 01/01/2026 hasta el 25/10/2026). No debe compararse directamente "
            "en términos absolutos anuales con los años cerrados (2022–2025) hasta finalizar diciembre."
        ),
    },
}


# -----------------------------------------------------------------------------
# Utilidades de carga, limpieza y normalización
# -----------------------------------------------------------------------------
def ensure_source_files(source_dir: Optional[Path], cache_dir: Path) -> Path:
    """
    Devuelve la ruta base donde se encuentran los archivos CSV por año.
    Si `source_dir` existe localmente y contiene las carpetas anuales, la usa sin
    modificar nada. En caso contrario, descarga los CSVs desde el repositorio
    público de GitHub hacia `cache_dir`.
    """
    if source_dir and source_dir.exists() and (source_dir / "2025" / "data").exists():
        return source_dir

    cache_dir.mkdir(parents=True, exist_ok=True)
    for year, files in EXPECTED_YEAR_FILES.items():
        for kind, rel_path in files.items():
            if not rel_path:
                continue
            dest = cache_dir / rel_path
            if not dest.exists() or dest.stat().st_size == 0:
                dest.parent.mkdir(parents=True, exist_ok=True)
                url = f"{RAW_GITHUB_BASE}/{rel_path}"
                print(f"[INFO] Descargando archivo fuente desde {url} -> {dest}")
                urllib.request.urlretrieve(url, dest)
    return cache_dir


def parse_ecowitt_csv(csv_path: Path) -> Tuple[pd.DataFrame, List[str]]:
    """
    Lee un archivo CSV de MeteoRiotuerto con cabecera de 2 líneas,
    normalizando tanto las variantes en inglés/español como los decimales con coma.
    """
    with open(csv_path, encoding="utf-8") as fp:
        line0 = fp.readline().rstrip("\r\n").split(",")
        line1 = fp.readline().rstrip("\r\n").split(",")

    cur_cat = ""
    raw_cols: List[str] = []
    for c0, c1 in zip(line0, line1):
        if c0.strip():
            cur_cat = c0.strip()
        raw_cols.append(f"{cur_cat}:{c1.strip()}")

    df_raw = pd.read_csv(
        csv_path,
        skiprows=2,
        header=None,
        na_values=["-", "--", "---", ""],
        dtype=str,
        encoding="utf-8",
    )
    df_raw.columns = raw_cols

    # Mapear a nombres canónicos internos independientemente del idioma de cabecera
    canonical_map: Dict[str, str] = {}
    for col in raw_cols:
        c_low = col.lower()
        if col.startswith("Time:"):
            canonical_map[col] = "timestamp_str"
        elif "interior:" in c_low:
            # Ignorar sensores interiores (solo presentes en 2024_diario.csv)
            continue
        elif "temperature(℃)" in c_low:
            canonical_map[col] = "temp_mean"
        elif "temperature low(℃)" in c_low:
            canonical_map[col] = "temp_min"
        elif "temperature high(℃)" in c_low:
            canonical_map[col] = "temp_max"
        elif "feels like(℃)" in c_low:
            canonical_map[col] = "feels_like"
        elif "dew point(℃)" in c_low:
            canonical_map[col] = "dew_point"
        elif "humidity(%)" in c_low:
            canonical_map[col] = "humidity_mean"
        elif "humidity low(%)" in c_low:
            canonical_map[col] = "humidity_min"
        elif "humidity high(%)" in c_low:
            canonical_map[col] = "humidity_max"
        elif "vpd(kpa)" in c_low:
            canonical_map[col] = "vpd"
        elif "solar(w/m²)" in c_low:
            canonical_map[col] = "solar"
        elif c_low.endswith(":uvi"):
            canonical_map[col] = "uvi"
        elif "rain rate" in c_low:
            canonical_map[col] = "rain_rate"
        elif "daily(mm)" in c_low:
            canonical_map[col] = "rain_daily"
        elif "event(mm)" in c_low:
            canonical_map[col] = "rain_event"
        elif "hourly(mm)" in c_low:
            canonical_map[col] = "rain_hourly"
        elif "weekly(mm)" in c_low:
            canonical_map[col] = "rain_weekly"
        elif "monthly(mm)" in c_low:
            canonical_map[col] = "rain_monthly"
        elif "yearly(mm)" in c_low:
            canonical_map[col] = "rain_yearly"
        elif c_low.endswith(":wind speed(km/h)"):
            canonical_map[col] = "wind_speed"
        elif "wind gust(km/h)" in c_low:
            canonical_map[col] = "wind_gust"
        elif c_low.endswith(":wind direction(º)"):
            canonical_map[col] = "wind_dir"
        elif "relative(hpa)" in c_low:
            canonical_map[col] = "pressure_rel"
        elif "relative low(hpa)" in c_low:
            canonical_map[col] = "pressure_rel_min"
        elif "relative high(hpa)" in c_low:
            canonical_map[col] = "pressure_rel_max"
        elif "absolute(hpa)" in c_low:
            canonical_map[col] = "pressure_abs"

    out = pd.DataFrame()
    out["timestamp_str"] = df_raw["Time:"].astype(str).str.strip()
    for orig_col, canon_col in canonical_map.items():
        if canon_col == "timestamp_str":
            continue
        s = df_raw[orig_col].astype(str).str.strip().str.replace(",", ".", regex=False)
        s = s.replace({"-": np.nan, "--": np.nan, "nan": np.nan, "None": np.nan, "": np.nan})
        out[canon_col] = pd.to_numeric(s, errors="coerce")

    out["dt"] = pd.to_datetime(out["timestamp_str"], errors="coerce")
    out["date"] = out["dt"].dt.strftime("%Y-%m-%d")
    return out, raw_cols


def load_and_clean_daily(base_dir: Path, year: int) -> Tuple[pd.DataFrame, List[str]]:
    """
    Carga y limpia la serie diaria oficial de un año.
    """
    rel = EXPECTED_YEAR_FILES[year]["daily"]
    csv_path = base_dir / rel
    df, raw_cols = parse_ecowitt_csv(csv_path)
    anomalies_logged: List[str] = []

    # Filtrar al año correspondiente y ordenar por fecha
    df = df[df["dt"].dt.year == year].copy()
    df = df.drop_duplicates(subset=["date"], keep="last").sort_values("date").reset_index(drop=True)

    # Control de calidad físico sobre radiación/UVI e humedad en la tabla diaria
    # Ejemplo verificado: el 2024-05-31 en 2024_diario.csv la Tmin fue corregida a 10,3 °C,
    # pero quedaron humidity_min=1.0 %, solar=1655.2 W/m² y uvi=15.0 procedentes del paquete RF corrupto de las 04:30.
    df["solar_raw"] = df["solar"]
    df["uvi_raw"] = df["uvi"]

    bad_solar = df["solar"] > SOLAR_CONSTANT_MAX_WM2
    if bad_solar.any():
        for _, r in df[bad_solar].iterrows():
            anomalies_logged.append(
                f"{r['date']}: Radiación diaria máxima bruta {r['solar']:.1f} W/m² supera la constante solar "
                f"({SOLAR_CONSTANT_MAX_WM2:.0f} W/m²); marcada como pico espurio/efecto borde de nube."
            )
        df.loc[bad_solar, "solar"] = np.nan

    bad_uvi = df["uvi"] > 12
    if bad_uvi.any():
        for _, r in df[bad_uvi].iterrows():
            anomalies_logged.append(
                f"{r['date']}: Índice UV máximo bruto {r['uvi']:.0f} fuera de escala física para 43°N; "
                f"excluido de récords validados."
            )
        df.loc[bad_uvi, "uvi"] = np.nan

    if year == 2024:
        mask_may31 = (df["date"] == "2024-05-31") & (df["humidity_min"] <= 5)
        if mask_may31.any():
            anomalies_logged.append(
                "2024-05-31: Humedad mínima de 1 % asociada al paquete RF corrupto de las 04:30; "
                "ajustada al mínimo real del resto de la jornada (88 %)."
            )
            df.loc[mask_may31, "humidity_min"] = 88.0

    return df, anomalies_logged


def load_and_clean_30min(base_dir: Path, year: int) -> Tuple[Optional[pd.DataFrame], Dict[str, Any]]:
    """
    Carga, filtra y depura la serie semihoraria (30 minutos) cuando existe para el año.
    Elimina bloques diarios incrustados (2023), duplicados por doble concatenación (2024),
    registros fuera del año natural y picos espurios de transmisión.
    """
    rel = EXPECTED_YEAR_FILES[year]["30min"]
    if not rel:
        return None, {
            "available": False,
            "raw_rows": 0,
            "clean_rows": 0,
            "duplicates_removed": 0,
            "out_of_year_removed": 0,
            "embedded_daily_removed": 0,
            "glitches_filtered": [],
        }

    csv_path = base_dir / rel
    df, _ = parse_ecowitt_csv(csv_path)
    raw_rows = len(df)

    # En 2023_30min.csv las filas 42..381 son un bloque de resúmenes diarios (un registro cada 24h a las 01:00:00)
    # incrustado antes de que comience la serie de 30 minutos el 2023-01-08 00:00:00.
    embedded_daily_removed = 0
    if year == 2023 and len(df) > 400:
        # Detectar el bloque entre el primer retroceso temporal (fila 42) y el segundo (fila 382)
        ts = df["dt"]
        jumps = df.index[ts.diff() < pd.Timedelta(0)].tolist()
        if len(jumps) >= 2 and jumps[0] == 42 and jumps[1] == 382:
            embedded_daily_removed = jumps[1] - jumps[0]
            df = pd.concat([df.iloc[: jumps[0]], df.iloc[jumps[1] :]], ignore_index=True)

    # Filtrar estrictamente al año natural
    in_year_mask = df["dt"].dt.year == year
    out_of_year_removed = int((~in_year_mask).sum())
    df = df[in_year_mask].copy()

    # Eliminar duplicados de timestamp conservando el registro con mayor número de variables válidas
    before_dedup = len(df)
    df["_valid_count"] = df.notna().sum(axis=1)
    df = (
        df.sort_values(["dt", "_valid_count"])
        .drop_duplicates(subset=["dt"], keep="last")
        .drop(columns=["_valid_count"])
        .sort_values("dt")
        .reset_index(drop=True)
    )
    duplicates_removed = before_dedup - len(df)

    # Filtrado de picos espurios de telemetría en 30 min
    glitches_filtered: List[str] = []

    # 1. Pico espurio verificado del 2024-05-31 04:30:00 (Tmin=-14.6 °C, Hum_min=1 %, Solar=1655.2 W/m², UVI=15)
    glitch_mask = (df["temp_min"] < -10.0) | (
        (df["solar"] > SOLAR_CONSTANT_MAX_WM2) & (df["dt"].dt.hour < 6)
    )
    if glitch_mask.any():
        for _, r in df[glitch_mask].iterrows():
            glitches_filtered.append(
                f"{r['timestamp_str']}: Registro de telemetría corrupto (Tmin={r['temp_min']} °C, "
                f"Solar={r['solar']} W/m² en horario nocturno) anulado."
            )
        cols_to_null = [
            c for c in df.columns
            if c not in ("timestamp_str", "dt", "date", "pressure_rel", "pressure_rel_min", "pressure_rel_max", "pressure_abs")
        ]
        df.loc[glitch_mask, cols_to_null] = np.nan

    # 2. Picos de UVI > 12 o Solar > 1361 W/m²
    df["solar_raw"] = df["solar"]
    df["uvi_raw"] = df["uvi"]
    df.loc[df["solar"] > SOLAR_CONSTANT_MAX_WM2, "solar"] = np.nan
    df.loc[df["uvi"] > 12, "uvi"] = np.nan

    meta_30 = {
        "available": True,
        "raw_rows": raw_rows,
        "clean_rows": len(df),
        "duplicates_removed": duplicates_removed,
        "out_of_year_removed": out_of_year_removed,
        "embedded_daily_removed": embedded_daily_removed,
        "glitches_filtered": glitches_filtered,
    }
    return df, meta_30


# -----------------------------------------------------------------------------
# Cálculos estadísticos y climatológicos
# -----------------------------------------------------------------------------
def deg_to_sector16(deg: float) -> Optional[str]:
    if pd.isna(deg):
        return None
    idx = int(((float(deg) + 11.25) % 360.0) // 22.5)
    return WIND_SECTORS_16[idx]


def speed_to_beaufort(speed_kmh: float) -> Optional[int]:
    if pd.isna(speed_kmh):
        return None
    for force, limit, _ in BEAUFORT_SCALE:
        if float(speed_kmh) <= limit:
            return force
    return 11


def compute_spells(df_daily: pd.DataFrame, threshold_mm: float = 0.2) -> Dict[str, Any]:
    """
    Calcula la racha más larga de días consecutivos con lluvia (≥ threshold_mm)
    y la racha más larga de días secos (< threshold_mm) dentro de secuencias continuas.
    """
    valid = df_daily.dropna(subset=["rain_daily"]).sort_values("date").copy()
    if valid.empty:
        return {"max_wet_days": 0, "max_dry_days": 0}

    dates = pd.to_datetime(valid["date"]).tolist()
    rains = valid["rain_daily"].tolist()

    best_wet = (0, None, None)
    best_dry = (0, None, None)

    cur_wet = 0
    wet_start = None
    cur_dry = 0
    dry_start = None
    prev_d = None

    for d, r in zip(dates, rains):
        is_consecutive = (prev_d is not None) and ((d - prev_d).days == 1)
        if not is_consecutive:
            cur_wet = 0
            cur_dry = 0

        if r >= threshold_mm:
            if cur_wet == 0:
                wet_start = d.strftime("%Y-%m-%d")
            cur_wet += 1
            cur_dry = 0
            if cur_wet > best_wet[0]:
                best_wet = (cur_wet, wet_start, d.strftime("%Y-%m-%d"))
        else:
            if cur_dry == 0:
                dry_start = d.strftime("%Y-%m-%d")
            cur_dry += 1
            cur_wet = 0
            if cur_dry > best_dry[0]:
                best_dry = (cur_dry, dry_start, d.strftime("%Y-%m-%d"))

        prev_d = d

    return {
        "max_wet_days": best_wet[0],
        "max_wet_start": best_wet[1],
        "max_wet_end": best_wet[2],
        "max_dry_days": best_dry[0],
        "max_dry_start": best_dry[1],
        "max_dry_end": best_dry[2],
    }


def safe_round(val: Any, decimals: int = 1) -> Optional[float]:
    if val is None or pd.isna(val):
        return None
    f = float(val)
    if math.isnan(f) or math.isinf(f):
        return None
    return round(f, decimals)


def find_exact_time_in_30min(
    df_30: Optional[pd.DataFrame], date_str: str, col: str, mode: str = "max"
) -> Optional[str]:
    if df_30 is None or df_30.empty or col not in df_30.columns:
        return None
    sub = df_30[df_30["date"] == date_str].dropna(subset=[col])
    if sub.empty:
        return None
    idx = sub[col].idxmax() if mode == "max" else sub[col].idxmin()
    dt_val = sub.loc[idx, "dt"]
    return dt_val.strftime("%H:%M") if pd.notna(dt_val) else None


def compute_wind_analysis(df_daily: pd.DataFrame, df_30: Optional[pd.DataFrame]) -> Dict[str, Any]:
    """
    Calcula la rosa de los vientos (16 sectores) y la distribución de Beaufort.
    Utiliza la serie de 30 min cuando está disponible (y la diaria como respaldo).
    """
    source_df = df_30 if (df_30 is not None and not df_30.empty) else df_daily
    source_type = "30min" if (df_30 is not None and not df_30.empty) else "daily"

    valid_dir = source_df.dropna(subset=["wind_dir"]).copy()
    valid_dir["sector"] = valid_dir["wind_dir"].apply(deg_to_sector16)
    total_obs = len(valid_dir)

    rose_16: List[Dict[str, Any]] = []
    for sec in WIND_SECTORS_16:
        sub = valid_dir[valid_dir["sector"] == sec]
        cnt = len(sub)
        freq_pct = round((cnt / total_obs) * 100.0, 2) if total_obs > 0 else 0.0
        mean_spd = safe_round(sub["wind_speed"].mean(), 1) if cnt > 0 else 0.0
        max_gst = safe_round(sub["wind_gust"].max(), 1) if cnt > 0 else 0.0
        rose_16.append({
            "sector": sec,
            "count": int(cnt),
            "frequency_pct": freq_pct,
            "mean_speed_kmh": mean_spd or 0.0,
            "max_gust_kmh": max_gst or 0.0,
        })

    predominant = max(rose_16, key=lambda x: x["count"])["sector"] if total_obs > 0 else "N"

    # Escala de Beaufort sobre la velocidad media diaria (consistente con sync_meteoriotuerto.py)
    valid_bft = df_daily.dropna(subset=["wind_speed"]).copy()
    valid_bft["bft"] = valid_bft["wind_speed"].apply(speed_to_beaufort)
    total_days_bft = len(valid_bft)
    beaufort_dist: List[Dict[str, Any]] = []
    for force, limit, label in BEAUFORT_SCALE:
        cnt = int((valid_bft["bft"] == force).sum())
        if cnt > 0 or force <= 5:
            beaufort_dist.append({
                "force": force,
                "label": label,
                "days": cnt,
                "pct": round((cnt / total_days_bft) * 100.0, 1) if total_days_bft > 0 else 0.0,
            })

    return {
        "source_resolution": source_type,
        "total_direction_observations": int(total_obs),
        "predominant_sector": predominant,
        "rose_16": rose_16,
        "beaufort_daily": beaufort_dist,
    }


def compute_foehn_analysis(
    df_daily: pd.DataFrame, df_30: Optional[pd.DataFrame], year: int
) -> Dict[str, Any]:
    """
    EVO-005: Identificación algorítmica de patrones instrumentales compatibles con episodios de
    «surada» / efecto Foehn en Barrio de Arriba (Riotuerto).
    Utiliza el umbral direccional empírico 120°–245° (ampliando el cuadrante sur meteorológico
    estándar 135°–225° para cubrir la canalización local del flujo por el relieve del valle
    observada en la veleta de la estación):
      - Condición direccional: rumbo medio diario entre 120° y 245° (SE–S–SO–OSO) o al menos
        4 intervalos semihorarios (≥ 2 h) en dicho sector con humedad relativa mínima ≤ 45 %.
      - Ausencia de precipitación frontal relevante: lluvia diaria < 5,0 mm.
      - Modalidad 1 (Perfil eólico): racha máxima ≥ 35,0 km/h y humedad relativa mínima ≤ 45 %.
      - Modalidad 2 (Perfil de compresión térmica): humedad relativa mínima ≤ 38 % con
        temperatura máxima ≥ 28,0 °C o gran amplitud térmica (≥ 16,0 °C con racha ≥ 22,0 km/h).
    """
    df_d = df_daily.copy()
    df_d["month"] = df_d["dt"].dt.month
    df_d["amp"] = df_d["temp_max"] - df_d["temp_min"]

    south_30_dates = set()
    intraday_jumps_by_date: Dict[str, Dict[str, Any]] = {}

    if df_30 is not None and not df_30.empty:
        sub_s = df_30[
            (df_30["wind_dir"] >= 120.0)
            & (df_30["wind_dir"] <= 245.0)
            & (df_30["humidity_min"] <= 45.0)
        ]
        cnts = sub_s.groupby("date").size()
        south_30_dates = set(cnts[cnts >= 4].index)

        # Calcular saltos térmicos intradiarios en ventanas de 3 horas (6 intervalos de 30 min)
        df_30_sorted = df_30.sort_values("dt").copy()
        df_30_sorted["jump_3h_c"] = df_30_sorted["temp_mean"].diff(6)
        df_30_sorted["hum_drop_3h_pct"] = df_30_sorted["humidity_mean"].diff(6)

        for d_str, grp in df_30_sorted.groupby("date"):
            valid_j = grp.dropna(subset=["jump_3h_c"])
            if not valid_j.empty:
                idx_max_j = valid_j["jump_3h_c"].idxmax()
                intraday_jumps_by_date[str(d_str)] = {
                    "jump_3h_c": safe_round(valid_j.loc[idx_max_j, "jump_3h_c"], 1),
                    "hum_drop_3h_pct": safe_round(valid_j.loc[idx_max_j, "hum_drop_3h_pct"], 1),
                    "peak_time": valid_j.loc[idx_max_j, "dt"].strftime("%H:%M") if pd.notna(valid_j.loc[idx_max_j, "dt"]) else None,
                }

    cond_dir = ((df_d["wind_dir"] >= 120.0) & (df_d["wind_dir"] <= 245.0)) | (
        df_d["date"].isin(south_30_dates)
    )
    cond_rain = df_d["rain_daily"].fillna(0.0) < 5.0

    cond_wind_foehn = cond_dir & cond_rain & (df_d["humidity_min"] <= 45.0) & (df_d["wind_gust"] >= 35.0)
    cond_therm_foehn = (
        cond_dir
        & cond_rain
        & (df_d["humidity_min"] <= 38.0)
        & ((df_d["temp_max"] >= 28.0) | ((df_d["amp"] >= 16.0) & (df_d["wind_gust"] >= 22.0)))
    )

    df_d["is_wind_foehn"] = cond_wind_foehn
    df_d["is_therm_foehn"] = cond_therm_foehn
    df_d["is_foehn"] = cond_wind_foehn | cond_therm_foehn

    foehn_df = df_d[df_d["is_foehn"]].copy()
    total_foehn = int(len(foehn_df))
    wind_foehn_cnt = int(cond_wind_foehn.sum())
    therm_foehn_cnt = int(cond_therm_foehn.sum())

    monthly_counts: List[int] = []
    for m in range(1, 13):
        monthly_counts.append(int(df_d[df_d["month"] == m]["is_foehn"].sum()))

    # Extremos dentro de los días de surada
    if not foehn_df.empty:
        i_fg = foehn_df["wind_gust"].idxmax()
        max_fg_val = safe_round(foehn_df.loc[i_fg, "wind_gust"], 1)
        max_fg_date = str(foehn_df.loc[i_fg, "date"])

        i_ft = foehn_df["temp_max"].idxmax()
        max_ft_val = safe_round(foehn_df.loc[i_ft, "temp_max"], 1)
        max_ft_date = str(foehn_df.loc[i_ft, "date"])

        i_fh = foehn_df["humidity_min"].idxmin()
        min_fh_val = safe_round(foehn_df.loc[i_fh, "humidity_min"], 0)
        min_fh_date = str(foehn_df.loc[i_fh, "date"])
    else:
        max_fg_val, max_fg_date = None, None
        max_ft_val, max_ft_date = None, None
        min_fh_val, min_fh_date = None, None

    # Selección de los 8 episodios de surada más intensos del año
    episodes_list: List[Dict[str, Any]] = []
    if not foehn_df.empty:
        # Puntuación compuesta para priorizar tanto grandes vendavales del sur como picos térmicos Foehn
        foehn_df["foehn_score"] = (
            foehn_df["wind_gust"].fillna(0.0) * 0.9
            + foehn_df["temp_max"].fillna(0.0) * 1.4
            + (50.0 - foehn_df["humidity_min"].fillna(50.0)).clip(lower=0.0) * 0.8
        )
        top_f = foehn_df.sort_values("foehn_score", ascending=False).head(8)
        for _, r in top_f.iterrows():
            d_str = str(r["date"])
            if r["is_wind_foehn"] and r["is_therm_foehn"]:
                subtype = "Surada mixta (eólica y térmica)"
            elif r["is_wind_foehn"]:
                subtype = "Surada eólica (vendaval del sur)"
            else:
                subtype = "Compresión adiabática cálida"

            j_info = intraday_jumps_by_date.get(d_str, {})
            episodes_list.append({
                "date": d_str,
                "subtype": subtype,
                "temp_max": safe_round(r["temp_max"], 1),
                "temp_min": safe_round(r["temp_min"], 1),
                "temp_amp": safe_round(r["amp"], 1),
                "humidity_min": safe_round(r["humidity_min"], 0),
                "wind_gust": safe_round(r["wind_gust"], 1),
                "wind_dir": safe_round(r["wind_dir"], 0),
                "sector": deg_to_sector16(r["wind_dir"]) or "S",
                "jump_3h_c": j_info.get("jump_3h_c"),
                "hum_drop_3h_pct": j_info.get("hum_drop_3h_pct"),
            })

    foehn_dates_set = set(foehn_df["date"].astype(str).tolist())

    return {
        "total_foehn_days": total_foehn,
        "wind_foehn_days": wind_foehn_cnt,
        "thermal_foehn_days": therm_foehn_cnt,
        "monthly_counts": monthly_counts,
        "max_gust_kmh": max_fg_val,
        "max_gust_date": max_fg_date,
        "max_temp_c": max_ft_val,
        "max_temp_date": max_ft_date,
        "min_humidity_pct": min_fh_val,
        "min_humidity_date": min_fh_date,
        "top_episodes": episodes_list,
        "foehn_dates": sorted(list(foehn_dates_set)),
        "criteria_summary": (
            "El algoritmo identifica patrones instrumentales en superficie compatibles con episodios de «surada» y efecto Foehn "
            "(sin sustituir un diagnóstico sinóptico tridimensional): rumbo entre 120° y 245° —umbral empírico adoptado "
            "para cubrir la canalización local del viento de componente sur observada en la veleta de la estación, ampliando "
            "el cuadrante sur meteorológico estándar (135°–225°)— en el promedio diario o durante ≥2 h en la serie de 30 min, "
            "precipitación < 5 mm y bien racha ≥ 35 km/h con HR mín. ≤ 45 % (patrón eólico) o bien HR mín. ≤ 38 % "
            "con Tmáx ≥ 28 °C o amplitud ≥ 16 °C (patrón de compresión adiabática cálida)."
        ),
    }


def compute_year_almanac(
    year: int,
    df_daily: pd.DataFrame,
    df_30: Optional[pd.DataFrame],
    anomalies_daily: List[str],
    meta_30: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Construye el objeto completo del almanaque anual para el año indicado.
    """
    is_leap = calendar.isleap(year)
    calendar_days = 366 if is_leap else 365
    is_provisional = year in STATION_META["hardware"]["provisional_years"]

    df_d = df_daily.copy()
    df_d["month"] = df_d["dt"].dt.month
    df_d["amp"] = df_d["temp_max"] - df_d["temp_min"]

    valid_temp_days = int(df_d["temp_mean"].notna().sum())
    observed_span_days = len(df_d) if is_provisional else calendar_days
    coverage_pct = round((valid_temp_days / observed_span_days) * 100.0, 1)

    # Extremos térmicos
    idx_tmax = df_d["temp_max"].idxmax()
    tmax_abs = safe_round(df_d.loc[idx_tmax, "temp_max"], 1)
    tmax_date = str(df_d.loc[idx_tmax, "date"])
    tmax_time = find_exact_time_in_30min(df_30, tmax_date, "temp_max", "max")

    idx_tmin = df_d["temp_min"].idxmin()
    tmin_abs = safe_round(df_d.loc[idx_tmin, "temp_min"], 1)
    tmin_date = str(df_d.loc[idx_tmin, "date"])
    tmin_time = find_exact_time_in_30min(df_30, tmin_date, "temp_min", "min")

    idx_coldest_day = df_d["temp_max"].idxmin()
    tmax_lowest = safe_round(df_d.loc[idx_coldest_day, "temp_max"], 1)
    tmax_lowest_date = str(df_d.loc[idx_coldest_day, "date"])

    idx_warmest_night = df_d["temp_min"].idxmax()
    tmin_highest = safe_round(df_d.loc[idx_warmest_night, "temp_min"], 1)
    tmin_highest_date = str(df_d.loc[idx_warmest_night, "date"])

    idx_amp = df_d["amp"].idxmax()
    amp_max = safe_round(df_d.loc[idx_amp, "amp"], 1)
    amp_max_date = str(df_d.loc[idx_amp, "date"])

    # Conteos de umbrales térmicos
    frost_days = int((df_d["temp_min"] <= 0.0).sum())
    warm_days_25 = int((df_d["temp_max"] >= 25.0).sum())
    hot_days_30 = int((df_d["temp_max"] >= 30.0).sum())
    intense_heat_35 = int((df_d["temp_max"] >= 35.0).sum())
    extreme_heat_40 = int((df_d["temp_max"] >= 40.0).sum())
    tropical_nights_20 = int((df_d["temp_min"] >= 20.0).sum())
    torrid_nights_25 = int((df_d["temp_min"] >= 25.0).sum())

    # EVO-007: Percentiles térmicos y distribución por bandas de confort
    percentile_keys = [("P05", 5), ("P10", 10), ("P25", 25), ("P50", 50), ("P75", 75), ("P90", 90), ("P95", 95)]

    def calc_percentiles(col: str) -> Dict[str, Optional[float]]:
        vals = df_d[col].dropna()
        if len(vals) == 0:
            return {k: None for k, _ in percentile_keys}
        return {k: safe_round(float(np.percentile(vals, q)), 1) for k, q in percentile_keys}

    thermal_percentiles = {
        "temp_mean": calc_percentiles("temp_mean"),
        "temp_max": calc_percentiles("temp_max"),
        "temp_min": calc_percentiles("temp_min"),
    }

    tmax_series = df_d["temp_max"].dropna()
    total_valid_tmax = len(tmax_series)
    bands_defs = [
        ("cold_severe", "Frío riguroso", "< 8 °C", -999.0, 8.0, "#0284c7", "❄️"),
        ("cool_fresh", "Fresco / húmedo", "8–15 °C", 8.0, 15.0, "#0d9488", "🧥"),
        ("comfort_mild", "Templado / confort", "15–20 °C", 15.0, 20.0, "#10b981", "🍃"),
        ("pleasant_warm", "Agradable estival", "20–25 °C", 20.0, 25.0, "#f59e0b", "☀️"),
        ("warm_hot", "Cálido", "25–30 °C", 25.0, 30.0, "#ea580c", "🌡️"),
        ("heat_intense", "Calor intenso / canícula", "≥ 30 °C", 30.0, 999.0, "#b91c1c", "🔥"),
    ]

    thermal_comfort_bands = []
    for key, name, range_label, low, high, color, icon in bands_defs:
        if high == 999.0:
            count = int((tmax_series >= low).sum())
        elif low == -999.0:
            count = int((tmax_series < high).sum())
        else:
            count = int(((tmax_series >= low) & (tmax_series < high)).sum())
        pct = round((count / total_valid_tmax * 100.0), 1) if total_valid_tmax > 0 else 0.0
        thermal_comfort_bands.append({
            "key": key,
            "name": name,
            "range": range_label,
            "low": low if low != -999.0 else None,
            "high": high if high != 999.0 else None,
            "days": count,
            "pct": pct,
            "color": color,
            "icon": icon,
        })

    # Precipitaciones
    rain_total = safe_round(df_d["rain_daily"].sum(), 1) or 0.0
    rain_days_02 = int((df_d["rain_daily"] >= 0.2).sum())
    rain_days_1 = int((df_d["rain_daily"] >= 1.0).sum())
    rain_days_10 = int((df_d["rain_daily"] >= 10.0).sum())
    rain_days_30 = int((df_d["rain_daily"] >= 30.0).sum())
    rain_pct_days = round((rain_days_02 / valid_temp_days) * 100.0, 1) if valid_temp_days > 0 else 0.0

    idx_rain_max = df_d["rain_daily"].idxmax()
    rain_max_day = safe_round(df_d.loc[idx_rain_max, "rain_daily"], 1)
    rain_max_date = str(df_d.loc[idx_rain_max, "date"])

    # Intensidad máxima de lluvia y lluvia en 1 hora
    if df_30 is not None and not df_30.empty and df_30["rain_rate"].notna().any():
        idx_rr = df_30["rain_rate"].idxmax()
        rain_rate_max = safe_round(df_30.loc[idx_rr, "rain_rate"], 1)
        rain_rate_date = str(df_30.loc[idx_rr, "date"])
        rain_rate_time = df_30.loc[idx_rr, "dt"].strftime("%H:%M")
    else:
        idx_rr = df_d["rain_rate"].idxmax()
        rain_rate_max = safe_round(df_d.loc[idx_rr, "rain_rate"], 1)
        rain_rate_date = str(df_d.loc[idx_rr, "date"])
        rain_rate_time = None

    if df_30 is not None and not df_30.empty and df_30["rain_hourly"].notna().any():
        idx_rh = df_30["rain_hourly"].idxmax()
        rain_hourly_max = safe_round(df_30.loc[idx_rh, "rain_hourly"], 1)
        rain_hourly_date = str(df_30.loc[idx_rh, "date"])
        rain_hourly_time = df_30.loc[idx_rh, "dt"].strftime("%H:%M")
    else:
        idx_rh = df_d["rain_hourly"].idxmax()
        rain_hourly_max = safe_round(df_d.loc[idx_rh, "rain_hourly"], 1)
        rain_hourly_date = str(df_d.loc[idx_rh, "date"])
        rain_hourly_time = None

    monthly_rain = df_d.groupby("month")["rain_daily"].sum()
    wettest_m_idx = int(monthly_rain.idxmax())
    driest_m_idx = int(monthly_rain.idxmin())
    spells = compute_spells(df_d, 0.2)

    # Viento
    wind_mean = safe_round(df_d["wind_speed"].mean(), 1)
    idx_gust = df_d["wind_gust"].idxmax()
    gust_max = safe_round(df_d.loc[idx_gust, "wind_gust"], 1)
    gust_date = str(df_d.loc[idx_gust, "date"])
    gust_time = find_exact_time_in_30min(df_30, gust_date, "wind_gust", "max")
    wind_days_40 = int((df_d["wind_gust"] >= 40.0).sum())
    wind_days_60 = int((df_d["wind_gust"] >= 60.0).sum())
    wind_analysis = compute_wind_analysis(df_d, df_30)
    foehn_analysis = compute_foehn_analysis(df_d, df_30, year)
    foehn_dates_set = set(foehn_analysis["foehn_dates"])
    df_d["foehn_flag"] = df_d["date"].astype(str).isin(foehn_dates_set).astype(int)

    # Humedad, presión y radiación
    hum_mean = safe_round(df_d["humidity_mean"].mean(), 1)
    idx_hum_min = df_d["humidity_min"].idxmin()
    hum_min_abs = safe_round(df_d.loc[idx_hum_min, "humidity_min"], 0)
    hum_min_date = str(df_d.loc[idx_hum_min, "date"])

    pres_mean = safe_round(df_d["pressure_rel"].mean(), 1)
    idx_pmax = df_d["pressure_rel_max"].idxmax()
    pres_max_abs = safe_round(df_d.loc[idx_pmax, "pressure_rel_max"], 1)
    pres_max_date = str(df_d.loc[idx_pmax, "date"])
    idx_pmin = df_d["pressure_rel_min"].idxmin()
    pres_min_abs = safe_round(df_d.loc[idx_pmin, "pressure_rel_min"], 1)
    pres_min_date = str(df_d.loc[idx_pmin, "date"])

    # Radiación solar e insolación estimada
    if df_d["solar"].notna().any():
        idx_sol = df_d["solar"].idxmax()
        solar_max_qc = safe_round(df_d.loc[idx_sol, "solar"], 1)
        solar_max_qc_date = str(df_d.loc[idx_sol, "date"])
    else:
        solar_max_qc = None
        solar_max_qc_date = None

    idx_sol_raw = df_d["solar_raw"].idxmax()
    solar_max_raw = safe_round(df_d.loc[idx_sol_raw, "solar_raw"], 1)
    solar_max_raw_date = str(df_d.loc[idx_sol_raw, "date"])

    uvi_max_qc = int(df_d["uvi"].max()) if df_d["uvi"].notna().any() else None
    uvi_max_raw = int(df_d["uvi_raw"].max()) if df_d["uvi_raw"].notna().any() else None

    if df_30 is not None and not df_30.empty and "solar" in df_30.columns:
        sunshine_hours_est = round(float((df_30["solar"] >= WMO_SUNSHINE_THRESHOLD_WM2).sum()) * 0.5, 1)
    else:
        sunshine_hours_est = None

    # Desglose mensual (1 a 12)
    monthly_list: List[Dict[str, Any]] = []
    for m in range(1, 13):
        sub = df_d[df_d["month"] == m]
        m_cal_days = calendar.monthrange(year, m)[1]
        if sub.empty or sub["temp_mean"].notna().sum() == 0:
            monthly_list.append({
                "month": m,
                "name": MONTH_NAMES_ES[m - 1],
                "short": MONTH_SHORT_ES[m - 1],
                "valid_days": 0,
                "calendar_days": m_cal_days,
                "temp_mean": None,
                "temp_max_mean": None,
                "temp_min_mean": None,
                "temp_max_abs": None,
                "temp_max_date": None,
                "temp_min_abs": None,
                "temp_min_date": None,
                "rain_total": None,
                "rain_days_02": None,
                "rain_days_10": None,
                "rain_max_day": None,
                "rain_max_date": None,
                "wind_speed_mean": None,
                "wind_gust_max": None,
                "wind_gust_date": None,
                "humidity_mean": None,
                "pressure_mean": None,
                "solar_max": None,
                "frost_days": None,
                "hot_days_30": None,
                "tropical_nights": None,
                "foehn_days": None,
                "hdd_15_5": None,
                "cdd_21_0": None,
                "gdd_10_0": None,
            })
            continue

        m_tmax_idx = sub["temp_max"].idxmax()
        m_tmin_idx = sub["temp_min"].idxmin()
        m_rmax_idx = sub["rain_daily"].idxmax()
        m_gmax_idx = sub["wind_gust"].idxmax()

        monthly_list.append({
            "month": m,
            "name": MONTH_NAMES_ES[m - 1],
            "short": MONTH_SHORT_ES[m - 1],
            "valid_days": int(sub["temp_mean"].notna().sum()),
            "calendar_days": m_cal_days,
            "temp_mean": safe_round(sub["temp_mean"].mean(), 1),
            "temp_max_mean": safe_round(sub["temp_max"].mean(), 1),
            "temp_min_mean": safe_round(sub["temp_min"].mean(), 1),
            "temp_max_abs": safe_round(sub.loc[m_tmax_idx, "temp_max"], 1),
            "temp_max_date": str(sub.loc[m_tmax_idx, "date"]),
            "temp_min_abs": safe_round(sub.loc[m_tmin_idx, "temp_min"], 1),
            "temp_min_date": str(sub.loc[m_tmin_idx, "date"]),
            "rain_total": safe_round(sub["rain_daily"].sum(), 1),
            "rain_days_02": int((sub["rain_daily"] >= 0.2).sum()),
            "rain_days_10": int((sub["rain_daily"] >= 10.0).sum()),
            "rain_max_day": safe_round(sub.loc[m_rmax_idx, "rain_daily"], 1),
            "rain_max_date": str(sub.loc[m_rmax_idx, "date"]),
            "wind_speed_mean": safe_round(sub["wind_speed"].mean(), 1),
            "wind_gust_max": safe_round(sub.loc[m_gmax_idx, "wind_gust"], 1),
            "wind_gust_date": str(sub.loc[m_gmax_idx, "date"]),
            "humidity_mean": safe_round(sub["humidity_mean"].mean(), 1),
            "pressure_mean": safe_round(sub["pressure_rel"].mean(), 1),
            "solar_max": safe_round(sub["solar"].max(), 1) if sub["solar"].notna().any() else None,
            "frost_days": int((sub["temp_min"] <= 0.0).sum()),
            "hot_days_30": int((sub["temp_max"] >= 30.0).sum()),
            "tropical_nights": int((sub["temp_min"] >= 20.0).sum()),
            "foehn_days": int(sub["foehn_flag"].sum()),
            "hdd_15_5": safe_round((15.5 - sub["temp_mean"]).clip(lower=0.0).sum(), 1) if sub["temp_mean"].notna().any() else None,
            "cdd_21_0": safe_round((sub["temp_mean"] - 21.0).clip(lower=0.0).sum(), 1) if sub["temp_mean"].notna().any() else None,
            "gdd_10_0": safe_round((sub["temp_mean"] - 10.0).clip(lower=0.0).sum(), 1) if sub["temp_mean"].notna().any() else None,
        })

    # Serie diaria columnar completa del año (rellenando todos los días del calendario hasta el último día observado)
    start_dt = pd.Timestamp(f"{year}-01-01")
    end_dt = pd.to_datetime(df_d["date"].max()) if is_provisional else pd.Timestamp(f"{year}-12-31")
    full_dates = pd.date_range(start_dt, end_dt, freq="D").strftime("%Y-%m-%d").tolist()
    df_indexed = df_d.set_index("date").reindex(full_dates)

    def col_to_list(col_name: str, dec: int = 1) -> List[Optional[float]]:
        if col_name not in df_indexed.columns:
            return [None] * len(full_dates)
        return [safe_round(v, dec) for v in df_indexed[col_name].tolist()]

    daily_series = {
        "dates": full_dates,
        "temp_mean": col_to_list("temp_mean", 1),
        "temp_max": col_to_list("temp_max", 1),
        "temp_min": col_to_list("temp_min", 1),
        "temp_amp": col_to_list("amp", 1),
        "feels_like": col_to_list("feels_like", 1),
        "dew_point": col_to_list("dew_point", 1),
        "humidity_mean": col_to_list("humidity_mean", 1),
        "humidity_min": col_to_list("humidity_min", 0),
        "humidity_max": col_to_list("humidity_max", 0),
        "rain_daily": col_to_list("rain_daily", 1),
        "rain_rate": col_to_list("rain_rate", 1),
        "wind_speed": col_to_list("wind_speed", 1),
        "wind_gust": col_to_list("wind_gust", 1),
        "wind_dir": col_to_list("wind_dir", 0),
        "pressure_rel": col_to_list("pressure_rel", 1),
        "pressure_rel_min": col_to_list("pressure_rel_min", 1),
        "pressure_rel_max": col_to_list("pressure_rel_max", 1),
        "solar_max": col_to_list("solar", 1),
        "uvi_max": col_to_list("uvi", 0),
        "foehn_flag": [int(v) if v is not None and not pd.isna(v) else 0 for v in df_indexed["foehn_flag"].tolist()],
    }

    editorial = EDITORIAL_CHRONICLES.get(year, {})

    return {
        "year": year,
        "is_provisional": is_provisional,
        "last_observed_date": str(df_d["date"].max()),
        "coverage": {
            "calendar_days": calendar_days,
            "observed_span_days": observed_span_days,
            "valid_days": valid_temp_days,
            "missing_days": observed_span_days - valid_temp_days,
            "coverage_pct": coverage_pct,
            "has_30min_series": bool(meta_30["available"]),
            "clean_30min_records": int(meta_30["clean_rows"]),
            "quality_audit": {
                "daily_anomalies_corrected": anomalies_daily,
                "intraday_meta": meta_30,
            },
        },
        "editorial": editorial,
        "stats": {
            "temperature": {
                "mean": safe_round(df_d["temp_mean"].mean(), 1),
                "max_mean": safe_round(df_d["temp_max"].mean(), 1),
                "min_mean": safe_round(df_d["temp_min"].mean(), 1),
                "max_abs": tmax_abs,
                "max_abs_date": tmax_date,
                "max_abs_time": tmax_time,
                "min_abs": tmin_abs,
                "min_abs_date": tmin_date,
                "min_abs_time": tmin_time,
                "lowest_max": tmax_lowest,
                "lowest_max_date": tmax_lowest_date,
                "highest_min": tmin_highest,
                "highest_min_date": tmin_highest_date,
                "max_daily_amplitude": amp_max,
                "max_daily_amplitude_date": amp_max_date,
                "mean_daily_amplitude": safe_round(df_d["amp"].mean(), 1),
                "frost_days_le_0": frost_days,
                "warm_days_ge_25": warm_days_25,
                "hot_days_ge_30": hot_days_30,
                "intense_heat_days_ge_35": intense_heat_35,
                "extreme_heat_days_ge_40": extreme_heat_40,
                "tropical_nights_ge_20": tropical_nights_20,
                "torrid_nights_ge_25": torrid_nights_25,
            },
            "precipitation": {
                "total_mm": rain_total,
                "days_ge_02mm": rain_days_02,
                "days_ge_1mm": rain_days_1,
                "days_ge_10mm": rain_days_10,
                "days_ge_30mm": rain_days_30,
                "rain_days_pct": rain_pct_days,
                "max_daily_mm": rain_max_day,
                "max_daily_date": rain_max_date,
                "max_rain_rate_mm_h": rain_rate_max,
                "max_rain_rate_date": rain_rate_date,
                "max_rain_rate_time": rain_rate_time,
                "max_hourly_mm": rain_hourly_max,
                "max_hourly_date": rain_hourly_date,
                "max_hourly_time": rain_hourly_time,
                "wettest_month": MONTH_NAMES_ES[wettest_m_idx - 1],
                "wettest_month_mm": safe_round(monthly_rain.loc[wettest_m_idx], 1),
                "driest_month": MONTH_NAMES_ES[driest_m_idx - 1],
                "driest_month_mm": safe_round(monthly_rain.loc[driest_m_idx], 1),
                "spells": spells,
            },
            "wind": {
                "mean_speed_kmh": wind_mean,
                "max_gust_kmh": gust_max,
                "max_gust_date": gust_date,
                "max_gust_time": gust_time,
                "days_gust_ge_40": wind_days_40,
                "days_gust_ge_60": wind_days_60,
                "predominant_sector": wind_analysis["predominant_sector"],
                "foehn_days": foehn_analysis["total_foehn_days"],
                "wind_foehn_days": foehn_analysis["wind_foehn_days"],
                "thermal_foehn_days": foehn_analysis["thermal_foehn_days"],
            },
            "atmosphere_and_solar": {
                "humidity_mean_pct": hum_mean,
                "humidity_min_pct": hum_min_abs,
                "humidity_min_date": hum_min_date,
                "pressure_mean_hpa": pres_mean,
                "pressure_max_hpa": pres_max_abs,
                "pressure_max_date": pres_max_date,
                "pressure_min_hpa": pres_min_abs,
                "pressure_min_date": pres_min_date,
                "solar_max_wm2": solar_max_qc,
                "solar_max_date": solar_max_qc_date,
                "solar_max_raw_wm2": solar_max_raw,
                "solar_max_raw_date": solar_max_raw_date,
                "uvi_max": uvi_max_qc,
                "uvi_max_raw": uvi_max_raw,
                "estimated_sunshine_hours": sunshine_hours_est,
            },
            "degree_days": {
                "hdd_15_5": safe_round((15.5 - df_d["temp_mean"]).clip(lower=0.0).sum(), 1),
                "cdd_21_0": safe_round((df_d["temp_mean"] - 21.0).clip(lower=0.0).sum(), 1),
                "gdd_10_0": safe_round((df_d["temp_mean"] - 10.0).clip(lower=0.0).sum(), 1),
                "description": {
                    "hdd": "Grados día de calefacción (base 15,5 °C): cuantifica la demanda de energía para calentar edificios.",
                    "cdd": "Grados día de refrigeración (base 21,0 °C): cuantifica la necesidad de refrigeración por calor.",
                    "gdd": "Grados día de desarrollo agrícola (base 10,0 °C): mide la energía térmica acumulada para crecimiento vegetal.",
                },
            },
            "thermal_percentiles": thermal_percentiles,
            "thermal_comfort_bands": thermal_comfort_bands,
        },
        "wind_analysis": wind_analysis,
        "foehn_analysis": foehn_analysis,
        "monthly": monthly_list,
        "daily_series": daily_series,
    }


def build_records_and_comparisons(
    almanacs: Dict[int, Dict[str, Any]],
    all_daily_df: pd.DataFrame,
    all_30min_dfs: Dict[int, Optional[pd.DataFrame]],
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """
    Genera `records.json` (efemérides absolutas, rankings Top 10, récords por mes y año)
    y `comparisons.json` (comparativas interanuales, anomalías respecto a 2022–2025 y estacionalidad).
    """
    df_all = all_daily_df.copy()
    df_all["year"] = df_all["dt"].dt.year
    df_all["month"] = df_all["dt"].dt.month
    df_all["amp"] = df_all["temp_max"] - df_all["temp_min"]

    def top_n_days(col: str, n: int = 10, ascending: bool = False) -> List[Dict[str, Any]]:
        sub = df_all.dropna(subset=[col]).sort_values(col, ascending=ascending).head(n)
        res = []
        for rank, (_, r) in enumerate(sub.iterrows(), 1):
            y = int(r["year"])
            d_str = str(r["date"])
            res.append({
                "rank": rank,
                "date": d_str,
                "year": y,
                "value": safe_round(r[col], 1),
                "temp_max": safe_round(r["temp_max"], 1),
                "temp_min": safe_round(r["temp_min"], 1),
                "temp_mean": safe_round(r["temp_mean"], 1),
                "rain_daily": safe_round(r["rain_daily"], 1),
                "wind_gust": safe_round(r["wind_gust"], 1),
            })
        return res

    # Récords absolutos de la serie
    hottest = top_n_days("temp_max", 10, ascending=False)
    coldest = top_n_days("temp_min", 10, ascending=True)
    coldest_max = top_n_days("temp_max", 10, ascending=True)
    warmest_min = top_n_days("temp_min", 10, ascending=False)
    wettest_days = top_n_days("rain_daily", 10, ascending=False)
    windiest_days = top_n_days("wind_gust", 10, ascending=False)
    widest_amp = top_n_days("amp", 10, ascending=False)

    # Récords subdiarios en las series de 30 min (2023–2026)
    frames_30 = [df.assign(year=y) for y, df in all_30min_dfs.items() if df is not None and not df.empty]
    df_30_all = pd.concat(frames_30, ignore_index=True) if frames_30 else pd.DataFrame()

    subdaily_records = {}
    if not df_30_all.empty:
        idx_rr = df_30_all["rain_rate"].idxmax()
        idx_rh = df_30_all["rain_hourly"].idxmax()
        subdaily_records = {
            "max_rain_rate": {
                "value": safe_round(df_30_all.loc[idx_rr, "rain_rate"], 1),
                "unit": "mm/h",
                "date": str(df_30_all.loc[idx_rr, "date"]),
                "time": df_30_all.loc[idx_rr, "dt"].strftime("%H:%M"),
                "year": int(df_30_all.loc[idx_rr, "year"]),
            },
            "max_hourly_rain": {
                "value": safe_round(df_30_all.loc[idx_rh, "rain_hourly"], 1),
                "unit": "mm",
                "date": str(df_30_all.loc[idx_rh, "date"]),
                "time": df_30_all.loc[idx_rh, "dt"].strftime("%H:%M"),
                "year": int(df_30_all.loc[idx_rh, "year"]),
            },
        }

    # Presión máxima y mínima absoluta
    idx_pmax = df_all["pressure_rel_max"].idxmax()
    idx_pmin = df_all["pressure_rel_min"].idxmin()

    # Récords mensuales (para cada mes del calendario Ene..Dic a lo largo de toda la serie)
    monthly_records: List[Dict[str, Any]] = []
    for m in range(1, 13):
        sub = df_all[df_all["month"] == m]
        if sub.empty:
            continue
        i_tmax = sub["temp_max"].idxmax()
        i_tmin = sub["temp_min"].idxmin()
        i_rmax = sub["rain_daily"].idxmax()
        i_gmax = sub["wind_gust"].idxmax()

        # Mes más lluvioso y más seco para ese mes calendario entre los años disponibles
        by_y = sub.groupby("year").agg(
            rain_sum=("rain_daily", "sum"),
            t_mean=("temp_mean", "mean"),
            valid_days=("temp_mean", lambda s: s.notna().sum()),
        )
        # Considerar meses con al menos 20 días observados
        by_y_valid = by_y[by_y["valid_days"] >= 20]
        wet_y = int(by_y_valid["rain_sum"].idxmax()) if not by_y_valid.empty else None
        dry_y = int(by_y_valid["rain_sum"].idxmin()) if not by_y_valid.empty else None
        warm_y = int(by_y_valid["t_mean"].idxmax()) if not by_y_valid.empty else None
        cold_y = int(by_y_valid["t_mean"].idxmin()) if not by_y_valid.empty else None

        monthly_records.append({
            "month": m,
            "name": MONTH_NAMES_ES[m - 1],
            "short": MONTH_SHORT_ES[m - 1],
            "temp_max_abs": safe_round(sub.loc[i_tmax, "temp_max"], 1),
            "temp_max_date": str(sub.loc[i_tmax, "date"]),
            "temp_min_abs": safe_round(sub.loc[i_tmin, "temp_min"], 1),
            "temp_min_date": str(sub.loc[i_tmin, "date"]),
            "max_daily_rain": safe_round(sub.loc[i_rmax, "rain_daily"], 1),
            "max_daily_rain_date": str(sub.loc[i_rmax, "date"]),
            "max_wind_gust": safe_round(sub.loc[i_gmax, "wind_gust"], 1),
            "max_wind_gust_date": str(sub.loc[i_gmax, "date"]),
            "wettest_edition": {"year": wet_y, "rain_mm": safe_round(by_y_valid.loc[wet_y, "rain_sum"], 1)} if wet_y else None,
            "driest_edition": {"year": dry_y, "rain_mm": safe_round(by_y_valid.loc[dry_y, "rain_sum"], 1)} if dry_y else None,
            "warmest_edition": {"year": warm_y, "temp_mean": safe_round(by_y_valid.loc[warm_y, "t_mean"], 1)} if warm_y else None,
            "coldest_edition": {"year": cold_y, "temp_mean": safe_round(by_y_valid.loc[cold_y, "t_mean"], 1)} if cold_y else None,
        })

    records_payload = {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "period_covered": "2022-01-01 a 2026-10-25 (serie consolidada en repositorio; estación operativa desde 29/11/2020)",
        "total_observed_days": int(df_all["temp_mean"].notna().sum()),
        "methodological_disclaimer": (
            "Todos los récords corresponden exclusivamente al periodo observado por la estación automática "
            "MeteoRiotuerto en Barrio de Arriba (115 msnm) y no deben extrapolarse sin matices a toda la historia "
            "climática secular del municipio de Riotuerto."
        ),
        "absolute_records": {
            "temp_max": {
                "label": "Temperatura máxima absoluta",
                "value": hottest[0]["value"],
                "unit": "°C",
                "date": hottest[0]["date"],
                "time": find_exact_time_in_30min(all_30min_dfs.get(hottest[0]["year"]), hottest[0]["date"], "temp_max", "max"),
                "year": hottest[0]["year"],
                "context": "Advección cálida sahariana con intenso efecto Foehn (viento sur) bajo aviso rojo en Cantabria.",
            },
            "temp_min": {
                "label": "Temperatura mínima absoluta",
                "value": coldest[0]["value"],
                "unit": "°C",
                "date": coldest[0]["date"],
                "time": find_exact_time_in_30min(all_30min_dfs.get(coldest[0]["year"]), coldest[0]["date"], "temp_min", "min"),
                "year": coldest[0]["year"],
                "context": "Madrugada anticiclónica invernal con fuerte inversión térmica en el fondo del valle del Covadal.",
            },
            "max_daily_rain": {
                "label": "Mayor precipitación en un día",
                "value": wettest_days[0]["value"],
                "unit": "mm",
                "date": wettest_days[0]["date"],
                "year": wettest_days[0]["year"],
                "context": "Temporal atlántico del noroeste asociado a la borrasca Fien en enero de 2023.",
            },
            "max_wind_gust": {
                "label": "Mayor racha de viento",
                "value": windiest_days[0]["value"],
                "unit": "km/h",
                "date": windiest_days[0]["date"],
                "time": find_exact_time_in_30min(all_30min_dfs.get(windiest_days[0]["year"]), windiest_days[0]["date"], "wind_gust", "max"),
                "year": windiest_days[0]["year"],
                "context": "Vendaval de componente sur asociado al paso de la profunda borrasca Karlotta.",
            },
            "max_thermal_amplitude": {
                "label": "Mayor amplitud térmica diaria",
                "value": widest_amp[0]["value"],
                "unit": "°C",
                "date": widest_amp[0]["date"],
                "year": widest_amp[0]["year"],
                "context": f"De {widest_amp[0]['temp_min']} °C de mínima a {widest_amp[0]['temp_max']} °C de máxima en una sola jornada.",
            },
            "coldest_day_max": {
                "label": "Día más frío (máxima más baja)",
                "value": coldest_max[0]["value"],
                "unit": "°C",
                "date": coldest_max[0]["date"],
                "year": coldest_max[0]["year"],
                "context": "Jornada invernal de advección fría polar en la que el termómetro no superó los 5,1 °C.",
            },
            "warmest_night_min": {
                "label": "Noche más cálida (mínima más alta)",
                "value": warmest_min[0]["value"],
                "unit": "°C",
                "date": warmest_min[0]["date"],
                "year": warmest_min[0]["year"],
                "context": "Noche tropical mantenida por viento sur persistente.",
            },
            "max_rain_rate": subdaily_records.get("max_rain_rate"),
            "max_hourly_rain": subdaily_records.get("max_hourly_rain"),
            "pressure_max": {
                "label": "Presión atmosférica máxima",
                "value": safe_round(df_all.loc[idx_pmax, "pressure_rel_max"], 1),
                "unit": "hPa",
                "date": str(df_all.loc[idx_pmax, "date"]),
                "year": int(df_all.loc[idx_pmax, "year"]),
                "context": "Potente dorsal anticiclónica invernal sobre la península ibérica y el golfo de Vizcaya.",
            },
            "pressure_min": {
                "label": "Presión atmosférica mínima",
                "value": safe_round(df_all.loc[idx_pmin, "pressure_rel_min"], 1),
                "unit": "hPa",
                "date": str(df_all.loc[idx_pmin, "date"]),
                "year": int(df_all.loc[idx_pmin, "year"]),
                "context": "Paso del centro depresionario de una borrasca atlántica profunda.",
            },
        },
        "rankings": {
            "top_hottest_days": hottest,
            "top_coldest_days": coldest,
            "top_wettest_days": wettest_days,
            "top_windiest_days": windiest_days,
            "top_amplitude_days": widest_amp,
            "top_coldest_max_days": coldest_max,
            "top_warmest_min_days": warmest_min,
        },
        "monthly_records": monthly_records,
    }

    # -------------------------------------------------------------------------
    # Comparativas interanuales y anomalías respecto a la media 2022–2025
    # -------------------------------------------------------------------------
    complete_years = STATION_META["hardware"]["complete_years"]
    ref_temp_mean = round(
        float(np.mean([almanacs[y]["stats"]["temperature"]["mean"] for y in complete_years])), 2
    )
    ref_rain_mean = round(
        float(np.mean([almanacs[y]["stats"]["precipitation"]["total_mm"] for y in complete_years])), 1
    )
    ref_rain_days_mean = round(
        float(np.mean([almanacs[y]["stats"]["precipitation"]["days_ge_02mm"] for y in complete_years])), 1
    )
    ref_hdd_mean = round(
        float(np.mean([almanacs[y]["stats"]["degree_days"]["hdd_15_5"] for y in complete_years])), 1
    )
    ref_cdd_mean = round(
        float(np.mean([almanacs[y]["stats"]["degree_days"]["cdd_21_0"] for y in complete_years])), 1
    )
    ref_gdd_mean = round(
        float(np.mean([almanacs[y]["stats"]["degree_days"]["gdd_10_0"] for y in complete_years])), 1
    )

    yearly_comparison_table: List[Dict[str, Any]] = []
    for y in sorted(almanacs.keys()):
        alm = almanacs[y]
        st_t = alm["stats"]["temperature"]
        st_p = alm["stats"]["precipitation"]
        st_w = alm["stats"]["wind"]
        st_a = alm["stats"]["atmosphere_and_solar"]
        is_prov = alm["is_provisional"]

        t_anom = round(st_t["mean"] - ref_temp_mean, 2) if st_t["mean"] is not None else None
        r_anom_mm = round(st_p["total_mm"] - ref_rain_mean, 1) if not is_prov else None
        r_anom_pct = round(((st_p["total_mm"] - ref_rain_mean) / ref_rain_mean) * 100.0, 1) if not is_prov else None

        yearly_comparison_table.append({
            "year": y,
            "is_provisional": is_prov,
            "valid_days": alm["coverage"]["valid_days"],
            "coverage_pct": alm["coverage"]["coverage_pct"],
            "character": alm["editorial"].get("character", ""),
            "temp_mean": st_t["mean"],
            "temp_max_mean": st_t["max_mean"],
            "temp_min_mean": st_t["min_mean"],
            "temp_anomaly_vs_series": t_anom,
            "temp_max_abs": st_t["max_abs"],
            "temp_max_date": st_t["max_abs_date"],
            "temp_min_abs": st_t["min_abs"],
            "temp_min_date": st_t["min_abs_date"],
            "frost_days": st_t["frost_days_le_0"],
            "warm_days_25": st_t["warm_days_ge_25"],
            "hot_days_30": st_t["hot_days_ge_30"],
            "intense_heat_35": st_t["intense_heat_days_ge_35"],
            "extreme_heat_40": st_t["extreme_heat_days_ge_40"],
            "tropical_nights": st_t["tropical_nights_ge_20"],
            "rain_total_mm": st_p["total_mm"],
            "rain_anomaly_mm": r_anom_mm,
            "rain_anomaly_pct": r_anom_pct,
            "rain_days_02": st_p["days_ge_02mm"],
            "rain_days_1": st_p["days_ge_1mm"],
            "rain_days_10": st_p["days_ge_10mm"],
            "rain_days_30": st_p["days_ge_30mm"],
            "max_daily_rain_mm": st_p["max_daily_mm"],
            "max_daily_rain_date": st_p["max_daily_date"],
            "wettest_month": st_p["wettest_month"],
            "wettest_month_mm": st_p["wettest_month_mm"],
            "driest_month": st_p["driest_month"],
            "driest_month_mm": st_p["driest_month_mm"],
            "wind_mean_kmh": st_w["mean_speed_kmh"],
            "wind_gust_max_kmh": st_w["max_gust_kmh"],
            "wind_gust_max_date": st_w["max_gust_date"],
            "wind_days_40": st_w["days_gust_ge_40"],
            "foehn_days": st_w["foehn_days"],
            "wind_foehn_days": st_w["wind_foehn_days"],
            "thermal_foehn_days": st_w["thermal_foehn_days"],
            "hdd_15_5": alm["stats"]["degree_days"]["hdd_15_5"],
            "cdd_21_0": alm["stats"]["degree_days"]["cdd_21_0"],
            "gdd_10_0": alm["stats"]["degree_days"]["gdd_10_0"],
            "temp_median": alm["stats"]["thermal_percentiles"]["temp_mean"]["P50"],
            "temp_p10": alm["stats"]["thermal_percentiles"]["temp_mean"]["P10"],
            "temp_p90": alm["stats"]["thermal_percentiles"]["temp_mean"]["P90"],
            "comfort_days_15_25": sum(b["days"] for b in alm["stats"]["thermal_comfort_bands"] if b["key"] in ("comfort_mild", "pleasant_warm")),
            "comfort_pct_15_25": round(sum(b["pct"] for b in alm["stats"]["thermal_comfort_bands"] if b["key"] in ("comfort_mild", "pleasant_warm")), 1),
            "thermal_bands": {b["key"]: b["days"] for b in alm["stats"]["thermal_comfort_bands"]},
            "humidity_mean_pct": st_a["humidity_mean_pct"],
            "pressure_mean_hpa": st_a["pressure_mean_hpa"],
            "solar_max_wm2": st_a["solar_max_wm2"],
            "estimated_sunshine_hours": st_a["estimated_sunshine_hours"],
        })

    # Matrices mensuales (año x 12 meses) para gráficas superpuestas y mapas de calor
    monthly_matrices = {
        "months": MONTH_SHORT_ES,
        "month_names": MONTH_NAMES_ES,
        "temp_mean": {},
        "temp_max_abs": {},
        "temp_min_abs": {},
        "rain_total": {},
        "rain_days_02": {},
        "wind_gust_max": {},
        "foehn_days": {},
        "hdd_15_5": {},
        "cdd_21_0": {},
        "gdd_10_0": {},
    }
    for y, alm in sorted(almanacs.items()):
        monthly_matrices["temp_mean"][str(y)] = [m["temp_mean"] for m in alm["monthly"]]
        monthly_matrices["temp_max_abs"][str(y)] = [m["temp_max_abs"] for m in alm["monthly"]]
        monthly_matrices["temp_min_abs"][str(y)] = [m["temp_min_abs"] for m in alm["monthly"]]
        monthly_matrices["rain_total"][str(y)] = [m["rain_total"] for m in alm["monthly"]]
        monthly_matrices["rain_days_02"][str(y)] = [m["rain_days_02"] for m in alm["monthly"]]
        monthly_matrices["wind_gust_max"][str(y)] = [m["wind_gust_max"] for m in alm["monthly"]]
        monthly_matrices["foehn_days"][str(y)] = [m["foehn_days"] for m in alm["monthly"]]
        monthly_matrices["hdd_15_5"][str(y)] = [m["hdd_15_5"] for m in alm["monthly"]]
        monthly_matrices["cdd_21_0"][str(y)] = [m["cdd_21_0"] for m in alm["monthly"]]
        monthly_matrices["gdd_10_0"][str(y)] = [m["gdd_10_0"] for m in alm["monthly"]]

    # Medias mensuales de referencia (2022–2025)
    ref_monthly_temp = []
    ref_monthly_rain = []
    for m_idx in range(12):
        t_vals = [almanacs[y]["monthly"][m_idx]["temp_mean"] for y in complete_years if almanacs[y]["monthly"][m_idx]["temp_mean"] is not None]
        r_vals = [almanacs[y]["monthly"][m_idx]["rain_total"] for y in complete_years if almanacs[y]["monthly"][m_idx]["rain_total"] is not None]
        ref_monthly_temp.append(round(float(np.mean(t_vals)), 1) if t_vals else None)
        ref_monthly_rain.append(round(float(np.mean(r_vals)), 1) if r_vals else None)

    # -------------------------------------------------------------------------
    # Curvas de precipitación acumulada diaria (EVO-001: comparativa interanual 366 días)
    # -------------------------------------------------------------------------
    ref_366_dates = pd.date_range("2024-01-01", "2024-12-31")
    cal_md_keys = [d.strftime("%m-%d") for d in ref_366_dates]
    cal_labels = [f"{d.day} {MONTH_SHORT_ES[d.month - 1].lower()}" for d in ref_366_dates]

    cum_rain_by_year: Dict[str, List[Optional[float]]] = {}
    for y, alm in sorted(almanacs.items()):
        ds = alm["daily_series"]
        date_to_rain = {d_str[5:]: (r if r is not None else 0.0) for d_str, r in zip(ds["dates"], ds["rain_daily"])}
        is_prov = alm["is_provisional"]
        last_date = ds["dates"][-1] if ds["dates"] else ""
        last_md = last_date[5:] if last_date else ""

        cum_series: List[Optional[float]] = []
        running_sum = 0.0
        for md in cal_md_keys:
            if is_prov and md > last_md:
                cum_series.append(None)
            else:
                if md in date_to_rain:
                    running_sum += date_to_rain[md]
                cum_series.append(round(running_sum, 1))
        cum_rain_by_year[str(y)] = cum_series

        # Añadir también 'rain_accum' a cada 'daily_series' de cada almanaque individual
        cum_running_alm = 0.0
        accum_list = []
        for r_val in ds["rain_daily"]:
            if r_val is not None:
                cum_running_alm += r_val
            accum_list.append(round(cum_running_alm, 1))
        ds["rain_accum"] = accum_list

    # Curva media de referencia acumulada día a día (2022–2025)
    baseline_cum_curve: List[Optional[float]] = []
    for idx_day in range(366):
        vals = [
            cum_rain_by_year[str(y)][idx_day]
            for y in complete_years
            if cum_rain_by_year[str(y)][idx_day] is not None
        ]
        baseline_cum_curve.append(round(float(np.mean(vals)), 1) if vals else None)

    cumulative_precipitation = {
        "calendar_days": cal_md_keys,
        "labels": cal_labels,
        "baseline_mean": baseline_cum_curve,
        "baseline_years": complete_years,
        "years": cum_rain_by_year,
    }

    thermal_distribution = {
        "bands": [
            {"key": b["key"], "name": b["name"], "range": b["range"], "color": b["color"], "icon": b["icon"]}
            for b in almanacs[complete_years[0]]["stats"]["thermal_comfort_bands"]
        ],
        "years": {
            str(y): [b["days"] for b in almanacs[y]["stats"]["thermal_comfort_bands"]]
            for y in sorted(almanacs.keys())
        },
        "years_pct": {
            str(y): [b["pct"] for b in almanacs[y]["stats"]["thermal_comfort_bands"]]
            for y in sorted(almanacs.keys())
        },
        "percentiles": {
            str(y): almanacs[y]["stats"]["thermal_percentiles"]
            for y in sorted(almanacs.keys())
        },
    }

    comparisons_payload = {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "reference_baseline": {
            "years_included": complete_years,
            "excluded_provisional": [2026],
            "note": (
                "La referencia interna se calcula como el promedio de los años naturales completos observados "
                "(2022–2025). Según los criterios de la Organización Meteorológica Mundial (OMM), una normal "
                "climatológica estándar requiere una serie de 30 años; por tanto, estas anomalías describen "
                "la variabilidad interanual dentro del registro disponible de MeteoRiotuerto."
            ),
            "mean_annual_temp_c": ref_temp_mean,
            "mean_annual_rain_mm": ref_rain_mean,
            "mean_annual_rain_days": ref_rain_days_mean,
            "mean_annual_hdd_15_5": ref_hdd_mean,
            "mean_annual_cdd_21_0": ref_cdd_mean,
            "mean_annual_gdd_10_0": ref_gdd_mean,
            "monthly_mean_temp_c": ref_monthly_temp,
            "monthly_mean_rain_mm": ref_monthly_rain,
        },
        "yearly_table": yearly_comparison_table,
        "monthly_matrices": monthly_matrices,
        "cumulative_precipitation": cumulative_precipitation,
        "thermal_distribution": thermal_distribution,
    }

    return records_payload, comparisons_payload


def build_all(source_dir: Optional[Path], output_dir: Path, cache_dir: Path) -> bool:
    """
    Orquesta el flujo completo de extremo a extremo con escritura atómica.
    """
    resolved_src = ensure_source_files(source_dir, cache_dir)
    print(f"[INFO] Procesando datos originales desde: {resolved_src}")

    years = STATION_META["hardware"]["consolidated_years"]
    almanacs: Dict[int, Dict[str, Any]] = {}
    daily_frames: List[pd.DataFrame] = []
    all_30min_dfs: Dict[int, Optional[pd.DataFrame]] = {}

    for y in years:
        df_daily, anomalies_daily = load_and_clean_daily(resolved_src, y)
        df_30, meta_30 = load_and_clean_30min(resolved_src, y)
        alm = compute_year_almanac(y, df_daily, df_30, anomalies_daily, meta_30)
        almanacs[y] = alm
        daily_frames.append(df_daily)
        all_30min_dfs[y] = df_30
        print(
            f"  -> Año {y}: {alm['coverage']['valid_days']}/{alm['coverage']['observed_span_days']} días válidos | "
            f"T.media={alm['stats']['temperature']['mean']} °C | Lluvia={alm['stats']['precipitation']['total_mm']} mm | "
            f"30min={alm['coverage']['clean_30min_records']} filas"
        )

    all_daily_df = pd.concat(daily_frames, ignore_index=True)
    records_payload, comparisons_payload = build_records_and_comparisons(almanacs, all_daily_df, all_30min_dfs)

    # Construir index.json (resumen global para la portada y navegación)
    index_payload = {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "station": STATION_META,
        "series_overview": {
            "years_available": years,
            "complete_years": STATION_META["hardware"]["complete_years"],
            "provisional_years": STATION_META["hardware"]["provisional_years"],
            "total_observed_days": records_payload["total_observed_days"],
            "first_consolidated_date": "2022-01-01",
            "last_consolidated_date": str(all_daily_df["date"].max()),
            "reference_2022_2025": comparisons_payload["reference_baseline"],
        },
        "headline_records": records_payload["absolute_records"],
        "years_summary": comparisons_payload["yearly_table"],
    }

    # Escritura atómica en directorio temporal antes de volcar en output_dir
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="meteoriotuerto_build_") as tmp_str:
        tmp_dir = Path(tmp_str)
        files_to_write: Dict[str, Any] = {
            "index.json": index_payload,
            "records.json": records_payload,
            "comparisons.json": comparisons_payload,
            "glossary.json": get_glossary_payload(),
        }
        for y, alm in almanacs.items():
            files_to_write[f"almanac_{y}.json"] = alm

        for fname, payload in files_to_write.items():
            fpath = tmp_dir / fname
            with open(fpath, "w", encoding="utf-8") as fp:
                json.dump(payload, fp, ensure_ascii=False, indent=2)

        # Copiar de forma segura a output_dir
        output_dir.mkdir(parents=True, exist_ok=True)
        for fname in files_to_write:
            shutil.copy2(tmp_dir / fname, output_dir / fname)

    print(f"[OK] Productos JSON generados correctamente en: {output_dir}")
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="Genera los productos JSON del almanaque MeteoRiotuerto.")
    project_root = Path(__file__).resolve().parent.parent
    default_local_repo = project_root.parent / "meteoriotuerto"
    parser.add_argument(
        "--source-dir",
        type=str,
        default=str(default_local_repo) if default_local_repo.exists() else "",
        help="Ruta local al repositorio meteoriotuerto (si no existe, descarga desde GitHub).",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default=str(project_root / "data"),
        help="Directorio de salida para los archivos JSON.",
    )
    parser.add_argument(
        "--cache-dir",
        type=str,
        default=str(project_root / ".cache" / "meteoriotuerto"),
        help="Directorio de caché para descargas cuando no existe clon local.",
    )
    args = parser.parse_args()
    src_path = Path(args.source_dir) if args.source_dir else None
    ok = build_all(src_path, Path(args.output_dir), Path(args.cache_dir))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
