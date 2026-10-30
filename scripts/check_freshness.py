#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
===============================================================================
check_freshness.py — Sensor de frescura y salud de datos de MeteoRiotuerto (EVO-039)
===============================================================================
Inspecciona la última fecha de observación consolidada en `data/index.json` y
calcula la antigüedad en días naturales respecto a la fecha actual (UTC o local).

Genera diagnósticos para la consola, salida JSON estructurada y anotaciones
nativas para GitHub Actions (`::notice::` y `::warning::`).

Uso:
  python3 scripts/check_freshness.py
  python3 scripts/check_freshness.py --max-delay-days 3 --json
  python3 scripts/check_freshness.py --data-file data/index.json
===============================================================================
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT_DIR = SCRIPT_DIR.parent
DEFAULT_INDEX_PATH = ROOT_DIR / "data" / "index.json"


def evaluate_freshness(
    index_path: Path,
    max_delay_days: int = 2,
    warning_delay_days: int = 4,
    reference_date: datetime | None = None,
) -> Dict[str, Any]:
    """
    Evalúa la frescura de los datos consolidados en `index.json`.

    Retorna un diccionario con:
      - status: 'fresh' | 'delayed' | 'stale' | 'error'
      - last_consolidated_date: str (YYYY-MM-DD)
      - delay_days: int
      - total_observed_days: int
      - generated_at: str
      - message: str
      - is_fresh: bool
      - github_annotation: str
    """
    if not index_path.exists():
        return {
            "status": "error",
            "last_consolidated_date": "",
            "delay_days": -1,
            "total_observed_days": 0,
            "generated_at": "",
            "message": f"Archivo de índice no encontrado: {index_path}",
            "is_fresh": False,
            "github_annotation": f"::error title=Sensor de frescura::No se encontró {index_path}",
        }

    try:
        data = json.loads(index_path.read_text(encoding="utf-8"))
    except Exception as exc:
        return {
            "status": "error",
            "last_consolidated_date": "",
            "delay_days": -1,
            "total_observed_days": 0,
            "generated_at": "",
            "message": f"Error al parsear {index_path}: {exc}",
            "is_fresh": False,
            "github_annotation": f"::error title=Sensor de frescura::Error JSON en {index_path}: {exc}",
        }

    overview = data.get("series_overview", {})
    last_date_str = str(overview.get("last_consolidated_date", "")).strip()
    total_days = int(overview.get("total_observed_days", 0))
    generated_at = str(data.get("generated_at", "")).strip()

    if not last_date_str:
        return {
            "status": "error",
            "last_consolidated_date": "",
            "delay_days": -1,
            "total_observed_days": total_days,
            "generated_at": generated_at,
            "message": "No se encontró el campo 'last_consolidated_date' en series_overview",
            "is_fresh": False,
            "github_annotation": "::error title=Sensor de frescura::Falta last_consolidated_date en index.json",
        }

    try:
        last_date = datetime.strptime(last_date_str, "%Y-%m-%d").date()
    except ValueError:
        return {
            "status": "error",
            "last_consolidated_date": last_date_str,
            "delay_days": -1,
            "total_observed_days": total_days,
            "generated_at": generated_at,
            "message": f"Formato de fecha no válido: '{last_date_str}' (se esperaba YYYY-MM-DD)",
            "is_fresh": False,
            "github_annotation": f"::error title=Sensor de frescura::Fecha no válida {last_date_str}",
        }

    ref_date = reference_date.date() if reference_date else datetime.now(timezone.utc).date()
    delay = (ref_date - last_date).days

    if delay <= max_delay_days:
        status = "fresh"
        msg = (
            f"Frescura óptima: último cierre consolidado el {last_date_str} "
            f"({delay} día(s) de antigüedad, umbral: {max_delay_days})."
        )
        annotation = f"::notice title=Frescura de datos::Datos al día (cierre: {last_date_str}, desfase: {delay}d)"
        is_fresh = True
    elif delay <= warning_delay_days:
        status = "delayed"
        msg = (
            f"Sincronización demorada: último cierre consolidado el {last_date_str} "
            f"({delay} días de antigüedad, supera el umbral normal de {max_delay_days})."
        )
        annotation = (
            f"::warning title=Frescura de datos::Demora en consolidación: último cierre {last_date_str} "
            f"({delay} días sin actualizar)"
        )
        is_fresh = False
    else:
        status = "stale"
        msg = (
            f"Incidencia de frescura (desactualizado): último cierre el {last_date_str} "
            f"({delay} días de desfase, supera {warning_delay_days} días)."
        )
        annotation = (
            f"::warning title=Frescura de datos (CRÍTICO)::Retención de datos: último cierre {last_date_str} "
            f"({delay} días de desfase)"
        )
        is_fresh = False

    return {
        "status": status,
        "last_consolidated_date": last_date_str,
        "delay_days": delay,
        "total_observed_days": total_days,
        "generated_at": generated_at,
        "reference_date": ref_date.isoformat(),
        "message": msg,
        "is_fresh": is_fresh,
        "github_annotation": annotation,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Sensor de frescura y salud de datos de MeteoRiotuerto (EVO-039)."
    )
    parser.add_argument(
        "--data-file",
        type=Path,
        default=DEFAULT_INDEX_PATH,
        help="Ruta al archivo index.json (por defecto data/index.json).",
    )
    parser.add_argument(
        "--max-delay-days",
        type=int,
        default=2,
        help="Días máximos de antigüedad para considerarse óptimo (por defecto 2).",
    )
    parser.add_argument(
        "--warning-delay-days",
        type=int,
        default=4,
        help="Días de antigüedad para considerarse demora moderada (por defecto 4).",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emitir resultado en formato JSON estructurado.",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Devolver código de salida 1 si los datos no están en estado 'fresh'.",
    )
    parser.add_argument(
        "--github-actions",
        action="store_true",
        help="Emitir anotaciones nativas de GitHub Actions (::notice:: o ::warning::).",
    )

    args = parser.parse_args()
    res = evaluate_freshness(
        args.data_file,
        max_delay_days=args.max_delay_days,
        warning_delay_days=args.warning_delay_days,
    )

    if args.json:
        print(json.dumps(res, indent=2, ensure_ascii=False))
    else:
        status_symbol = {
            "fresh": "[OK]",
            "delayed": "[AVISO]",
            "stale": "[ALERTA]",
            "error": "[ERROR]",
        }.get(res["status"], "[INFO]")
        print(f"{status_symbol} {res['message']}")
        print(f"       Total días observados: {res['total_observed_days']}")
        print(f"       Compilación de datos : {res['generated_at'] or 'No disponible'}")

    # Emitir anotación para GitHub Actions si está habilitado o se detecta el entorno CI
    if args.github_actions or os.environ.get("GITHUB_ACTIONS") == "true":
        print(res["github_annotation"], file=sys.stderr)

    if args.strict and not res["is_fresh"]:
        return 1
    if res["status"] == "error":
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
