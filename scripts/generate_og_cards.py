#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
===============================================================================
generate_og_cards.py — Generador de tarjetas de previsualización social (EVO-037)
===============================================================================
Genera tarjetas canónicas de previsualización social (Open Graph y Twitter Cards)
con resolución estándar 1200 × 630 px para cada sección y anuario del archivo.

Lee `data/index.json` y `data/almanac_YYYY.json` para incorporar indicadores
climáticos reales y titulares de autor en las imágenes de cada año.

Uso:
  python3 scripts/generate_og_cards.py
  python3 scripts/generate_og_cards.py --output-dir assets/img/og
===============================================================================
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

from PIL import Image, ImageDraw, ImageFont

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT_DIR = SCRIPT_DIR.parent
DEFAULT_OUT_DIR = ROOT_DIR / "assets" / "img" / "og"
DATA_DIR = ROOT_DIR / "data"

WIDTH = 1200
HEIGHT = 630

# Paleta cromática oficial de MeteoRiotuerto
BG_TOP = (8, 28, 21)        # #081c15 verde noche profundo
BG_BOTTOM = (15, 41, 30)    # #0f291e verde bosque oscuro
ACCENT_GREEN = (16, 185, 129) # #10b981 verde esmeralda
ACCENT_AMBER = (245, 158, 11) # #f59e0b ámbar
TXT_WHITE = (255, 255, 255)
TXT_MUTED = (167, 243, 208)   # #a7f3d0 menta claro
TXT_SUB = (209, 213, 219)     # gris claro


def get_font(size: int, bold: bool = False, mono: bool = False) -> ImageFont.ImageFont:
    """Intenta cargar fuentes DejaVu del sistema con fallback seguro."""
    font_paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf" if mono else
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans.ttf",
        "/Library/Fonts/Arial.ttf",
        "C:\\Windows\\Fonts\\arial.ttf",
    ]
    for p in font_paths:
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()


def create_base_canvas() -> Tuple[Image.Image, ImageDraw.ImageDraw]:
    """Crea el lienzo base 1200x630 con degradado vertical sutil y marco perimetral."""
    img = Image.new("RGB", (WIDTH, HEIGHT), BG_TOP)
    draw = ImageDraw.Draw(img)

    # Degradado vertical suave
    for y in range(HEIGHT):
        factor = y / HEIGHT
        r = int(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * factor)
        g = int(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * factor)
        b = int(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * factor)
        draw.line([(0, y), (WIDTH, y)], fill=(r, g, b))

    # Marco perimetral institucional con esquinas redondeadas
    draw.rectangle([20, 20, WIDTH - 20, HEIGHT - 20], outline=ACCENT_GREEN, width=2)
    draw.rectangle([24, 24, WIDTH - 24, HEIGHT - 24], outline=(16, 185, 129, 60), width=1)

    # Cabecera institucional
    font_kicker = get_font(18, bold=True)
    draw.text((50, 48), "🌲 METEORIOTUERTO · ALMANAQUE METEOROLÓGICO Y CLIMATOLÓGICO", fill=ACCENT_GREEN, font=font_kicker)

    font_geo = get_font(15, bold=False)
    geo_text = "Barrio de Arriba · Riotuerto (Cantabria) · 43,341° N, 3,670° O · 115 m s. n. m."
    draw.text((50, 76), geo_text, fill=TXT_MUTED, font=font_geo)

    draw.line([(50, 108), (WIDTH - 50, 108)], fill=(16, 185, 129), width=1)

    # Pie de página institucional
    draw.line([(50, HEIGHT - 76), (WIDTH - 50, HEIGHT - 76)], fill=(50, 80, 68), width=1)
    font_footer = get_font(14, bold=False)
    footer_text = "Estación Meteorológica Barrio de Arriba · https://egofer.github.io/meteoriotuerto-web/ · Licencia CC BY 4.0"
    draw.text((50, HEIGHT - 54), footer_text, fill=TXT_MUTED, font=font_footer)

    return img, draw


def generate_almanac_card(year: int, alm_data: Dict[str, Any], out_path: Path) -> None:
    """Genera tarjeta Open Graph para un almanaque anual específico con sus métricas reales."""
    img, draw = create_base_canvas()

    headline_map = {
        2022: "Año cálido y seco con estío prolongado y marcadas suradas otoñales",
        2023: "Grandes contrastes: el temporal Fien (509,8 mm en enero) y acusada sequía estival",
        2024: "Récord absoluto de calor (42,1 °C) y temporales atlánticos de viento sur",
        2025: "Pluviosidad abundante y gran regularidad estacional en el valle",
        2026: "Avance provisional del año en curso (registro consolidado hasta octubre)",
    }
    headline = headline_map.get(year, f"Anuario meteorológico y climatológico completo de {year}")

    # Título grande de año
    font_year = get_font(64, bold=True)
    draw.text((50, 125), f"ALMANAQUE {year}", fill=TXT_WHITE, font=font_year)

    # Etiqueta de tipo
    badge_text = "ANUARIO COMPLETO" if not alm_data.get("is_provisional") else "REGISTRO PROVISIONAL"
    font_badge = get_font(16, bold=True)
    draw.rounded_rectangle([620, 138, 860, 178], radius=6, fill=ACCENT_GREEN)
    draw.text((635, 147), badge_text, fill=(8, 28, 21), font=font_badge)

    # Titular editorial sinóptico
    font_headline = get_font(22, bold=False)
    # Partir titular largo si es necesario
    if len(headline) > 65:
        p1 = headline[:65].rsplit(" ", 1)[0]
        p2 = headline[len(p1):].strip()
        draw.text((50, 205), f"«{p1}", fill=ACCENT_AMBER, font=font_headline)
        draw.text((65, 235), f"{p2}»", fill=ACCENT_AMBER, font=font_headline)
        box_y = 285
    else:
        draw.text((50, 210), f"«{headline}»", fill=ACCENT_AMBER, font=font_headline)
        box_y = 265

    # Cajas con 4 métricas anuales destacadas
    stats = alm_data.get("stats", {})
    t_mean = stats.get("temp", {}).get("mean_annual")
    t_max = stats.get("temp", {}).get("max_absolute")
    rain_tot = stats.get("rain", {}).get("total_annual")
    rain_days = stats.get("rain", {}).get("rain_days_0_2mm")
    wind_max = stats.get("wind", {}).get("gust_max_absolute")

    metrics = [
        ("TEMP. MEDIA", f"{t_mean:.1f} °C" if t_mean is not None else "—", "Promedio anual"),
        ("EXTREMOS", f"{t_max:.1f} °C" if t_max is not None else "—", "Máxima del año"),
        ("PRECIPITACIÓN", f"{rain_tot:.1f} mm" if rain_tot is not None else "—", f"{rain_days or '—'} días lluvia"),
        ("RACHA MÁXIMA", f"{wind_max:.1f} km/h" if wind_max is not None else "—", "Viento sur / Foehn"),
    ]

    card_w = 260
    card_h = 160
    gap = 20
    start_x = 50

    font_m_label = get_font(14, bold=True)
    font_m_val = get_font(32, bold=True, mono=True)
    font_m_sub = get_font(13, bold=False)

    for i, (label, val, sub) in enumerate(metrics):
        cx = start_x + i * (card_w + gap)
        # Fondo de la tarjeta
        draw.rounded_rectangle([cx, box_y, cx + card_w, box_y + card_h], radius=8, fill=(18, 54, 40), outline=(30, 80, 60), width=1)
        # Etiqueta
        draw.text((cx + 18, box_y + 16), label, fill=TXT_MUTED, font=font_m_label)
        # Valor grande
        draw.text((cx + 18, box_y + 50), val, fill=TXT_WHITE, font=font_m_val)
        # Subtexto
        draw.text((cx + 18, box_y + 115), sub, fill=TXT_SUB, font=font_m_sub)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, format="JPEG", quality=90, optimize=True)


def generate_section_card(
    title: str,
    subtitle: str,
    badge: str,
    description: str,
    highlights: List[Tuple[str, str]],
    out_path: Path,
) -> None:
    """Genera tarjeta Open Graph para una sección temática principal."""
    img, draw = create_base_canvas()

    # Título principal
    font_title = get_font(48, bold=True)
    draw.text((50, 130), title, fill=TXT_WHITE, font=font_title)

    # Distintivo
    if badge:
        font_badge = get_font(15, bold=True)
        bw = len(badge) * 11 + 24
        draw.rounded_rectangle([WIDTH - 50 - bw, 138, WIDTH - 50, 178], radius=6, fill=ACCENT_GREEN)
        draw.text((WIDTH - 50 - bw + 12, 147), badge, fill=(8, 28, 21), font=font_badge)

    # Subtítulo
    font_sub = get_font(22, bold=False)
    draw.text((50, 205), subtitle, fill=ACCENT_AMBER, font=font_sub)

    # Descripción
    font_desc = get_font(18, bold=False)
    draw.text((50, 250), description, fill=TXT_SUB, font=font_desc)

    # 3 Cajas temáticas
    box_y = 310
    card_w = 345
    card_h = 175
    gap = 32
    start_x = 50

    font_h_title = get_font(17, bold=True)
    font_h_body = get_font(14, bold=False)

    for i, (h_title, h_body) in enumerate(highlights[:3]):
        cx = start_x + i * (card_w + gap)
        draw.rounded_rectangle([cx, box_y, cx + card_w, box_y + card_h], radius=8, fill=(18, 54, 40), outline=(30, 80, 60), width=1)
        draw.text((cx + 18, box_y + 18), h_title, fill=TXT_MUTED, font=font_h_title)

        # Dividir líneas de cuerpo
        words = h_body.split(" ")
        lines = []
        cur = []
        for w in words:
            cur.append(w)
            if len(" ".join(cur)) > 34:
                cur.pop()
                lines.append(" ".join(cur))
                cur = [w]
        if cur:
            lines.append(" ".join(cur))

        for l_idx, line in enumerate(lines[:4]):
            draw.text((cx + 18, box_y + 55 + l_idx * 24), line, fill=TXT_WHITE, font=font_h_body)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, format="JPEG", quality=90, optimize=True)


def build_all_og_cards(out_dir: Path) -> List[Path]:
    """Genera el catálogo completo de tarjetas de previsualización social."""
    out_dir.mkdir(parents=True, exist_ok=True)
    generated: List[Path] = []

    # 1. Portada / Institucional
    p_portada = out_dir / "og-portada.jpg"
    generate_section_card(
        title="METEORIOTUERTO",
        subtitle="Notario del clima y archivo meteorológico digital de Riotuerto",
        badge="SERIE 2022–2026",
        description="Conservación, análisis y memoria de la estación meteorológica en Barrio de Arriba (Cantabria).",
        highlights=[
            ("📊 Almanaques Anuales", "Crónicas climáticas, climogramas, rosa de los vientos 360° y balances hídricos anuales."),
            ("🌪️ Acontecimientos Extremos", "Catálogo de temporales de viento sur, borrascas históricas y récords absolutos."),
            ("🌱 Utilidad Cotidiana", "Calendario agroclimático vecinal, labores del campo, alertas de mildiu y festividades."),
        ],
        out_path=p_portada,
    )
    generated.append(p_portada)

    # 2. Almanaques anuales individuales (2022 a 2026)
    for year in [2022, 2023, 2024, 2025, 2026]:
        alm_file = DATA_DIR / f"almanac_{year}.json"
        alm_data: Dict[str, Any] = {}
        if alm_file.exists():
            try:
                alm_data = json.loads(alm_file.read_text(encoding="utf-8"))
            except Exception:
                pass
        p_alm = out_dir / f"og-almanaque-{year}.jpg"
        generate_almanac_card(year, alm_data, p_alm)
        generated.append(p_alm)

    # 3. Récords y acontecimientos
    p_rec = out_dir / "og-records.jpg"
    generate_section_card(
        title="RÉCORDS Y EXTREMOS",
        subtitle="Grandes acontecimientos y efemérides meteorológicas de Riotuerto",
        badge="TOP 10 HISTÓRICO",
        description="Techos y suelos de temperatura, intensidad de lluvia torrencial y vendavales de viento sur.",
        highlights=[
            ("🔥 Techo Térmico", "Récord histórico de 42,1 °C registrado durante la ola de calor del 11 de agosto de 2024."),
            ("🌧️ Máxima Pluviómetrica", "125,9 mm en 24 h (Borrasca Fien 2023) y temporal con 509,8 mm en enero."),
            ("💨 Racha Huracanada", "97,2 km/h con viento sur en la borrasca Karlotta del 8 de febrero de 2024."),
        ],
        out_path=p_rec,
    )
    generated.append(p_rec)

    # 4. Comparativas interanuales
    p_comp = out_dir / "og-comparativas.jpg"
    generate_section_card(
        title="COMPARATIVAS INTERANUALES",
        subtitle="Marcha climatológica, anomalías plurianuales y balance del valle",
        badge="2022 vs 2026",
        description="Comparador interactivo cara a cara, matrices estacionales canónicas y balance hídrico del suelo.",
        highlights=[
            ("⚖️ Cara a Cara (H2H)", "Duelo meteorológico directo entre cualquier pareja de años o meses del registro."),
            ("💧 Balance Hídrico", "Evapotranspiración FAO-56, recarga de acuíferos y balance neto del suelo."),
            ("🍁 Climatología OMM", "Análisis trimestral DJF, MAM, JJA y SON con anomalías sobre la serie 2022–2025."),
        ],
        out_path=p_comp,
    )
    generated.append(p_comp)

    # 5. Riotuerto Cotidiano
    p_cot = out_dir / "og-cotidiano.jpg"
    generate_section_card(
        title="RIOTUERTO COTIDIANO",
        subtitle="Guía agroclimática para el campo, huerta, ganado y festividades",
        badge="UTILIDAD VECINAL",
        description="Información práctica basada en grados día, umbrales bioclimáticos y fenología local.",
        highlights=[
            ("🔥 Calderas y Calefacción", "Grados día HDD 15,5 °C para estimar gasto de leña y conmutación a ACS."),
            ("🚜 Siega y Césped", "Cero vegetativo de 10 °C para el robot cortacésped y ventanas secas de forraje."),
            ("🎉 Fiestas y Tradiciones", "Historial meteorológico y probabilidad de lluvia en las 8 fiestas del municipio."),
        ],
        out_path=p_cot,
    )
    generated.append(p_cot)

    # 6. Explorador de datos
    p_exp = out_dir / "og-explorador.jpg"
    generate_section_card(
        title="EXPLORADOR DE SERIES",
        subtitle="Herramienta científica de consulta, filtrado y exportación tabular",
        badge="DATOS ABIERTOS",
        description="Acceso libre a las series diarias y semihorarias con gráficos interactivos y descarga en CSV/JSON/Excel.",
        highlights=[
            ("📈 Gráfica Interactiva", "Visualización multivariable continua con selección de rangos temporales libres."),
            ("🗓️ Superposición Multianual", "Contraste simultáneo de los 5 años en un ciclo anual común de 366 días."),
            ("📊 Exportación SheetJS", "Descarga de libros Excel (.xlsx) estructurados con tipado numérico real."),
        ],
        out_path=p_exp,
    )
    generated.append(p_exp)

    # 7. Metodología
    p_met = out_dir / "og-metodologia.jpg"
    generate_section_card(
        title="METODOLOGÍA Y CALIDAD",
        subtitle="Transparencia científica, instrumentación y catálogo abierto",
        badge="RFC 7946 GEOJSON",
        description="Documentación del emplazamiento en Barrio de Arriba, auditoría anual y capa geográfica SIG.",
        highlights=[
            ("📍 Emplazamiento Oficial", "43,341° N, 3,670° O a 115 m en pradera abierta del valle del río Covadal."),
            ("🗺️ Capa SIG GeoJSON", "Ficha técnica estandarizada para QGIS/ArcGIS con hitos topográficos del valle."),
            ("📋 Diccionario Schema", "Esquema JSON Schema Draft 2020-12 con tipado estricto de 19 magnitudes."),
        ],
        out_path=p_met,
    )
    generated.append(p_met)

    # 8. Glosario
    p_glo = out_dir / "og-glosario.jpg"
    generate_section_card(
        title="GLOSARIO METEOROLÓGICO",
        subtitle="Definiciones divulgativas del microclima de Riotuerto y Cantabria",
        badge="36 CONCEPTOS",
        description="Conceptos termodinámicos, orográficos y bioclimáticos explicados para el público general.",
        highlights=[
            ("🔥 Viento Sur y Foehn", "Compresión adiabática y calentamiento súbito a sotavento de la cordillera."),
            ("🌱 Bioclimatología", "Grados día HDD/CDD/GDD, evapotranspiración y confort bioclimático."),
            ("🌧️ Dinámica Cantábrica", "Lluvia orográfica, frentes atlánticos y galernas del litoral septentrional."),
        ],
        out_path=p_glo,
    )
    generated.append(p_glo)

    return generated


def main() -> None:
    parser = argparse.ArgumentParser(description="Genera las tarjetas sociales canónicas Open Graph de MeteoRiotuerto.")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUT_DIR, help="Directorio de destino.")
    args = parser.parse_args()

    cards = build_all_og_cards(args.output_dir)
    print(f"[OK] Generadas con éxito {len(cards)} tarjetas Open Graph en {args.output_dir.resolve()}:")
    for c in cards:
        size_kb = c.stat().st_size / 1024
        print(f"  - {c.name} ({size_kb:.1f} KB)")


if __name__ == "__main__":
    main()
