#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
===============================================================================
open_data_catalog.py — Generador de GeoJSON (RFC 7946) y JSON Schema de datos abiertos
===============================================================================
Construye los recursos de interoperabilidad geoespacial (SIG) y científica
de MeteoRiotuerto (EVO-010):
  1. `data/station.geojson`: Colección cartográfica GeoJSON en WGS84 (EPSG:4326)
     con la estación meteorológica de Barrio de Arriba, sus atributos climáticos
     plurianuales, récords absolutos y los hitos orográficos del valle.
  2. `data/schema.json`: Especificación formal JSON Schema (Draft 2020-12) y
     diccionario de variables físicas, unidades e invariantes de la API estática.
===============================================================================
"""

from __future__ import annotations

from typing import Any, Dict, List


def build_station_geojson(
    index_payload: Dict[str, Any],
    records_payload: Dict[str, Any],
    comparisons_payload: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Genera el objeto GeoJSON (RFC 7946) de la estación MeteoRiotuerto y sus
    referencias fisiográficas del valle del Covadal / Miera.
    Coordenadas en orden estándar GeoJSON: [longitud, latitud, altitud_msnm].
    """
    st = index_payload["station"]
    loc = st["location"]
    hw = st["hardware"]
    overview = index_payload["series_overview"]
    ref = overview["reference_2022_2025"]
    abs_rec = records_payload["absolute_records"]

    # Calcular mediana plurianual media de los años cerrados (2022-2025)
    complete_rows = [
        r for r in comparisons_payload.get("yearly_table", [])
        if not r.get("is_provisional", False) and r.get("temp_median") is not None
    ]
    median_baseline = (
        round(sum(r["temp_median"] for r in complete_rows) / len(complete_rows), 1)
        if complete_rows
        else ref.get("mean_annual_temp_c")
    )

    lon = round(float(loc["longitude"]), 3)
    lat = round(float(loc["latitude"]), 3)
    alt = int(loc["altitude_msnm"])

    features: List[Dict[str, Any]] = [
        {
            "type": "Feature",
            "id": "meteoriotuerto-station",
            "geometry": {
                "type": "Point",
                "coordinates": [lon, lat, alt],
            },
            "properties": {
                "marker-color": "#1b4332",
                "marker-size": "large",
                "marker-symbol": "lighthouse",
                "feature_role": "estacion_meteorologica_principal",
                "station_code": "METEORIOTUERTO-WS3500",
                "name": "Estación meteorológica automática MeteoRiotuerto",
                "locality": loc["locality"],
                "municipality": loc["municipality"],
                "comarca": "Trasmiera",
                "region": loc["region"],
                "country": loc["country"],
                "valley": loc["valley"],
                "latitude_wgs84": lat,
                "longitude_wgs84": lon,
                "altitude_msnm": alt,
                "crs": loc["crs"],
                "coordinate_precision_note": "Coordenadas redondeadas a 3 decimales (~110 m) por privacidad del entorno doméstico.",
                "timezone": loc["timezone"],
                "distance_coast_km": loc["distance_coast_km"],
                "distance_santander_airport_km": loc["distance_santander_airport_km"],
                "distance_alisas_pass_km": loc["distance_alisas_pass_km"],
                "station_model": hw["station_model"],
                "gateway_model": hw["gateway_model"],
                "mounting": hw["mounting"],
                "sampling_interval_min": hw["sampling_interval_min"],
                "series_start": hw["series_start"],
                "first_consolidated_date": overview["first_consolidated_date"],
                "last_consolidated_date": overview["last_consolidated_date"],
                "total_observed_days": overview["total_observed_days"],
                "baseline_period": f"{min(ref['years_included'])}-{max(ref['years_included'])}",
                "temp_mean_baseline_c": ref["mean_annual_temp_c"],
                "temp_median_baseline_c": median_baseline,
                "rain_annual_mean_mm": ref["mean_annual_rain_mm"],
                "rain_days_mean": ref["mean_annual_rain_days"],
                "hdd_15_5_mean": ref.get("mean_annual_hdd_15_5"),
                "cdd_21_0_mean": ref.get("mean_annual_cdd_21_0"),
                "gdd_10_0_mean": ref.get("mean_annual_gdd_10_0"),
                "record_temp_max_c": abs_rec["temp_max"]["value"],
                "record_temp_max_date": abs_rec["temp_max"]["date"],
                "record_temp_min_c": abs_rec["temp_min"]["value"],
                "record_temp_min_date": abs_rec["temp_min"]["date"],
                "record_daily_rain_mm": abs_rec["max_daily_rain"]["value"],
                "record_daily_rain_date": abs_rec["max_daily_rain"]["date"],
                "record_wind_gust_kmh": abs_rec["max_wind_gust"]["value"],
                "record_wind_gust_date": abs_rec["max_wind_gust"]["date"],
                "web_url": "https://egofer.github.io/meteoriotuerto-web/",
                "api_index_url": "https://egofer.github.io/meteoriotuerto-web/data/index.json",
                "raw_data_repository": "https://github.com/egofer/meteoriotuerto",
            },
        },
        {
            "type": "Feature",
            "id": "puerto-de-alisas",
            "geometry": {
                "type": "Point",
                "coordinates": [-3.655, 43.303, 674],
            },
            "properties": {
                "marker-color": "#c2410c",
                "marker-size": "medium",
                "marker-symbol": "mountain",
                "feature_role": "referencia_orografica_sur",
                "name": "Puerto de Alisas (divisoria meridional del valle)",
                "municipality": "Arredondo / Riotuerto",
                "region": "Cantabria",
                "latitude_wgs84": 43.303,
                "longitude_wgs84": -3.655,
                "altitude_msnm": 674,
                "distance_to_station_km": 5.0,
                "elevation_drop_to_station_m": 559,
                "microclimate_role": (
                    "Barrera orográfica meridional situada 5 km al sur de la estación. "
                    "Con vientos del S y SSW genera compresión adiabática a sotavento (efecto Foehn / suradas) "
                    "al descender casi 560 metros hacia el fondo del valle de Riotuerto, mientras que con flujos "
                    "húmedos del NW actúa como muralla de retención y disparo de precipitación orográfica."
                ),
            },
        },
        {
            "type": "Feature",
            "id": "la-cavada-miera",
            "geometry": {
                "type": "Point",
                "coordinates": [-3.707, 43.352, 62],
            },
            "properties": {
                "marker-color": "#0369a1",
                "marker-size": "small",
                "marker-symbol": "town",
                "feature_role": "referencia_hidrografica_valle",
                "name": "La Cavada (capital municipal y vega del río Miera)",
                "municipality": "Riotuerto",
                "region": "Cantabria",
                "latitude_wgs84": 43.352,
                "longitude_wgs84": -3.707,
                "altitude_msnm": 62,
                "distance_to_station_km": 3.2,
                "microclimate_role": (
                    "Eje aluvial de la cuenca media del río Miera hacia donde drena la subcuenca del río Covadal. "
                    "En noches anticiclónicas despejadas y en calma canaliza el drenaje catabático de aire frío "
                    "propiciando marcadas inversiones térmicas en el fondo del valle."
                ),
            },
        },
    ]

    return {
        "type": "FeatureCollection",
        "name": "meteoriotuerto_station_and_valley_context",
        "bbox": [-3.707, 43.303, 62, -3.655, 43.352, 674],
        "metadata": {
            "title": "Cartografía SIG de la estación MeteoRiotuerto y contexto orográfico del valle del Covadal",
            "standard": "RFC 7946 GeoJSON",
            "crs": "urn:ogc:def:crs:OGC:1.3:CRS84 (WGS84 lon/lat/alt)",
            "epsg": "EPSG:4326",
            "generated_from": "MeteoRiotuerto Open Data Pipeline (EVO-010)",
            "citation": "MeteoRiotuerto — Almanaque meteorológico y climatológico digital de Riotuerto (Cantabria, España).",
        },
        "features": features,
    }


def build_open_data_schema() -> Dict[str, Any]:
    """
    Construye el contrato formal JSON Schema (Draft 2020-12) y el diccionario
    de variables físicas y bioclimáticas de la API estática de MeteoRiotuerto.
    """
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://egofer.github.io/meteoriotuerto-web/data/schema.json",
        "title": "Esquema y diccionario de datos abiertos de MeteoRiotuerto",
        "description": (
            "Contrato técnico formal (JSON Schema Draft 2020-12) y diccionario de variables "
            "meteorológicas, bioclimáticas y estadísticas del archivo histórico MeteoRiotuerto "
            "(Barrio de Arriba, Riotuerto, Cantabria, España; 115 m s. n. m.)."
        ),
        "version": "1.1.0",
        "license": "CC BY 4.0 (Atribución 4.0 Internacional — citar fuente 'MeteoRiotuerto')",
        "crs": "WGS84 (EPSG:4326)",
        "timezone": "Europe/Madrid",
        "static_api_endpoints": [
            {
                "file": "data/index.json",
                "format": "JSON",
                "description": "Metadatos de la estación, cobertura temporal, línea base 2022–2025, récords principales y tabla resumen interanual.",
            },
            {
                "file": "data/almanac_{YYYY}.json",
                "years": [2022, 2023, 2024, 2025, 2026],
                "format": "JSON",
                "description": "Anuario climatológico completo del año YYYY: crónica sinóptica, estadísticas, percentiles P05–P95, bandas de confort, grados día, análisis Foehn, rosa de vientos, desglose mensual y serie diaria íntegra.",
            },
            {
                "file": "data/records.json",
                "format": "JSON",
                "description": "Catálogo de récords históricos absolutos, rankings Top 10 por variable y efemérides extremas por año y mes.",
            },
            {
                "file": "data/comparisons.json",
                "format": "JSON",
                "description": "Matrices comparativas multianuales (mensuales, estacionales y diarias acumuladas), anomalías frente a 2022–2025 y distribución térmica interanual.",
            },
            {
                "file": "data/glossary.json",
                "format": "JSON",
                "description": "Glosario enciclopédico estructurado con 36 conceptos meteorológicos y microclimáticos en 6 categorías temáticas.",
            },
            {
                "file": "data/station.geojson",
                "format": "GeoJSON (RFC 7946)",
                "description": "Capa vectorial de puntos (WGS84 / EPSG:4326) con la estación meteorológica, sus atributos climáticos y las referencias orográficas del valle, lista para QGIS/ArcGIS.",
            },
            {
                "file": "data/schema.json",
                "format": "JSON Schema (Draft 2020-12)",
                "description": "Este documento: diccionario de variables físicas, unidades de medida y esquema formal de validación.",
            },
        ],
        "variables_dictionary": {
            "temp_mean": {
                "label": "Temperatura media diaria",
                "unit": "°C",
                "type": "number | null",
                "precision_decimals": 1,
                "sensor": "Termohigrómetro exterior ventilado (Sainlogic WS3500)",
                "wmo_note": "Promedio aritmético de las lecturas semihorarias (48 registros/día) o resumen diario consolidado.",
            },
            "temp_max": {
                "label": "Temperatura máxima diaria",
                "unit": "°C",
                "type": "number | null",
                "precision_decimals": 1,
                "invariant": "temp_max >= temp_mean >= temp_min",
            },
            "temp_min": {
                "label": "Temperatura mínima diaria",
                "unit": "°C",
                "type": "number | null",
                "precision_decimals": 1,
                "invariant": "temp_min <= temp_mean <= temp_max",
            },
            "temp_amp": {
                "label": "Amplitud u oscilación térmica diaria",
                "unit": "°C",
                "type": "number | null",
                "formula": "temp_max - temp_min",
                "precision_decimals": 1,
            },
            "dew_point_mean": {
                "label": "Punto de rocío medio diario",
                "unit": "°C",
                "type": "number | null",
                "precision_decimals": 1,
            },
            "feels_like_max": {
                "label": "Sensación térmica máxima diaria",
                "unit": "°C",
                "type": "number | null",
                "precision_decimals": 1,
            },
            "feels_like_min": {
                "label": "Sensación térmica mínima diaria",
                "unit": "°C",
                "type": "number | null",
                "precision_decimals": 1,
            },
            "rain_daily": {
                "label": "Precipitación diaria acumulada",
                "unit": "mm (l/m²)",
                "type": "number | null",
                "precision_decimals": 1,
                "invariant": "rain_daily >= 0.0",
                "wmo_note": "Día de lluvia apreciable cuando rain_daily >= 0.2 mm.",
            },
            "rain_rate_max": {
                "label": "Intensidad máxima de precipitación diaria",
                "unit": "mm/h",
                "type": "number | null",
                "precision_decimals": 1,
                "invariant": "rain_rate_max >= 0.0",
            },
            "humidity_mean": {
                "label": "Humedad relativa exterior media",
                "unit": "%",
                "type": "number | null",
                "precision_decimals": 1,
                "valid_range": [1.0, 100.0],
            },
            "wind_speed": {
                "label": "Velocidad media diaria del viento",
                "unit": "km/h",
                "type": "number | null",
                "precision_decimals": 1,
                "invariant": "wind_speed >= 0.0",
            },
            "wind_gust": {
                "label": "Racha máxima diaria de viento",
                "unit": "km/h",
                "type": "number | null",
                "precision_decimals": 1,
                "invariant": "wind_gust >= wind_speed >= 0.0",
            },
            "wind_dir": {
                "label": "Dirección vectorial dominante del viento",
                "unit": "grados acimutales (°)",
                "type": "number | null",
                "valid_range": [0, 360],
                "wmo_note": "Rosa de 16 rumbos (N, NNE, NE, ENE, E, ESE, SE, SSE, S, SSW, SW, WSW, W, WNW, NW, NNW).",
            },
            "pressure_rel": {
                "label": "Presión atmosférica relativa (reducida al nivel del mar)",
                "unit": "hPa",
                "type": "number | null",
                "precision_decimals": 1,
            },
            "solar_max": {
                "label": "Irradiancia solar global máxima diaria",
                "unit": "W/m²",
                "type": "number | null",
                "precision_decimals": 1,
                "wmo_note": "Umbral OMM de insolación directa fijado en >= 120 W/m² sobre el archivo semihorario.",
            },
            "uv_max": {
                "label": "Índice ultravioleta (UVI) máximo diario",
                "unit": "índice adimensional",
                "type": "number | null",
                "precision_decimals": 0,
            },
            "hdd_15_5": {
                "label": "Grados día de calefacción (Heating Degree Days)",
                "unit": "°C·día (HDD)",
                "type": "number",
                "formula": "max(0.0, 15.5 - temp_mean)",
                "base_threshold_c": 15.5,
            },
            "cdd_21_0": {
                "label": "Grados día de refrigeración (Cooling Degree Days)",
                "unit": "°C·día (CDD)",
                "type": "number",
                "formula": "max(0.0, temp_mean - 21.0)",
                "base_threshold_c": 21.0,
            },
            "gdd_10_0": {
                "label": "Grados día de desarrollo vegetativo (Growing Degree Days)",
                "unit": "°C·día (GDD)",
                "type": "number",
                "formula": "max(0.0, temp_mean - 10.0)",
                "base_threshold_c": 10.0,
            },
        },
        "$defs": {
            "AlmanacDocument": {
                "type": "object",
                "required": [
                    "year",
                    "is_provisional",
                    "coverage",
                    "chronicle",
                    "stats",
                    "foehn_analysis",
                    "wind_rose",
                    "beaufort",
                    "monthly",
                    "daily_series",
                ],
                "properties": {
                    "year": {"type": "integer", "minimum": 2020, "maximum": 2100},
                    "is_provisional": {"type": "boolean"},
                    "first_observed_date": {"type": "string", "format": "date"},
                    "last_observed_date": {"type": "string", "format": "date"},
                    "coverage": {
                        "type": "object",
                        "required": ["calendar_days", "observed_span_days", "valid_days", "coverage_pct"],
                    },
                    "stats": {
                        "type": "object",
                        "required": [
                            "temperature",
                            "thermal_percentiles",
                            "thermal_comfort_bands",
                            "precipitation",
                            "wind",
                            "atmosphere_and_solar",
                            "degree_days",
                        ],
                    },
                    "daily_series": {
                        "type": "object",
                        "required": [
                            "dates",
                            "temp_mean",
                            "temp_max",
                            "temp_min",
                            "temp_amp",
                            "rain_daily",
                            "wind_speed",
                            "wind_gust",
                        ],
                    },
                },
            },
            "StationGeoJSON": {
                "type": "object",
                "required": ["type", "features"],
                "properties": {
                    "type": {"const": "FeatureCollection"},
                    "features": {
                        "type": "array",
                        "minItems": 1,
                        "items": {
                            "type": "object",
                            "required": ["type", "id", "geometry", "properties"],
                            "properties": {
                                "type": {"const": "Feature"},
                                "id": {"type": "string"},
                                "geometry": {
                                    "type": "object",
                                    "required": ["type", "coordinates"],
                                    "properties": {
                                        "type": {"const": "Point"},
                                        "coordinates": {
                                            "type": "array",
                                            "minItems": 2,
                                            "maxItems": 3,
                                            "items": {"type": "number"},
                                        },
                                    },
                                },
                                "properties": {"type": "object"},
                            },
                        },
                    },
                },
            },
        },
    }
