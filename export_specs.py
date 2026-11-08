#!/usr/bin/env python3
"""One-off: dump generate_variated_tile_sets.py's data constants to specs/*.json.

Imports the live module (so tuples/sets/mutations are captured as they are at
runtime) and writes the four spec files. Throwaway tool - not committed.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "tools" / "tile-generator" / "generate_variated_tile_sets.py"
OUT = ROOT / "tools" / "tile-generator" / "specs"

VERSION = 1


def conv(v):
    if isinstance(v, (set, frozenset)):
        return sorted(v)
    if isinstance(v, tuple):
        return [conv(x) for x in v]
    if isinstance(v, list):
        return [conv(x) for x in v]
    if isinstance(v, dict):
        return {str(k): conv(x) for k, x in v.items()}
    if isinstance(v, (str, int, float, bool)) or v is None:
        return v
    raise TypeError(f"cannot serialise {type(v).__name__}: {v!r}")


def grab(mod, *names):
    out = {}
    for n in names:
        if not hasattr(mod, n):
            raise AttributeError(f"module has no constant {n}")
        out[n] = conv(getattr(mod, n))
    return out


def main() -> int:
    spec = importlib.util.spec_from_file_location("genvts", SRC)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    assets = {
        "version": VERSION,
        "terrains": {
            "order": conv(mod.TERRAINS),
            "variants": conv(mod.TERRAIN_VARIANTS),
            "variantNotes": conv(mod.TERRAIN_VARIANT_NOTES),
        },
        "features": {
            "order": conv(mod.FEATURE_STEM_ORDER),
            "optional": conv(mod.FEATURE_OPTIONAL_STEMS),
            "textOnly": conv(mod.FEATURE_TEXT_ONLY_STEMS),
            "inputGlob": conv(mod.FEATURE_INPUT_GLOB),
            "outputNames": conv(mod.FEATURE_OUTPUT_NAMES),
            "stemSpecs": conv(mod.FEATURE_STEM_SPECS),
            "subjectMode": conv(mod.FEATURE_SUBJECT_MODE),
            "rolls": {
                "MOUNTAIN_ATMOSPHERE": conv(mod.MOUNTAIN_ATMOSPHERE),
                "MOUNTAIN_CRAZY": conv(mod.MOUNTAIN_CRAZY),
            },
        },
        "units": {
            "order": conv(mod.UNIT_KEY_ORDER),
            "stems": conv(mod.UNIT_STEM_ORDER),
            "variants": conv(mod.UNIT_VARIANTS),
            "wide": conv(mod.UNIT_WIDE_STEMS),
            "svgFiles": conv(mod.UNIT_SVG_FILES),
        },
    }

    slots = grab(
        mod,
        "COLOR_WORDS",
        "_MASS_NOUNS",
        "_IRREGULAR_PLURALS",
        "GLOBAL_THEME_FORBIDDEN",
        "GLOBAL_SLOT_SPECS",
        "TERRAIN_SLOT_SPECS",
        "FEATURE_SLOT_SPECS",
        "GLOBAL_FALLBACKS",
        "TERRAIN_FALLBACKS",
        "TERRAIN_IDENTITIES",
        "TERRAIN_ANCHORS",
        "TERRAIN_FORBIDDEN",
        "TERRAIN_PALETTE_ANCHORS",
        "TERRAIN_IDENTITY_CLAUSE",
        "TERRAIN_MATERIAL_SLOTS",
        "TERRAIN_COLOR_FORBIDDEN",
        "TERRAIN_EXTRA_CONSTRAINTS",
        "TERRAIN_BASE_CONSTRAINT",
        "FEATURE_SPECS",
        "FEATURE_FORBIDDEN",
        "FEATURE_KIND_FORBIDDEN",
        "UNIT_SPECS",
    )
    slots["version"] = VERSION

    templates = {
        "version": VERSION,
        "terrain": {
            "prompt": mod.TERRAIN_PROMPT,
            "subject": mod.TERRAIN_SUBJECT_TEMPLATE,
            "details": mod.TERRAIN_DETAILS_TEMPLATE,
        },
        "feature": {
            "prompt": mod.FEATURE_PROMPT,
            "subject": mod.FEATURE_SUBJECT_TEMPLATE,
            "details": mod.FEATURE_DETAILS_TEMPLATE,
            "artDirection": mod.FEATURE_ART_DIRECTION,
        },
        "unit": {
            "prompt": mod.UNIT_PROMPT,
            "details": mod.UNIT_DETAILS_TEMPLATE,
            "artDirection": mod.UNIT_ART_DIRECTION,
            "reliableLight": mod._UNIT_RELIABLE_LIGHT,
            "reliableRender": mod._UNIT_RELIABLE_RENDER,
        },
        "clauses": {
            "themeAccent": mod.THEME_ACCENT_CLAUSE,
            "styleKeys": conv(mod.STYLE_KEYS),
            "styleDescriptions": conv(mod.STYLE_DESCRIPTIONS),
        },
    }

    negatives = {
        "version": VERSION,
        "terrain": mod.NEGATIVE_TERRAIN,
        "feature": mod.NEGATIVE_FEATURE,
        "unit": mod.NEGATIVE_UNIT,
        "unitExtra": conv(mod.UNIT_NEGATIVE_EXTRA),
    }

    OUT.mkdir(parents=True, exist_ok=True)
    for name, data in (
        ("assets", assets),
        ("slots", slots),
        ("templates", templates),
        ("negatives", negatives),
    ):
        path = OUT / f"{name}.json"
        path.write_text(json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False) + "\n")
        print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
