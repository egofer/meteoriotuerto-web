#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
===============================================================================
sync_data.py — Sincronización atómica e idempotente de MeteoRiotuerto Web
===============================================================================
Orquesta la actualización automática de los productos JSON estáticos (`data/`)
a partir del repositorio primario de datos (`egofer/meteoriotuerto`), ejecuta
los controles de calidad e invariantes físicos (`validate_data.py`) y la suite
de pruebas (`tests/test_data_pipeline.py`), y opcionalmente confirma y publica
los cambios en GitHub o dispara un evento `repository_dispatch`.

Uso habitual:
  - Sincronización y validación local:
      python3 scripts/sync_data.py
  - Sincronización, commit y push automático (ideal para cron / run_daily.sh):
      python3 scripts/sync_data.py --push
  - Disparo remoto de GitHub Actions vía repository_dispatch:
      DISPATCH_TOKEN="..." python3 scripts/sync_data.py --dispatch-only
===============================================================================
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import subprocess
import sys
import unittest
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT_DIR = SCRIPT_DIR.parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import build_data  # noqa: E402
import validate_data  # noqa: E402


DEFAULT_GITHUB_REPO = "egofer/meteoriotuerto-web"
DISPATCH_EVENT_TYPE = "meteoriotuerto_data_updated"


def _normalize_payload(filename: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normaliza un diccionario JSON eliminando marcas temporales efímeras de
    compilación (`generated_at`) para comparar únicamente cambios reales en los
    datos meteorológicos o metadatos.
    """
    norm = copy.deepcopy(payload)
    norm.pop("generated_at", None)
    return norm


def snapshot_json_dir(data_dir: Path) -> Dict[str, Tuple[str, Dict[str, Any]]]:
    """
    Captura en memoria el texto bruto y el contenido estructurado de todos los
    archivos JSON actuales en `data_dir`.
    """
    snap: Dict[str, Tuple[str, Dict[str, Any]]] = {}
    if not data_dir.exists():
        return snap
    for fpath in sorted(list(data_dir.glob("*.json")) + list(data_dir.glob("*.geojson"))):
        try:
            raw = fpath.read_text(encoding="utf-8")
            parsed = json.loads(raw)
            snap[fpath.name] = (raw, parsed)
        except Exception:
            continue
    return snap


def restore_snapshot(data_dir: Path, snap: Dict[str, Tuple[str, Dict[str, Any]]]) -> None:
    """Restaura exactamente los archivos JSON previos desde una instantánea."""
    data_dir.mkdir(parents=True, exist_ok=True)
    for fname, (raw, _) in snap.items():
        (data_dir / fname).write_text(raw, encoding="utf-8")


def detect_meaningful_changes(
    before: Dict[str, Tuple[str, Dict[str, Any]]],
    after: Dict[str, Tuple[str, Dict[str, Any]]],
) -> List[str]:
    """
    Devuelve la lista de archivos JSON cuyo contenido meteorológico o semántico
    ha cambiado realmente entre `before` y `after`.
    """
    changed: List[str] = []
    all_keys = sorted(set(before.keys()) | set(after.keys()))
    for fname in all_keys:
        if fname not in before or fname not in after:
            changed.append(fname)
            continue
        norm_before = _normalize_payload(fname, before[fname][1])
        norm_after = _normalize_payload(fname, after[fname][1])
        if norm_before != norm_after:
            changed.append(fname)
    return changed


def run_test_suite() -> bool:
    """Ejecuta la suite de pruebas automatizadas en `tests/`."""
    loader = unittest.TestLoader()
    suite = loader.discover(start_dir=str(ROOT_DIR / "tests"), pattern="test_*.py")
    runner = unittest.TextTestRunner(verbosity=1)
    result = runner.run(suite)
    return result.wasSuccessful()


def trigger_repository_dispatch(
    repo: str = DEFAULT_GITHUB_REPO,
    event_type: str = DISPATCH_EVENT_TYPE,
    client_payload: Optional[Dict[str, Any]] = None,
) -> bool:
    """
    Envía un evento `repository_dispatch` a la API REST de GitHub para activar
    el flujo de trabajo remoto en GitHub Actions.
    """
    auth_val = os.environ.get("DISPATCH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if not auth_val:
        print(
            "[ERROR] No se encontró la variable de entorno DISPATCH_TOKEN ni GITHUB_TOKEN "
            "para invocar repository_dispatch.",
            file=sys.stderr,
        )
        return False

    url = f"https://api.github.com/repos/{repo}/dispatches"
    body = {
        "event_type": event_type,
        "client_payload": client_payload or {
            "triggered_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "source": "sync_data.py",
        },
    }
    data_bytes = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data_bytes,
        method="POST",
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {auth_val}",
            "Content-Type": "application/json",
            "User-Agent": "MeteoRiotuerto-Sync/1.0",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            if resp.status in (200, 201, 204):
                print(f"[OK] Evento '{event_type}' enviado con éxito a {repo} (HTTP {resp.status}).")
                return True
            print(f"[WARN] Respuesta inesperada de GitHub API: HTTP {resp.status}", file=sys.stderr)
            return False
    except urllib.error.HTTPError as exc:
        err_msg = exc.read().decode("utf-8", errors="replace")
        print(f"[ERROR] Fallo HTTP {exc.code} al disparar repository_dispatch: {err_msg}", file=sys.stderr)
        return False
    except Exception as exc:
        print(f"[ERROR] Error de red al invocar repository_dispatch: {exc}", file=sys.stderr)
        return False


def commit_and_push_changes(
    data_dir: Path,
    changed_files: List[str],
    push: bool = False,
    last_date: str = "",
) -> bool:
    """
    Registra en Git los archivos JSON modificados en `data/` y, si `push=True`,
    los publica en `origin main`.
    """
    try:
        rel_paths = [str((data_dir / fname).relative_to(ROOT_DIR)) for fname in changed_files]
        # Asegurar también que index.json se incluya cuando hay cambios reales
        idx_rel = str((data_dir / "index.json").relative_to(ROOT_DIR))
        if idx_rel not in rel_paths and (data_dir / "index.json").exists():
            rel_paths.append(idx_rel)

        subprocess.run(["git", "-C", str(ROOT_DIR), "add", "--"] + rel_paths, check=True)

        diff_check = subprocess.run(
            ["git", "-C", str(ROOT_DIR), "diff", "--cached", "--quiet"],
            check=False,
        )
        if diff_check.returncode == 0:
            print("[INFO] No hay diferencias en el índice de Git tras preparar los archivos.")
            return True

        stamp = last_date or datetime.now().strftime("%Y-%m-%d")
        commit_msg = f"data(sync): actualización automática de registros meteorológicos [{stamp}]"
        subprocess.run(["git", "-C", str(ROOT_DIR), "commit", "-m", commit_msg], check=True)
        print(f"[OK] Commit creado: {commit_msg}")

        if push:
            subprocess.run(["git", "-C", str(ROOT_DIR), "push", "origin", "main"], check=True)
            print("[OK] Cambios publicados con éxito en GitHub (origin main).")
        return True
    except subprocess.CalledProcessError as exc:
        print(f"[ERROR] Fallo al ejecutar comando Git: {exc}", file=sys.stderr)
        return False


def sync_all(
    source_dir: Optional[Path] = None,
    output_dir: Optional[Path] = None,
    cache_dir: Optional[Path] = None,
    skip_tests: bool = False,
    force: bool = False,
    commit: bool = False,
    push: bool = False,
    dispatch: bool = False,
) -> Tuple[bool, List[str]]:
    """
    Ejecuta el flujo completo de sincronización, validación y publicación.
    Retorna `(exito, lista_de_archivos_cambiados)`.
    """
    out_dir = (output_dir or (ROOT_DIR / "data")).resolve()
    c_dir = (cache_dir or (ROOT_DIR / ".cache" / "meteoriotuerto")).resolve()

    before_snap = snapshot_json_dir(out_dir)

    try:
        ok = build_data.build_all(source_dir=source_dir, output_dir=out_dir, cache_dir=c_dir)
        if not ok:
            if before_snap:
                restore_snapshot(out_dir, before_snap)
            return False, []
    except Exception as exc:
        print(f"[ERROR] Fallo durante la regeneración de datos: {exc}", file=sys.stderr)
        if before_snap:
            restore_snapshot(out_dir, before_snap)
        return False, []

    # Validar integridad e invariantes físicos
    errors = validate_data.validate_directory(out_dir)
    if errors:
        print("[ERROR] La validación de datos falló; se restauran los JSONs previos:", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        if before_snap:
            restore_snapshot(out_dir, before_snap)
        return False, []

    after_snap = snapshot_json_dir(out_dir)
    changed_files = detect_meaningful_changes(before_snap, after_snap)

    if not changed_files and not force:
        # Restaurar instantánea previa para no ensuciar el árbol Git solo por generated_at
        if before_snap:
            restore_snapshot(out_dir, before_snap)
        print("[OK] Los datos meteorológicos ya están al día (0 cambios nuevos detectados).")
        if dispatch:
            trigger_repository_dispatch()
        return True, []

    if force and not changed_files:
        changed_files = sorted(after_snap.keys())

    print(f"[INFO] Se detectaron actualizaciones en {len(changed_files)} archivo(s): {', '.join(changed_files)}")

    if not skip_tests:
        print("[INFO] Ejecutando suite de pruebas automatizadas antes de confirmar cambios...")
        if not run_test_suite():
            print("[ERROR] La suite de pruebas falló; se restauran los JSONs previos.", file=sys.stderr)
            if before_snap:
                restore_snapshot(out_dir, before_snap)
            return False, []

    last_obs_date = ""
    if "index.json" in after_snap:
        last_obs_date = str(
            after_snap["index.json"][1].get("series_overview", {}).get("last_consolidated_date", "")
        )

    if commit or push:
        if not commit_and_push_changes(out_dir, changed_files, push=push, last_date=last_obs_date):
            return False, changed_files

    if dispatch:
        if not trigger_repository_dispatch(client_payload={"last_consolidated_date": last_obs_date}):
            return False, changed_files

    return True, changed_files


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Sincroniza, valida y publica de forma atómica los datos de MeteoRiotuerto Web."
    )
    parser.add_argument(
        "--source-dir",
        type=str,
        default=None,
        help="Ruta local al repositorio primario meteoriotuerto (por defecto busca ../meteoriotuerto o descarga de GitHub).",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default=str(ROOT_DIR / "data"),
        help="Directorio de salida de los productos JSON (por defecto: data/).",
    )
    parser.add_argument(
        "--cache-dir",
        type=str,
        default=str(ROOT_DIR / ".cache" / "meteoriotuerto"),
        help="Directorio de caché para descargas remotas.",
    )
    parser.add_argument(
        "--skip-tests",
        action="store_true",
        help="Omitir la ejecución completa de unittest tras validar los JSONs.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Forzar la actualización de marcas temporales aunque no hayan cambiado las series.",
    )
    parser.add_argument(
        "--commit",
        action="store_true",
        help="Crear un commit Git automáticamente si se detectan nuevos datos.",
    )
    parser.add_argument(
        "--push",
        action="store_true",
        help="Crear un commit Git y hacer push a 'origin main' si se detectan nuevos datos.",
    )
    parser.add_argument(
        "--dispatch",
        action="store_true",
        help="Enviar además un evento repository_dispatch a GitHub Actions.",
    )
    parser.add_argument(
        "--dispatch-only",
        action="store_true",
        help="Enviar únicamente el evento repository_dispatch a GitHub API sin procesar localmente.",
    )

    args = parser.parse_args()

    if args.dispatch_only:
        ok = trigger_repository_dispatch()
        sys.exit(0 if ok else 1)

    src_path = Path(args.source_dir).resolve() if args.source_dir else None
    ok, _ = sync_all(
        source_dir=src_path,
        output_dir=Path(args.output_dir),
        cache_dir=Path(args.cache_dir),
        skip_tests=args.skip_tests,
        force=args.force,
        commit=args.commit or args.push,
        push=args.push,
        dispatch=args.dispatch,
    )
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
