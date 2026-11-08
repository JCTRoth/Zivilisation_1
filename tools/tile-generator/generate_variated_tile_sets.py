#!/usr/bin/env python3
"""Generate N variated tile-set folders (terrain tiles + feature sprites).

Everything that reaches the image model is *abstract* first: the prompt
templates contain ``#KEYWORD#`` slots and nothing else.  At run time the local
Qwen model (llama-server) resolves every slot with a fresh, concrete English
phrase, so every run of this script produces a genuinely different asset set.

Per iteration:

  1. Qwen invents the iteration-wide *global* slots (theme phrase, shared
     palette, shared lighting mood).  They are used by every tile and sprite
     of that iteration, so the set reads as one coherent art-direction pass.
  2. For every terrain the *abstract* terrain template (subject + details with
     ``#KEYWORD#`` slots) is resolved by Qwen into concrete phrases.  The
     terrain identity ("a temperate forest floor") is a hard constraint, so a
     forest tile can never degrade into a desert.
   3. For every feature the *abstract* feature template is resolved the same
      way.  Stems with a feature-only input picture (``fish1.png``,
      ``hill...``) are rendered from it (flattened onto pure black) via
      img2img, so the sprite keeps the identity of the input artwork; all
      other stems are composed purely from the prompt onto the black sprite
      background. Features and game units are separately selectable, prompted,
      recorded in their own manifest section and written to separate folders.
   4. Every unit shares a serious hand-drawn anime / graphic-novel strategy
      illustration direction; unit-specific prompts prioritize its identity
      and clear game-icon silhouette.
   5. The sampled border background color of every sprite is keyed out to a
      transparent alpha channel.

Per iteration the feature set is: five fish, two proud wild horses (one or
more horses allowed, every horse anatomically correct with all four legs,
gentle motion fine), three forests (terrain_forest_feature_1 mixed /
_2 coniferous / _3 deciduous), the jungle group with lianas, hills, swamp,
FOUR always-rendered mountain variants (terrain_mountains_feature_1..4:
several peaks / a dramatic variant with a rolled crazy extra - erupting
lava, crystals, ... - twin peaks, a long ridge; each variant rolls its own
atmosphere: sometimes fog, sometimes snow, sometimes clear), plus the seven
special resources that previously only had
icon glyphs (seal, gems, gold, coal, oil, game, oasis).  AND THREE sprite
variants for every unit of the game (unit_<key>.png, unit_<key>_2.png,
unit_<key>_3.png): units with real SVG artwork (src/assets/units) are
rendered img2img from it, the rest are rendered from their fixed
descriptions in UNIT_SPECS; single-figure units carry a positively phrased
limb-completeness clause, while group compositions get tailored guidance.

With ``--theme-keyword`` (/t/ THEME_KEYWORD) a theme may add sparse small
accents only. Terrain materials, natural palettes, animal/unit identities,
and neutral lighting remain unchanged.

With ``--style-keyword`` (STYLE_KEYWORD) one art style (a STYLE_KEYS name
such as american_comic or manga, or a freeform phrase) changes only HOW every
asset is rendered - technique, linework and medium - while every subject
identity stays untouched; ``--unit-style-keyword`` (UNIT_STYLE_KEYWORD) does
the same for the game unit sprites alone (``original_game_icons`` renders them
in the original game's flat vector icon look);
``--write-batch --batch-style-mode`` writes a whole style tour (add
``--batch-terrains``/``--batch-features`` to pin one selection across all
jobs).

With ``--write-batch`` the generator writes a bash script that runs one
tile-set job after another (one per comma-separated keyword, '' = classic
run), so a whole campaign can run unattended in the background.

Result: ``<output-root>/<label>_<unix-timestamp>/iteration_01 .. iteration_N``
each containing ``tiles/``, ``features/`` (resource/terrain feature sprites)
and ``units/`` (game unit sprites), with transparent backgrounds. Per-iteration
``keywords_*.json`` files log the concrete phrases used for each abstract slot.
Every terrain renders ``TERRAIN_VARIANTS`` (3) sibling ground tiles
(``terrain_<terrain>.png`` plus ``_1``/``_2``) that share one palette and one
light but differ in pattern arrangement, so neighbouring cells of one terrain
never repeat a single image.

Features are NEVER painted onto terrain tiles here - composition is done
elsewhere (``compose_feature_tiles.mjs``); this script only produces the
clean, complete asset set.

Usage:
  python3 tools/tile-generator/generate_variated_tile_sets.py --iterations 10
  python3 tools/tile-generator/generate_variated_tile_sets.py --dry-run
  ITERATIONS=5 STEPS=6 python3 ... (env overrides also work)
  python3 ... --theme-keyword Halloween --iterations 1
  python3 ... --write-batch "Halloween,Transylvania and vampires,Christmas,Easter,,,"
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import random
import re
import shlex
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections import deque
from pathlib import Path
from typing import Any, Callable

import numpy as np
from PIL import Image


import abstract_generator as _abstract
from abstract_generator import (
    FEATURE_INPUT_GLOB,
    FEATURE_OPTIONAL_STEMS,
    FEATURE_OUTPUT_NAMES,
    FEATURE_SPECS,
    FEATURE_STEM_SPECS,
    FEATURE_SUBJECT_MODE,
    FEATURE_TEXT_ONLY_STEMS,
    GLOBAL_FALLBACKS,
    GLOBAL_SLOT_SPECS,
    GLOBAL_THEME_FORBIDDEN,
    LLAMA_LOG,
    LLAMA_PORT,
    LLAMA_SERVER_BIN,
    MOUNTAIN_ATMOSPHERE,
    MOUNTAIN_CRAZY,
    NEGATIVE_FEATURE,
    NEGATIVE_TERRAIN,
    NEGATIVE_UNIT,
    QWEN_MODEL,
    SPEC_VERSION,
    SpecError,
    TERRAINS,
    TERRAIN_COLOR_FORBIDDEN,
    TERRAIN_VARIANTS,
    TERRAIN_VARIANT_NOTES,
    THEME_ACCENT_CLAUSE,
    UNIT_KEY_ORDER,
    UNIT_NEGATIVE_EXTRA,
    UNIT_SPECS,
    UNIT_STEM_ORDER,
    UNIT_SVG_FILES,
    UNIT_VARIANTS,
    UNIT_WIDE_STEMS,
    VariationRegistry,
    _UNIT_RELIABLE_LIGHT,
    _UNIT_RELIABLE_RENDER,
    _strip_article,
    build_feature_prompt,
    build_terrain_prompt,
    http_ok,
    human,
    load_specs,
    resolve_slot_bundle,
    resolve_style,
    resolve_theme,
    roll_weighted,
    select_feature_stems,
    select_unit_stems,
    start_process,
    stop_process,
    style_clauses,
    wait_for,
)

try:  # optional - only used for fast inpainting / connected components
    import cv2
except Exception:  # pragma: no cover - cv2 is optional
    cv2 = None

ROOT = Path(__file__).resolve().parents[2]
TILE_GEN = ROOT / "tools" / "tile-generator"
PUBLIC_TILES = ROOT / "public" / "assets" / "tiles"
FEATURE_RESOURCES = ROOT / "src" / "assets" / "resources"

SD_SERVER_BIN = Path(os.environ.get(
    "SD_SERVER_BIN",
    "/home/jonas/Schreibtisch/Image_to_Image/GPZ/New/stable-diffusion.cpp/build/bin/sd-server",
))
SD_DIFFUSION = Path(os.environ.get(
    "SD_DIFFUSION", "/home/jonas/Downloads/flux-2-klein-4b-Q4_K_S.gguf"
))
SD_VAE = Path(os.environ.get(
    "SD_VAE",
    "/home/jonas/Schreibtisch/Image_to_Image/GPZ/New/split_files/vae/flux2-vae.safetensors",
))
SD_LLM = Path(os.environ.get(
    "SD_LLM", "/home/jonas/git/Local_AI/models/main_model/Qwen3-4B-Q4_K_M.gguf"
))


SD_PORT = int(os.environ.get("SD_PORT", "8081"))

SD_LOG = os.environ.get("SD_LOG", "/tmp/sd_server_variate.log")

REMBG = shutil.which("rembg") or "/home/jonas/.local/bin/rembg"

# --- background removal ---------------------------------------------------
#
# The sprite background is removed with a flood fill that starts at the image
# border.  The "level" decides how dark a pixel has to be to count as
# background:
#
#   level ...... 0-255, the black point.  A pixel is background when its
#                brightest channel is below the level *and* its darkest
#                channel is below half the level - the background has to be
#                really black, so a dark but coloured subject (a deep blue
#                fish, a dark green canopy) is never eaten away.
#   softness ... 0-255, the width of the anti-aliasing ramp.  The ring of
#                pixels around the removed background fades in instead of
#                being cut off with a hard, jagged edge.  0 = hard edge.
#
# Both are adjustable from the command line, so the cut can be tuned without
# touching the code.
BG_LEVEL = 28
BG_SOFTNESS = 30

# Every image is copied into a "backup" folder next to it before its
# background is removed.  Folders named "backup" are never processed.
BACKUP_DIR_NAME = "backup"


# ===========================================================================
# Prompt structure (matches the project art direction)
#   Title line .......: "seamless, tileable texture of ..."
#   Style & Art ......: selected game art style
#   Subject Details ..: concrete description of what is across the surface
#   Technical Specs ..: orthographic top-down camera, full-bleed, no framing
#   Negative prompt ..: photorealism / backgrounds / framing artifacts
#
# The {subject} and {details} parts are built from the abstract #KEYWORD#
# templates further down - they are never hard-coded.
# ===========================================================================








# ===========================================================================
# ABSTRACT SLOT SYSTEM
#
# Every prompt is a template full of #KEYWORD# slots.  The local Qwen model
# resolves every slot with a fresh concrete phrase - per terrain AND per
# iteration - while hard identity constraints keep the subject recognisable.
#
#   global slots   (one call per iteration, shared by the whole set)
#     THEME_PHRASE    the art-direction mood of the set
#     GLOBAL_PALETTE  shared colour mood
#     GLOBAL_LIGHTING shared lighting mood
#
#   terrain slots  (one call per terrain)
#     SURFACE_FORM    macro shape / kind of terrain
#     BASE_MATERIAL   dominant ground material
#     TEXTURE_DETAIL  broad, low-frequency ground pattern
#     ACCENT_ELEMENT  scattered decorations on the surface
#     EDGE_ELEMENT    ordinary surface continuation at image boundaries
#     LIGHTING_NOTE   light / shadow / mood sentence
#     COLOR_PALETTE   concrete colour range of this terrain
#
#   feature slots  (one call per feature)
#     FEATURE_KIND    what the feature is (anchored by the feature identity)
#     FEATURE_FORM    shape, pose and silhouette
#     FEATURE_DETAIL  surface detail, markings, texture
#     FEATURE_PALETTE concrete colour range
#     FEATURE_LIGHTING light treatment
#     FEATURE_RENDERING rendering treatment (outlines / shading)
#
# Safety nets - the run never breaks because of a slot:
#   * a robust JSON extractor (code fences, trailing commas, broken braces,
#     per-key regex fallback),
#   * per-slot re-ask when the model returns something unusable,
#   * per-slot fallback phrase,
#   * an anchor check that rejects a slot which drifts away from the subject.
# ===========================================================================




# The lighting slot must talk about light - a bare colour list is a palette,
# not a lighting mood.  The check is done by ``looks_like_color_list()``,
# which is softer than an anchor list and never throws a good phrase away.

# ``theme: False`` marks a slot that must describe the *physical* surface
# only - the theme must never leak into it (that is what turned a forest into
# a battlefield or an ocean into an ice field).
_TERRAIN_FRAME_BANS = [
    "border", "rim", "frame", "ring", "halo", "vignette", "shoreline",
    "beach", "dark corners", "white perimeter", "gradient edge",
]


# --- hard identities: the local model must never drift away from these -----



# Words that must NOT show up in a resolved terrain slot - this is what stops
# an ocean from turning into an ice field or a forest into a battlefield.
# The "no ice" set is added to every warm terrain, the "no water" set to the
# dry ones.
_NO_ICE = ["frozen", "icy", "glacier", "snowdrift", "permafrost"]
_NO_WATER = ["wade", "kayak", "canoe", "buoy", "anchor", "harbour", "harbor"]




# Words that are perfectly normal inside a colour or a light phrase.
_COLOR_SAFE_WORDS = {
    "rock", "leaf", "bark", "crack", "cracked", "cracks", "dry", "shell",
    "water", "wave", "waves", "grass",
}

_THEME_COLOR_FORBIDDEN = [
    "black", "crimson", "magenta", "purple", "violet", "lavender", "neon",
    "lurid", "spectral", "ghostly", "fluorescent", "electric", "glowing",
]
for _terrain in TERRAIN_COLOR_FORBIDDEN:
    TERRAIN_COLOR_FORBIDDEN[_terrain].extend(_THEME_COLOR_FORBIDDEN)
TERRAIN_COLOR_FORBIDDEN["ocean"].extend(["navy", "indigo", "deep", "dark"])
TERRAIN_COLOR_FORBIDDEN["grassland"].extend(
    ["dark", "deep", "muddy", "orange", "amber", "burnt", "pumpkin"])





# --- abstract terrain templates -------------------------------------------



# --- abstract feature templates -------------------------------------------




# --- fallback phrases (used whenever the model is unavailable/unusable) ----



# ===========================================================================
# FEATURES
#
# Feature inputs are feature-only pictures (no background).  The VTracer SVGs
# (fish.svg, horses*.svg) are full tile scenes with terrain backgrounds and
# are therefore never used as inputs.
#
# The search is recursive so the artwork can be organised in sub folders - but
# a folder named "backup" is skipped: it only holds the untouched originals.
# ===========================================================================









# ===========================================================================
# ART-STYLE keywords (--style-keyword)
#
# A style is NOT a theme: a theme may add sparse small accents; a style changes
# HOW everything is rendered (technique, linework, shading, medium). The
# selected subject identities stay completely untouched.  The style text is
# injected deterministically into both the terrain and the feature/unit
# prompt templates, so even fallback prompts carry it.
# ===========================================================================







# ===========================================================================
# UNITS
#
# One sprite for every unit of the game (src/data/UnitConstants.ts, 35 units).
# Units whose game icon is a real SVG artwork (UnitIconConfig -> the files in
# src/assets/units) are rendered img2img from that artwork, so the sprite
# keeps the identity of the picture the game actually uses.  All other units
# are rendered purely from the fixed descriptions in UNIT_SPECS below - the
# game's fallback emoji (recorded in the manifest for traceability) is mon-
# ochrome and often shows something else entirely (a top hat for the diplo-
# mat, a radiation sign for the nuclear missile), so emoji shapes are never
# fed to the image model.
#
# Output naming: unit_<game unit key>.png, e.g. unit_warrior.png.
# Naval and air units render on a landscape canvas (UNIT_WIDE_STEMS).
# ===========================================================================

UNIT_ICON_DIR = ROOT / "src" / "assets" / "units"
UNIT_CONSTANTS_PATH = ROOT / "src" / "data" / "UnitConstants.ts"




# Wooden horse-drawn stuff and camels need the same anatomy clause as the
# horse resource feature - saddle animals are easy for the model to break.
_UNIT_LEGS_CLAUSE = ("Every horse shown is anatomically correct and drawn "
                     "complete, with all four legs clearly visible.")
_UNIT_CAMEL_LEGS_CLAUSE = ("Every camel is anatomically correct and drawn "
                           "complete, with all four legs clearly visible.")


# Positively phrased limb completeness for every person / vehicle crew /
# animal of the units.  Deliberately NOT a hard anatomy audit ("five
# fingers", "exactly two legs"): that kind of clause makes FLUX over-correct
# and produce doubled or stiff limbs.  A clear complete-visibility stance
# clause reliably fixes cropped arms without the side effects.
_UNIT_LIMB_CLAUSE = ("Every arm and every leg is drawn completely, clearly "
                     "visible and in a natural easy stance, with no limb "
                     "hidden, cropped or cut by the frame edge.")


def _unit_spec(kind: str, anchors: list[str], form: str, detail: str,
               palette: str, *, identity: str | None = None,
               fixed: str | None = None,
               forbidden: list[str] | None = None,
               kind_help: str | None = None,
               subject_template: str | None = None,
               light: str = _UNIT_RELIABLE_LIGHT,
               rendering: str = _UNIT_RELIABLE_RENDER) -> dict[str, Any]:
    """Build one entry of UNIT_SPECS in the FEATURE_SPECS value shape."""
    spec: dict[str, Any] = {
        "unit": True,
        "identity": identity or f"the {kind} game unit",
        "kind_help": kind_help or (
            "one singular noun phrase naming the unit itself - one person, "
            "one vehicle, one ship or one machine, never a plural and never "
            "a whole army"),
        "fixed": fixed,
        "anchors": anchors,
        "forbidden": forbidden or [],
        "fallbacks": {
            "FEATURE_KIND": kind,
            "FEATURE_FORM": form,
            "FEATURE_DETAIL": detail,
            "FEATURE_PALETTE": palette,
            "FEATURE_LIGHTING": light,
            "FEATURE_RENDERING": rendering,
        },
    }
    if subject_template:
        spec["subject_template"] = subject_template
    return spec





def read_game_unit_keys() -> list[str]:
    """Every unit key the game defines in ``UNIT_TYPES`` (UnitConstants.ts).

    Returns [] when the game source cannot be read - the generator then
    falls back to its hand-maintained built-in list.
    """
    try:
        src = UNIT_CONSTANTS_PATH.read_text()
    except OSError:
        return []
    match = re.search(r"export const UNIT_TYPES\s*=\s*\{(.*?)\}\s*as const",
                      src, re.S)
    if not match:
        return []
    return re.findall(r":\s*'([a-z_0-9]+)'", match.group(1))


def sync_game_units() -> list[str]:
    """Fold every unit the game defines into the generator's unit set.

    The built-in ``UNIT_KEY_ORDER`` mirrors the shipped ruleset, but a unit
    added to ``UNIT_TYPES`` later would silently get no sprite. This picks
    new keys up automatically: a generic spec is written when the hand-tuned
    table has none yet, and an SVG named exactly after the key (even without
    a ``UNIT_SVG_FILES`` entry) turns it into an img2img source. Returns the
    keys that were picked up; [] means already in sync (or no game source).
    """
    game_keys = read_game_unit_keys()
    if not game_keys:
        print(f"[!] unit sync: {UNIT_CONSTANTS_PATH.name} unreadable - "
              f"generating the built-in set of {len(UNIT_KEY_ORDER)} units")
        return []
    known = set(UNIT_KEY_ORDER)
    dropped = [key for key in UNIT_KEY_ORDER if key not in set(game_keys)]
    if dropped:
        print(f"[!] unit sync: units the game does not define (typo?): "
              f"{', '.join(dropped)}")
    added: list[str] = []
    label = lambda key: key.replace("_", " ")  # noqa: E731
    for key in game_keys:
        if key in known:
            continue
        stem = f"unit_{key}"
        if stem not in UNIT_SPECS:
            UNIT_SPECS[stem] = _unit_spec(
                label(key),
                [w for w in key.split("_") if len(w) > 2],
                f"the {label(key)} game unit in three-quarter isometric "
                "view, centered, complete and clearly recognisable",
                "clean appropriate material detail for its role",
                "the shared unit palette of the set",
                identity=f"the {label(key)} game unit",
            )
        UNIT_KEY_ORDER.append(key)
        UNIT_STEM_ORDER.append(stem)
        added.append(key)
        # without a UNIT_SVG_FILES mapping, a same-named svg is still candy
        if not UNIT_SVG_FILES.get(key) and (UNIT_ICON_DIR / f"{key}.svg").exists():
            UNIT_SVG_FILES[key] = f"{key}.svg"
    if added:
        print(f"[*] unit sync: picked up new game units: {', '.join(added)}")
    else:
        print(f"[*] unit sync: {len(UNIT_KEY_ORDER)} game units, all covered")
    return added





def load_unit_game_icons() -> tuple[dict[str, str], dict[str, str]]:
    """Parse the emoji icon and display name of every game unit.

    Returns ({unit_key: emoji}, {unit_key: display_name}).  Both dicts come
    back empty when UnitConstants.ts cannot be read - the generator still
    works, it only loses the manifest traceability for the fallback emoji.
    """
    try:
        src = UNIT_CONSTANTS_PATH.read_text()
    except OSError:
        return {}, {}
    icons: dict[str, str] = {}
    names: dict[str, str] = {}
    for match in re.finditer(r"\[UNIT_TYPES\.(\w+)\]:\s*\{(.*?)\}", src, re.S):
        key = match.group(1).lower()
        body = match.group(2)
        icon = re.search(r"icon:\s*'([^']*)'", body)
        name = re.search(r"name:\s*'([^']*)'", body)
        if icon:
            icons[key] = icon.group(1).replace("\ufe0f", "").strip()
        if name:
            names[key] = name.group(1).strip()
    return icons, names


def rasterise_unit_svg(unit_key: str, dst: Path, width: int = 320) -> bool:
    """Rasterise the game's unit SVG artwork to a PNG with inkscape."""
    svg_name = UNIT_SVG_FILES.get(unit_key)
    if not svg_name:
        return False
    svg = UNIT_ICON_DIR / svg_name
    if not svg.exists() or shutil.which("inkscape") is None:
        return False
    proc = subprocess.run(
        ["inkscape", "--export-type=png",
         f"--export-filename={dst}",
         f"--export-width={width}",
         "--export-area-page", str(svg)],
        capture_output=True, text=True, timeout=120,
    )
    if proc.returncode != 0 or not dst.exists():
        print(f"    [!] inkscape failed for {svg_name}: "
              f"{(proc.stderr or proc.stdout).strip()[:200]}")
        return False
    return True




















# ===========================================================================
# small helpers
# ===========================================================================











# ===========================================================================
# Qwen client
# ===========================================================================





















# ===========================================================================
# slot resolution
# ===========================================================================



























# ===========================================================================
# image generation (stable-diffusion.cpp server)
# ===========================================================================

def _post_json(path: str, payload: dict[str, Any], timeout: float = 600) -> dict[str, Any]:
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"http://127.0.0.1:{SD_PORT}{path}", data=body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def _first_image(response: dict[str, Any]) -> bytes:
    images = response.get("images") or []
    if not images:
        raise RuntimeError("sd-server returned no images")
    blob = images[0]
    if "," in blob:
        blob = blob.split(",", 1)[1]
    return base64.b64decode(blob)


def txt2img(prompt: str, negative: str, steps: int, cfg: float,
            width: int, height: int, seed: int | None = None) -> bytes:
    payload: dict[str, Any] = {
        "prompt": prompt,
        "negative_prompt": negative,
        "steps": steps,
        "cfg_scale": cfg,
        "width": width,
        "height": height,
        "sampler_name": "euler",
    }
    if seed is not None and seed >= 0:
        payload["seed"] = seed
    return _first_image(_post_json("/sdapi/v1/txt2img", payload))


def img2img(prompt: str, negative: str, init_image: Path, strength: float,
            steps: int, cfg: float, width: int, height: int,
            seed: int | None = None) -> bytes:
    b64 = base64.b64encode(init_image.read_bytes()).decode()
    payload: dict[str, Any] = {
        "init_images": [f"data:image/png;base64,{b64}"],
        "prompt": prompt,
        "negative_prompt": negative,
        "steps": steps,
        "cfg_scale": cfg,
        "denoising_strength": strength,
        "width": width,
        "height": height,
        "sampler_name": "euler",
    }
    if seed is not None and seed >= 0:
        payload["seed"] = seed
    return _first_image(_post_json("/sdapi/v1/img2img", payload))


# ===========================================================================
# image post-processing
# ===========================================================================

def _alpha_bbox(alpha: np.ndarray, threshold: int = 40) -> tuple[int, int, int, int] | None:
    nz = np.argwhere(alpha > threshold)
    if len(nz) == 0:
        return None
    y0, x0 = nz.min(axis=0)
    y1, x1 = nz.max(axis=0)
    return int(x0), int(y0), int(x1), int(y1)


def is_backup_path(path: Path) -> bool:
    """True when the file lives inside a folder named "backup".

    Backup folders hold the untouched originals and are never processed by
    the background removal.
    """
    return any(
        part.lower() == BACKUP_DIR_NAME
        for part in Path(path).parent.parts
    )


def _flood_from_border(candidate: np.ndarray) -> np.ndarray:
    """Mark every candidate pixel that is connected to the image border."""
    h, w = candidate.shape
    visit = np.zeros((h, w), dtype=bool)
    queue: deque[tuple[int, int]] = deque()
    start = [(-1, -1)]
    for x in range(w):
        for y in (0, h - 1):
            start.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            start.append((x, y))
    for x, y in start[1:]:
        if candidate[y, x] and not visit[y, x]:
            visit[y, x] = True
            queue.append((x, y))
    while queue:
        x, y = queue.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and candidate[ny, nx] and not visit[ny, nx]:
                visit[ny, nx] = True
                queue.append((nx, ny))
    return visit


def _enclosed_background(candidate: np.ndarray, border_bg: np.ndarray,
                         min_area: int) -> np.ndarray:
    """Key out *enclosed* background regions ('holes' between trees).

    A hole that the subject surrounds is not connected to the border, so the
    border flood never reaches it.  Such a hole is still background (the
    terrain behind the sprite must show through), so any candidate region
    larger than ``min_area`` pixels is keyed out too.  Smaller ones survive
    because they are usually real subject detail (an eye, a dark pupil).
    """
    remaining = candidate & ~border_bg
    if not remaining.any():
        return np.zeros_like(border_bg)
    h, w = candidate.shape
    keyed = np.zeros((h, w), dtype=bool)
    if cv2 is not None:
        n, labels, stats, _ = cv2.connectedComponentsWithStats(
            remaining.astype(np.uint8), 8)
        for label in range(1, n):
            if int(stats[label, cv2.CC_STAT_AREA]) >= min_area:
                keyed |= labels == label
        return keyed
    # pure-python fallback: flood every still-unvisited component
    visit = border_bg.copy()
    ys, xs = np.nonzero(remaining)
    for y0, x0 in zip(ys.tolist(), xs.tolist()):
        if visit[y0, x0]:
            continue
        comp = np.zeros((h, w), dtype=bool)
        queue: deque[tuple[int, int]] = deque([(x0, y0)])
        comp[y0, x0] = True
        visit[y0, x0] = True
        while queue:
            x, y = queue.popleft()
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if (0 <= nx < w and 0 <= ny < h and remaining[ny, nx]
                        and not visit[ny, nx]):
                    comp[ny, nx] = True
                    visit[ny, nx] = True
                    queue.append((nx, ny))
        if comp.sum() >= min_area:
            keyed |= comp
    return keyed


def _feather_edge(background: np.ndarray, brightness: np.ndarray,
                  level: int, softness: int) -> np.ndarray:
    """Alpha ramp for the pixels that touch the removed background.

    Without this the cut is a hard, jagged line.  With it the edge fades in
    like the anti-aliased edge the model actually painted.
    """
    alpha = np.full(background.shape, 255, dtype=np.uint8)
    alpha[background] = 0
    if softness <= 0:
        return alpha
    if cv2 is not None:
        kernel = np.ones((3, 3), np.uint8)
        grown = cv2.dilate(background.astype(np.uint8), kernel, iterations=2)
        edge = (grown > 0) & (~background)
    else:
        edge = np.zeros_like(background)
        edge[1:, :] |= background[:-1, :]
        edge[:-1, :] |= background[1:, :]
        edge[:, 1:] |= background[:, :-1]
        edge[:, :-1] |= background[:, 1:]
    lo = level * 0.3
    hi = level + softness
    ramp = np.clip((brightness.astype(np.float32) - lo) / max(1.0, hi - lo), 0.0, 1.0)
    alpha[edge] = (ramp[edge] * 255.0).astype(np.uint8)
    return alpha


def key_out_black(image: Image.Image, level: int = BG_LEVEL,
                  softness: int = BG_SOFTNESS) -> Image.Image:
    """Make the background of a sprite transparent.

    Instead of assuming the background is black, the dominant colour along the
    image border is sampled and used as the key colour.  This keeps foggy
    mountain backgrounds (or any non-black backdrop) from surviving as a
    grey/black halo.  A flood fill from the border removes every pixel that is
    connected to the border *and* close to that colour; enclosed regions bigger
    than a small threshold are keyed out as well.  The edges are feathered
    with the softness ramp, so nothing is cut off with a hard line.
    """
    im = image.convert("RGB")
    arr = np.array(im).astype(np.int16)
    h, w = arr.shape[:2]
    border = np.concatenate([arr[0, :, :], arr[-1, :, :],
                             arr[:, 0, :], arr[:, -1, :]], axis=0)
    bg_color = np.median(border, axis=0).astype(np.int16)
    diff = arr - bg_color[None, None, :]
    dist = np.sqrt((diff.astype(np.float32) ** 2).sum(axis=2))
    tolerance = max(level, 32)
    candidate = dist < tolerance
    background = _flood_from_border(candidate)
    min_area = max(1, int(image.width * image.height * 0.002))
    background |= _enclosed_background(candidate, background, min_area)
    out = arr.astype(np.uint8)
    out[background] = 0
    brightness = np.clip(dist, 0, 255).astype(np.uint8)
    alpha = _feather_edge(background, brightness, level, softness)
    return Image.fromarray(np.dstack([out, alpha]), "RGBA")


def key_out_white(image: Image.Image, level: int = BG_LEVEL,
                  softness: int = BG_SOFTNESS) -> Image.Image:
    """Make a white background transparent (used for opaque input pictures)."""
    im = image.convert("RGB")
    arr = np.array(im).astype(np.int16)
    brightest = arr.max(axis=2)
    darkest = arr.min(axis=2)
    white_point = 255 - max(1, level)
    candidate = darkest > white_point
    background = _flood_from_border(candidate)
    out = arr.astype(np.uint8)
    out[background] = 0
    alpha = _feather_edge(background, 255 - brightest, level, softness)
    return Image.fromarray(np.dstack([out, alpha]), "RGBA")


def keep_main_subject(image: Image.Image, mode: str = "cluster") -> Image.Image:
    """Drop stray blobs so only the feature itself is left.

    "single"  -> keep only the biggest connected blob.
    "cluster" -> keep every blob that is at least 15 % of the biggest one.
    """
    im = image.convert("RGBA")
    arr = np.array(im)
    alpha = arr[:, :, 3]
    opaque = (alpha > 40).astype(np.uint8)

    if cv2 is not None:
        count, labels, stats, _ = cv2.connectedComponentsWithStats(opaque, 8)
        if count > 1:
            areas = stats[1:, cv2.CC_STAT_AREA]
            biggest = int(areas.max()) if len(areas) else 0
            keep = np.zeros(count, dtype=bool)
            for label in range(1, count):
                area = int(stats[label, cv2.CC_STAT_AREA])
                if mode == "single":
                    keep[label] = area == biggest
                else:
                    keep[label] = area >= biggest * 0.15
            drop = (labels > 0) & ~keep[np.clip(labels, 0, count - 1)]
            arr[drop, 3] = 0
            return Image.fromarray(arr, "RGBA")

    # pure numpy/python fallback
    mask = opaque.astype(bool)
    seen = np.zeros_like(mask)
    h, w = mask.shape
    blobs: list[list[tuple[int, int]]] = []
    for sy in range(h):
        for sx in range(w):
            if mask[sy, sx] and not seen[sy, sx]:
                stack = [(sx, sy)]
                seen[sy, sx] = True
                blob = []
                while stack:
                    x, y = stack.pop()
                    blob.append((x, y))
                    for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                        if 0 <= nx < w and 0 <= ny < h and mask[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True
                            stack.append((nx, ny))
                blobs.append(blob)
    if not blobs:
        return im
    biggest = max(len(b) for b in blobs)
    drop: set[tuple[int, int]] = set()
    for blob in blobs:
        keep = len(blob) == biggest if mode == "single" else len(blob) >= biggest * 0.15
        if not keep:
            drop.update(blob)
    for x, y in drop:
        arr[y, x, 3] = 0
    return Image.fromarray(arr, "RGBA")


def prepare_feature_input(src: Path, dst: Path, width: int, height: int,
                           mode: str = "cluster", level: int = BG_LEVEL,
                           softness: int = BG_SOFTNESS) -> Path:
    """Build the black-background input picture for a feature sprite.

    The input artwork is cleaned (alpha or white keyed), reduced to the main
    subject, fitted into the target canvas and flattened onto pure black - the
    model then only re-skins the feature, it cannot invent a new one.
    """
    im = Image.open(src).convert("RGBA")
    arr = np.array(im)
    if arr[:, :, 3].min() == 255:
        # fully opaque input -> key out a white background
        im = key_out_white(im, level=level, softness=softness)
        arr = np.array(im)
        if arr[:, :, 3].min() == 255:
            # still opaque (no white border) -> use a luminance key from the border
            im = key_out_black(im, level=level + 30, softness=softness)
            arr = np.array(im)

    im = keep_main_subject(im, mode=mode)

    bbox = _alpha_bbox(np.array(im)[:, :, 3])
    if bbox is None:
        im = Image.new("RGBA", (width, height), (0, 0, 0, 255))
        im.save(dst, "PNG")
        return dst

    x0, y0, x1, y1 = bbox
    crop = im.crop((x0, y0, x1 + 1, y1 + 1))
    scale = min((width * 0.92) / crop.width, (height * 0.92) / crop.height)
    new_w = max(1, int(crop.width * scale))
    new_h = max(1, int(crop.height * scale))
    crop = crop.resize((new_w, new_h), Image.LANCZOS)

    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 255))
    canvas.paste(crop, ((width - new_w) // 2, (height - new_h) // 2), crop)
    canvas.convert("RGB").save(dst, "PNG")
    return dst


def clean_terrain_tile(png_path: Path) -> None:
    """Remove black padding so the texture fills the whole tile.

    Diffusion models tend to emit a diamond or a sprite on a black background
    even when the prompt asks for a seamless full-bleed texture.  The
    near-black regions are inpainted with the surrounding texture, so the
    result is a continuous edge-to-edge surface.
    """
    if cv2 is None:
        return
    img = cv2.imread(str(png_path))
    if img is None:
        return
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    mask = (gray < 30).astype("uint8") * 255
    if mask.sum() == 0:
        return
    out = cv2.inpaint(img, mask, 7, cv2.INPAINT_TELEA)
    cv2.imwrite(str(png_path), out)


def _nearest_palette_color(values: np.ndarray, palette: np.ndarray) -> np.ndarray:
    """Snap RGB values to an existing pixel-art palette."""
    shape = values.shape
    flat = values.reshape(-1, 3).astype(np.float32)
    distances = ((flat[:, None, :] - palette[None, :, :]) ** 2).sum(axis=2)
    return palette[distances.argmin(axis=1)].reshape(shape)


def repair_terrain_edges(png_path: Path, crop_fraction: float = 0.10,
                         blend_fraction: float = 0.08,
                         pixel_art: bool = False) -> None:
    """Remove generated perimeter framing and make opposite edges tileable.

    A centered crop removes common halos, rims, shorelines, and vignettes, then
    restores the original dimensions. A short wrap blend makes opposing edges
    agree exactly; pixel-art blends are snapped to colors already in the image.
    """
    try:
        image = Image.open(png_path).convert("RGB")
    except Exception as exc:
        print(f"    [!] could not repair terrain edges for {png_path.name}: {exc}")
        return

    width, height = image.size
    crop_x = max(0, min(round(width * crop_fraction), max(0, (width - 2) // 2)))
    crop_y = max(0, min(round(height * crop_fraction), max(0, (height - 2) // 2)))
    if crop_x or crop_y:
        image = image.crop((crop_x, crop_y, width - crop_x, height - crop_y))
        resampling = Image.NEAREST if pixel_art else Image.LANCZOS
        image = image.resize((width, height), resampling)

    if blend_fraction > 0:
        arr = np.array(image).astype(np.float32)
        height, width = arr.shape[:2]
        band_x = min(max(1, round(width * blend_fraction)), width // 4)
        band_y = min(max(1, round(height * blend_fraction)), height // 4)

        palette = None
        if pixel_art:
            colors, counts = np.unique(
                arr.astype(np.uint8).reshape(-1, 3), axis=0, return_counts=True,
            )
            if len(colors) > 128:
                colors = colors[np.argsort(counts)[-128:]]
            palette = colors.astype(np.float32)

        def shared_edge_color(a: np.ndarray, b: np.ndarray) -> np.ndarray:
            shared = (a + b) * 0.5
            return _nearest_palette_color(shared, palette) if palette is not None else shared

        # Blend left/right pairs. At the outermost pixels the pair is identical;
        # the influence falls smoothly to zero inside the band.
        for offset in range(band_x):
            strength = 1.0 - offset / band_x
            left = arr[:, offset, :].copy()
            right = arr[:, width - 1 - offset, :].copy()
            shared = shared_edge_color(left, right)
            next_left = left + (shared - left) * strength
            next_right = right + (shared - right) * strength
            if palette is not None:
                next_left = _nearest_palette_color(next_left, palette)
                next_right = _nearest_palette_color(next_right, palette)
            arr[:, offset, :] = next_left
            arr[:, width - 1 - offset, :] = next_right

        # Repeat for top/bottom. This preserves the left/right equality at the
        # four corners while making every opposing edge pair seamless.
        for offset in range(band_y):
            strength = 1.0 - offset / band_y
            top = arr[offset, :, :].copy()
            bottom = arr[height - 1 - offset, :, :].copy()
            shared = shared_edge_color(top, bottom)
            next_top = top + (shared - top) * strength
            next_bottom = bottom + (shared - bottom) * strength
            if palette is not None:
                next_top = _nearest_palette_color(next_top, palette)
                next_bottom = _nearest_palette_color(next_bottom, palette)
            arr[offset, :, :] = next_top
            arr[height - 1 - offset, :, :] = next_bottom

        image = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")

    image.save(png_path, "PNG")


def tile_is_usable(png_path: Path) -> bool:
    """Reject tiles that are (almost) completely black or blown out."""
    try:
        arr = np.array(Image.open(png_path).convert("L"), dtype=np.int16)
    except Exception:
        return False
    if arr.size == 0:
        return False
    black = float((arr < 24).mean())
    white = float((arr > 245).mean())
    return black < 0.55 and white < 0.75


def harmonise_terrain_edges(primary: Path, others: list[Path],
                            ring: int = 16) -> None:
    """Give sibling ground tiles the SAME border so they can sit side by side.

    The game picks one variant per grid cell (TerrainTextureManager), so two
    different variants can meet on the board. Each tile is seamless on its own,
    but variant A's edge is not variant B's edge - that seam is exactly what
    makes one terrain look like several images stuck together.

    Fix: copy the primary tile's outer ring onto every sibling through a soft
    cross-fade. The outermost pixel of all three then reads identically, so any
    pair meets without a line, while each tile keeps its own interior pattern.
    The primary is already self-seamless, so the copied ring is too.
    """
    if not others:
        return
    try:
        base = np.array(Image.open(primary).convert("RGB")).astype(np.float32)
    except Exception:
        return
    h, w = base.shape[:2]
    ring = max(2, min(ring, h // 4, w // 4))

    # Distance-in-from-the-border ramp: 1 exactly on the edge, 0 past `ring`.
    ys = np.minimum(np.arange(h), h - 1 - np.arange(h))[:, None]
    xs = np.minimum(np.arange(w), w - 1 - np.arange(w))[None, :]
    depth = np.minimum(ys, xs).astype(np.float32)
    weight = np.clip(1.0 - depth / ring, 0.0, 1.0) ** 2
    weight = weight[:, :, None]

    for other in others:
        if not other.exists() or other.resolve() == primary.resolve():
            continue
        try:
            img = Image.open(other).convert("RGB")
            if img.size != (w, h):
                img = img.resize((w, h), Image.LANCZOS)
            arr = np.array(img).astype(np.float32)
        except Exception:
            continue
        merged = base * weight + arr * (1.0 - weight)
        Image.fromarray(np.clip(merged, 0, 255).astype(np.uint8), "RGB").save(
            other, "PNG")


def clean_feature_sprite(png_path: Path, fill_ratio: float = 0.86,
                         level: int = BG_LEVEL, softness: int = BG_SOFTNESS) -> None:
    """Guarantee a feature sprite with no background and good framing.

    1. the black background is keyed out (border flood fill),
    2. stray opaque blobs are dropped, only the feature remains,
    3. the feature is centred in the canvas and enlarged when it ended up
       far too small, so every sprite sits the same way on a tile.
    """
    im = Image.open(png_path).convert("RGBA")
    arr = np.array(im)

    if (arr[:, :, 3] > 40).all():
        im = key_out_black(im, level=level, softness=softness)
        arr = np.array(im)

    im = keep_main_subject(im, mode="cluster")

    bbox = _alpha_bbox(np.array(im)[:, :, 3])
    if bbox is None:
        return
    x0, y0, x1, y1 = bbox
    crop = im.crop((x0, y0, x1 + 1, y1 + 1))
    w, h = im.size

    # enlarge a subject that ended up far too small
    if crop.width < w * 0.45 or crop.height < h * 0.45:
        scale = min((w * fill_ratio) / crop.width, (h * fill_ratio) / crop.height)
        new_w = max(1, int(round(crop.width * scale)))
        new_h = max(1, int(round(crop.height * scale)))
        crop = crop.resize((new_w, new_h), Image.LANCZOS)

    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.paste(crop, ((w - crop.width) // 2, (h - crop.height) // 2), crop)
    canvas.save(png_path)


def remove_background_rembg(src_png: Path, dst_png: Path) -> bool:
    """Optional AI segmentation - only used when the fast key fails."""
    if not Path(REMBG).exists():
        return False
    for _ in range(2):
        try:
            subprocess.run(
                [REMBG, "i", str(src_png), str(dst_png)],
                check=True, timeout=300,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            if dst_png.exists() and dst_png.stat().st_size > 0:
                return True
        except Exception:
            pass
    return False


# ===========================================================================
# server management
# ===========================================================================

class ServerManager:
    """Starts the local AI servers when they are not running yet."""

    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.sd_proc: subprocess.Popen | None = None
        self.llama_proc: subprocess.Popen | None = None
        self.started_sd = False
        self.started_llama = False
        self._llama_restart_at = 0.0

    # -- stable diffusion --------------------------------------------------
    def sd_up(self) -> bool:
        return http_ok(f"http://127.0.0.1:{SD_PORT}/")

    def start_sd(self) -> bool:
        if self.sd_up():
            return True
        if not Path(self.args.sd_server).exists():
            print(f"[-] sd-server not found at {self.args.sd_server}")
            return False
        print("[*] Starting sd-server (FLUX.2 Klein)...")
        cmd = [
            str(self.args.sd_server),
            "--diffusion-model", str(self.args.diffusion),
            "--vae", str(self.args.vae),
            "--llm", str(self.args.llm),
            "--listen-port", str(SD_PORT),
            "--diffusion-fa",
            "--cfg-scale", str(self.args.cfg),
            "--steps", str(self.args.steps),
        ]
        self.sd_proc, _ = start_process(cmd, SD_LOG)
        if not wait_for(f"http://127.0.0.1:{SD_PORT}/", timeout=300):
            print(f"[-] sd-server did not start. See {SD_LOG}")
            return False
        self.started_sd = True
        return True

    def stop_sd(self) -> None:
        if self.sd_proc:
            stop_process(self.sd_proc)
            self.sd_proc = None

    def restart_sd(self) -> bool:
        self.stop_sd()
        time.sleep(3)
        return self.start_sd()

    # -- llama -------------------------------------------------------------
    def llama_up(self) -> bool:
        return http_ok(f"http://127.0.0.1:{LLAMA_PORT}/health")

    def start_llama(self) -> bool:
        if self.llama_up():
            return True
        if not Path(self.args.llama_server).exists():
            print(f"[-] llama-server not found at {self.args.llama_server}")
            return False
        print("[*] Starting llama-server (Qwen3-4B)...")
        cmd = [
            str(self.args.llama_server),
            "-m", str(self.args.qwen_model),
            "--port", str(LLAMA_PORT),
            "--host", "127.0.0.1",
            "-c", "4096",
        ]
        self.llama_proc, _ = start_process(cmd, LLAMA_LOG)
        if not wait_for(f"http://127.0.0.1:{LLAMA_PORT}/health", timeout=300):
            print(f"[-] llama-server did not start. See {LLAMA_LOG}")
            return False
        self.started_llama = True
        return True

    def stop_llama(self) -> None:
        if self.llama_proc:
            stop_process(self.llama_proc)
            self.llama_proc = None

    def restart_llama(self) -> bool:
        """Restart an unresponsive llama-server.

        A dead slot resolver degrades every prompt to its fallback phrase, so
        a live resolver matters more than keeping the process.  Restart churn
        is limited to one attempt per minute.
        """
        if self.llama_up():
            return True
        now_ = time.time()
        if now_ - self._llama_restart_at < 60:
            return False
        self._llama_restart_at = now_
        self.stop_llama()
        time.sleep(2)
        if not self.llama_up():
            # a process stuck in uninterruptible I/O ignores terminate() -
            # hard-kill it by its command line, then start a fresh one
            subprocess.run(
                ["pkill", "-9", "-f",
                 f"{self.args.llama_server}.*--port {LLAMA_PORT}"],
                capture_output=True,
            )
            time.sleep(2)
        if self.llama_up():
            return True
        stopped = self.start_llama()
        print(f"[!] llama-server was unresponsive - "
              f"{'restarted' if stopped else 'restart failed'}")
        return stopped

    def shutdown(self) -> None:
        if self.started_sd:
            self.stop_sd()
        if self.started_llama:
            self.stop_llama()


# ===========================================================================
# main
# ===========================================================================

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate variated terrain tiles, feature sprites and game-unit artwork.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--iterations", type=int,
                        default=int(os.environ.get("ITERATIONS", "10")),
                        help="number of tile sets to generate")
    parser.add_argument("--output-root",
                        default=os.environ.get("OUTPUT_ROOT", str(TILE_GEN / "tile_sets")),
                        help="base output directory")
    parser.add_argument("--strength", type=float,
                        default=float(os.environ.get("STRENGTH", "0.6")),
                        help="img2img denoising strength for features")
    parser.add_argument("--feature-strength", type=float,
                        default=float(os.environ.get("FEATURE_STRENGTH", "0.7")),
                        help="img2img denoising strength for feature sprites")
    parser.add_argument("--steps", type=int, default=int(os.environ.get("STEPS", "4")),
                        help="sampling steps")
    parser.add_argument("--cfg", type=float, default=float(os.environ.get("CFG", "1.0")),
                        help="classifier-free guidance scale")
    parser.add_argument("--size", type=int, default=int(os.environ.get("SIZE", "512")),
                        help="terrain tile size in pixels")
    parser.add_argument("--edge-crop", type=float,
                        default=float(os.environ.get("EDGE_CROP", "0.10")),
                        help="crop this fraction from every terrain edge, then resize back")
    parser.add_argument("--edge-blend", type=float,
                        default=float(os.environ.get("EDGE_BLEND", "0.08")),
                        help="wrap-blend this fraction of opposite terrain edges for seamless tiling")
    parser.add_argument("--feature-size", type=int,
                        default=int(os.environ.get("FEATURE_SIZE", "256")),
                        help="feature sprite width in pixels (height is 1.5x)")
    parser.add_argument("--seed", type=int, default=int(os.environ.get("SEED", "-1")),
                        help="base seed for reproducible runs (-1 = random)")
    parser.add_argument("--retries", type=int, default=int(os.environ.get("RETRIES", "3")),
                        help="render attempts per image before the fallback is used")
    parser.add_argument("--bg-level", type=int, default=int(os.environ.get("BG_LEVEL", str(BG_LEVEL))),
                        help="background removal color-distance tolerance 0-255; "
                             "higher removes more (default: %(default)s)")
    parser.add_argument("--bg-softness", type=int,
                        default=int(os.environ.get("BG_SOFTNESS", str(BG_SOFTNESS))),
                        help="background removal softness 0-255: the width of the "
                             "anti-aliasing ramp, 0 is a hard edge (default: %(default)s)")
    parser.add_argument("--terrains", default=os.environ.get("TERRAINS", ""),
                        help="comma separated list of terrains (default: all)")
    parser.add_argument("--features", default=os.environ.get("FEATURES", ""),
                        help="comma separated resource/terrain feature stems, "
                             "matches also by variant base name ('forest_feature' "
                             "renders forest_feature_1..3); use --units for game units")
    parser.add_argument("--units", default=os.environ.get("UNITS"),
                        help="comma separated game unit keys or stems "
                             "(e.g. phalanx,settler or unit_phalanx); all units "
                             "when requested without a list")
    parser.add_argument("--dry-run", action="store_true",
                        help="only resolve the prompts with the local model, render nothing")
    parser.add_argument("--spec-json", default=None, metavar="DIR",
                        help="directory holding the specs/*.json source of truth "
                             "(default: the specs/ next to this script)")
    parser.add_argument("--request-json", default=None, metavar="FILE",
                        help="request JSON overlaid on these arguments "
                             "(theme/style/selection/seed/iterations)")
    parser.add_argument("--prompts-from", default=None, metavar="FILE",
                        help="render the prompts of an existing bundle instead of "
                             "resolving them with the local model")
    parser.add_argument("--emit-prompts", default=None, metavar="FILE",
                        help="write the planned prompts as a bundle and render "
                             "nothing (implies --dry-run)")
    parser.add_argument("--no-features", action="store_true",
                        help="skip resource and terrain feature sprites")
    parser.add_argument("--no-units", action="store_true",
                        help="skip game unit sprites")
    parser.add_argument("--no-terrains", action="store_true",
                        help="skip the terrain tiles")
    parser.add_argument("--keep-servers", action="store_true",
                        help="do not stop servers that this run started")
    parser.add_argument("--use-rembg", action="store_true",
                        help="use AI segmentation for the background instead of the fast key")
    parser.add_argument("--sd-server", default=str(SD_SERVER_BIN))
    parser.add_argument("--diffusion", default=str(SD_DIFFUSION))
    parser.add_argument("--vae", default=str(SD_VAE))
    parser.add_argument("--llm", default=str(SD_LLM))
    parser.add_argument("--llama-server", default=str(LLAMA_SERVER_BIN))
    parser.add_argument("--qwen-model", default=str(QWEN_MODEL))
    parser.add_argument("--theme-keyword",
                        default=os.environ.get("THEME_KEYWORD", ""),
                        help="one theme keyword for sparse small accents only "
                             "(e.g. Halloween, Christmas, Easter); terrain "
                             "materials, natural colors, identities and "
                             "neutral lighting stay unchanged")
    parser.add_argument("--style-keyword",
                        default=os.environ.get("STYLE_KEYWORD", ""),
                        help="one art STYLE for this whole run (a STYLE_KEYS "
                             "name such as american_comic, manga, pixel_art, "
                             "original_game_icons, ... or any freeform style "
                             "phrase) - changes only HOW everything is "
                             "rendered; subject identities stay untouched")
    parser.add_argument("--unit-style-keyword",
                        default=os.environ.get("UNIT_STYLE_KEYWORD", ""),
                        help="art STYLE for the game unit sprites only "
                             "(a STYLE_KEYS name such as "
                             "original_game_icons for the flat vector game-icon "
                             "look, or any freeform phrase); terrain and "
                             "resource features keep --style-keyword")
    parser.add_argument("--write-batch",
                        default=os.environ.get("WRITE_BATCH", ""),
                        help="writes a bash script that runs one tile-set job "
                             "after another - one job per comma-separated "
                             "keyword ('' = a classic run) - and exits; the "
                             "script can then run unattended in the "
                             "background")
    parser.add_argument("--batch-style-mode", action="store_true",
                        help="with --write-batch: every comma-separated entry "
                             "is an art STYLE name (-> --style-keyword) "
                             "instead of a theme keyword")
    parser.add_argument("--batch-terrains",
                        default=os.environ.get("BATCH_TERRAINS", ""),
                        help="with --write-batch: terrain whitelist passed to "
                             "every generated job (--terrains ...)")
    parser.add_argument("--batch-features",
                        default=os.environ.get("BATCH_FEATURES", ""),
                        help="with --write-batch: feature whitelist "
                             "passed to every generated job (--features ...)")
    parser.add_argument("--batch-units",
                        default=os.environ.get("BATCH_UNITS", ""),
                        help="with --write-batch: unit whitelist passed to "
                             "every generated job (--units ...)")
    parser.add_argument("--batch-iterations", type=int,
                        default=int(os.environ.get("BATCH_ITERATIONS", "1")),
                        help="iterations per job inside a generated batch "
                             "script (default 1)")
    return parser


def write_batch_script(runs: list[str], iterations: int,
                       style_mode: bool = False,
                       extra_args: list[str] | None = None) -> Path:
    """Write a bash script that runs one tile-set job after another.

    Every non-empty keyword becomes one themed job (`--theme-keyword`),
    every empty keyword one classic job.  In ``style_mode`` every keyword is
    an art-style name (`--style-keyword`); with ``extra_args`` (e.g. terrain
    and feature whitelists) those arguments are appended to every job.  The
    script can be started in the background (nohup) and checked later - the
    generator does not have to be monitored while it runs.
    """
    jobs: list[tuple[str, list[str]]] = []
    used: set[str] = set()
    classic = 0
    for keyword in runs:
        kw = keyword.strip()
        if kw:
            label = re.sub(r"[^a-z0-9]+", "_", kw.lower()).strip("_") or "run"
            cmd = ([f"--style-keyword", kw] if style_mode
                   else ["--theme-keyword", kw])
        else:
            if style_mode:
                raise ValueError("style-mode batches cannot contain empty "
                                 "(classic) entries")
            classic += 1
            label = f"classic_{classic:02d}"
            cmd = []
        base = label
        n = 2
        while label in used:
            label = f"{base}_{n}"
            n += 1
        used.add(label)
        jobs.append((label, cmd + list(extra_args or []) +
                     ["--iterations", str(iterations)]))

    script = TILE_GEN / f"run_batch_{int(time.time())}.sh"
    # same-second generation would silently overwrite the previous script
    n = 2
    while script.exists():
        script = TILE_GEN / f"run_batch_{int(time.time())}_{n}.sh"
        n += 1
    lines = [
        "#!/usr/bin/env bash",
        "# Auto-generated by tools/tile-generator/generate_variated_tile_sets.py.",
        "# Runs one tile-set job after another. Progress is shown on the console",
        "# and kept in tools/tile-generator/run_logs/<job>.log; the images of a",
        "# job land in tools/tile-generator/tile_sets/<job>/.",
        "# Start it in the background:",
        f"#   nohup bash {script.name} > batch.out 2>&1 &",
        "set -uo pipefail",
        f'cd "{ROOT}"',
        'GEN="tools/tile-generator/generate_variated_tile_sets.py"',
        'LOG_DIR="tools/tile-generator/run_logs"',
        'OUT_ROOT="tools/tile-generator/tile_sets"',
        'mkdir -p "$LOG_DIR" "$OUT_ROOT"',
        "",
        "fail=0",
        "",
        "run_job() {",
        '  local label="$1"; shift',
        '  local log="$LOG_DIR/$label.log"',
        '  local out="$OUT_ROOT/$label"',
        '  echo ""',
        '  echo "=== job: $label ($(date -Is)) ==="',
        '  echo "    log: $log"',
        '  echo "    out: $out"',
        '  # tee: progress on the console AND in the job log.',
        '  if python3 -u "$GEN" "$@" --output-root "$out" 2>&1 | tee -a "$log"; then',
        '    echo "    OK     -> $out ($(find "$out" -name "*.png" | wc -l) images)"',
        "  else",
        '    fail=$((fail+1))',
        '    echo "    FAILED -> see $log"',
        "  fi",
        "}",
        "",
    ]
    for label, cmd_args in jobs:
        quoted = " ".join(shlex.quote(a) for a in cmd_args)
        lines.append(f'run_job {shlex.quote(label)} {quoted}'.rstrip())
    lines += [
        "",
        'echo ""',
        'echo "=== batch done ($(date -Is)): $fail job(s) failed ==="',
        'echo "logs:   $LOG_DIR"',
        'echo "images: $OUT_ROOT/<job label>/<run>/iteration_XX/"',
        'exit "$fail"',
        "",
    ]
    script.write_text("\n".join(lines))
    script.chmod(0o755)
    return script


# The bundle contract with abstract_generator: prompts read from
# --prompts-from, prompts recorded for --emit-prompts.
_BUNDLE_SOURCE: dict[str, dict[str, Any]] = {}
_BUNDLE_OUT: list[dict[str, Any]] = []


def plan_prompt(kind: str, asset_id: str, variant: int, negative: str,
                builder: Callable[[], tuple[str, dict[str, Any]]]
                ) -> tuple[str, dict[str, Any]]:
    """One prompt, from the bundle when --prompts-from gave us one.

    Otherwise the builder runs (Qwen + assembly) and the result is recorded
    so --emit-prompts can write it back out as a bundle. The key is
    ``kind:id:variant`` — the same shape abstract_generator.generate()
    produces, so a bundle can travel between the two tools unchanged.
    """
    if _BUNDLE_SOURCE:
        entry = _BUNDLE_SOURCE.get(f"{kind}:{asset_id}:{variant}")
        if entry is None:
            raise SpecError(
                f"bundle has no {kind} asset {asset_id!r} variant {variant}")
        return str(entry["prompt"]), dict(entry.get("keywords") or {})
    prompt, keywords = builder()
    _BUNDLE_OUT.append({
        "kind": kind, "id": asset_id, "variant": variant,
        "negative": negative, "prompt": prompt, "keywords": keywords,
    })
    return prompt, keywords


def load_bundle(path: str) -> None:
    """Fill _BUNDLE_SOURCE from a bundle written by abstract_generator."""
    try:
        data = json.loads(Path(path).read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise SpecError(f"bundle {path}: {exc}") from exc
    if data.get("version") != SPEC_VERSION:
        raise SpecError(f"bundle {path}: version {data.get('version')!r} "
                        f"!= {SPEC_VERSION}")
    for asset in data.get("assets", []):
        kind, asset_id = str(asset.get("kind")), str(asset.get("id"))
        for v in asset.get("variants", []):
            if "prompt" not in v:
                raise SpecError(f"bundle {path}: {kind} {asset_id!r} variant "
                                f"{v.get('variant')} has no prompt")
            _BUNDLE_SOURCE[f"{kind}:{asset_id}:{v['variant']}"] = v
    if not _BUNDLE_SOURCE:
        raise SpecError(f"bundle {path}: no assets")
    print(f"[*] prompt bundle loaded: {len(_BUNDLE_SOURCE)} prompts "
          f"from {path}")


def bundle_document(label: str, args: argparse.Namespace) -> dict[str, Any]:
    """Group the recorded prompts into the abstract_generator bundle shape."""
    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    for rec in _BUNDLE_OUT:
        entry = grouped.setdefault((rec["kind"], rec["id"]), {
            "kind": rec["kind"], "id": rec["id"], "variants": [],
        })
        entry["variants"].append({
            "variant": rec["variant"],
            "prompt": rec["prompt"], "keywords": rec["keywords"],
        })
    return {
        "version": SPEC_VERSION,
        "label": label,
        "seed": args.seed,
        "iterations": args.iterations,
        "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "assets": [grouped[key] for key in sorted(grouped)],
    }


def apply_request(args: argparse.Namespace, path: str) -> None:
    """Overlay a request JSON (--request-json) onto the CLI arguments.

    Only the keys the request carries are applied, so a request can pin the
    theme and the selection while the rest stays on the command line.
    """
    try:
        request = json.loads(Path(path).read_text() if path != "-" else
                             sys.stdin.read())
    except (OSError, json.JSONDecodeError) as exc:
        raise SpecError(f"request {path}: {exc}") from exc
    if not isinstance(request, dict):
        raise SpecError(f"request {path}: expected a JSON object")
    if request.get("version", SPEC_VERSION) != SPEC_VERSION:
        raise SpecError(f"request {path}: version "
                        f"{request.get('version')!r} != {SPEC_VERSION}")
    allowed = {"version", "label", "seed", "iterations", "categories",
               "selection", "theme", "style", "unitStyle", "overrides",
               "noLlm"}
    unknown = set(request) - allowed
    if unknown:
        raise SpecError(f"request {path}: unknown key(s): "
                        + ", ".join(sorted(unknown)))
    if "theme" in request:
        args.theme_keyword = str(request["theme"] or "")
    if "style" in request:
        args.style_keyword = str(request["style"] or "")
    if "unitStyle" in request:
        args.unit_style_keyword = str(request["unitStyle"] or "")
    if "iterations" in request:
        args.iterations = int(request["iterations"])
    if "seed" in request:
        args.seed = int(request["seed"])
    selection = request.get("selection") or {}
    if "terrains" in selection:
        args.terrains = ",".join(selection["terrains"])
        args.no_terrains = not selection["terrains"]
    if "features" in selection:
        args.features = ",".join(selection["features"])
        args.no_features = not selection["features"]
    if "units" in selection:
        args.units = ",".join(selection["units"])
        args.no_units = not selection["units"]
    print(f"[*] request applied: {path}")


def main() -> int:
    args = build_parser().parse_args()
    # The specs, the request and the bundle are all resolved before anything
    # reads them — a contract problem exits here, with the offending key.
    try:
        load_specs(args.spec_json)
        if args.request_json:
            apply_request(args, args.request_json)
        if args.prompts_from:
            load_bundle(args.prompts_from)
    except SpecError as exc:
        print(f"[-] {exc}")
        return 2
    if args.emit_prompts:
        # planning only: the bundle is the artifact, not the images
        args.dry_run = True
    theme_keyword = args.theme_keyword.strip()
    if not 0 <= args.edge_crop < 0.25:
        print("[-] --edge-crop must be in the range [0, 0.25)")
        return 2
    if not 0 <= args.edge_blend <= 0.25:
        print("[-] --edge-blend must be in the range [0, 0.25]")
        return 2
    if theme_keyword:
        print(f"[*] direction keyword: {theme_keyword!r} - restrained small "
              f"accents only; terrain identity and natural colors stay fixed")
    style_name, style_desc, style_context = "", "", ""
    if args.style_keyword.strip():
        style_name, style_desc = resolve_style(args.style_keyword)
        style_context = style_clauses(style_name, style_desc)
        print(f"[*] art style: {style_name} - rendering only, identities "
              f"untouched")
    pixel_art_terrain = "pixel" in style_desc.lower()
    unit_style_name, unit_style_desc = "", ""
    if args.unit_style_keyword.strip():
        unit_style_name, unit_style_desc = resolve_style(args.unit_style_keyword)
        print(f"[*] unit art style: {unit_style_name} - units only, identities "
              f"untouched")
    print(f"[*] terrain edge repair: crop {args.edge_crop:.0%}, "
          f"wrap blend {args.edge_blend:.0%}"
          + (" (pixel palette preserved)" if pixel_art_terrain else ""))

    # Folder name under tile_sets/: the theme/style keyword (sanitised), or
    # "classic" when no keyword was given — so a run is findable by name.
    if theme_keyword:
        run_name = re.sub(r"[^a-z0-9]+", "_", theme_keyword.lower()).strip("_") or "classic"
    elif args.style_keyword.strip():
        run_name = re.sub(r"[^a-z0-9]+", "_", args.style_keyword.strip().lower()).strip("_") or "classic"
    elif args.unit_style_keyword.strip():
        run_name = re.sub(r"[^a-z0-9]+", "_", args.unit_style_keyword.strip().lower()).strip("_") or "classic"
    else:
        run_name = "classic"

    run_name = run_name + "_" + str(int(time.time()))
    if args.dry_run:
        # A dry run only writes prompts/manifests, never images.  Tagging the
        # folder keeps it from being mistaken for a real run that produced
        # nothing (a real run writes its images into tiles/, features/, units/).
        run_name += "_dryrun"

    if args.write_batch:
        extra: list[str] = []
        if args.batch_terrains.strip():
            extra += ["--terrains", args.batch_terrains.strip()]
        if args.batch_features.strip():
            extra += ["--features", args.batch_features.strip()]
        if args.batch_units.strip():
            extra += ["--units", args.batch_units.strip()]
        extra += ["--edge-crop", str(args.edge_crop),
                  "--edge-blend", str(args.edge_blend)]
        script = write_batch_script(
            args.write_batch.split(","), args.batch_iterations,
            style_mode=args.batch_style_mode, extra_args=extra)
        print(f"[*] batch script written: {script}")
        print(f"    start it in the background with:")
        print(f"    nohup bash \"{script}\" > \"{script.with_suffix('.out')}\" 2>&1 &")
        return 0

    # Cover every unit the game actually defines - including ones added to
    # UNIT_TYPES after this table was written - before anything is selected.
    sync_game_units()

    terrains = [t.strip() for t in args.terrains.split(",") if t.strip()] or list(TERRAINS)
    unknown = [t for t in terrains if t not in TERRAINS]
    if unknown:
        print(f"[-] unknown terrain(s): {', '.join(unknown)}")
        return 2

    feature_inputs = sorted(
        p for p in FEATURE_RESOURCES.glob(FEATURE_INPUT_GLOB)
        if not is_backup_path(p)
    )
    inputs_by_stem = {p.stem: p for p in feature_inputs}
    feature_wanted = {f.strip().lower() for f in args.features.split(",") if f.strip()}
    unit_wanted = ({u.strip().lower() for u in args.units.split(",") if u.strip()}
                   if args.units is not None else None)
    # Backward compatibility: older scripts used `--features units` to select
    # the unit category. New invocations should use the independent --units.
    legacy_units = "units" in feature_wanted
    feature_wanted.discard("units")
    selection_provided = bool(feature_wanted) or args.units is not None or legacy_units
    if selection_provided:
        feature_stems = select_feature_stems(feature_wanted) if feature_wanted else []
        unit_stems = select_unit_stems(unit_wanted) if args.units is not None else []
        if legacy_units and args.units is None:
            unit_stems = select_unit_stems(None)
    else:
        feature_stems = select_feature_stems(None)
        unit_stems = select_unit_stems(None)
    if args.no_features:
        feature_stems = []
    if args.no_units:
        unit_stems = []
    stems = feature_stems + unit_stems
    if selection_provided and not stems and not (args.no_features or args.no_units):
        print(f"[-] --features {args.features!r} / --units {args.units!r} "
              f"matched no assets")
        return 2
    if not stems and args.no_terrains:
        print("[-] Nothing to do: no terrain tiles and no feature/unit "
              "sprites selected")
        return 2
    for p in feature_inputs:
        print(f"[*] feature input: {p.name}")
    unit_icons, unit_names = load_unit_game_icons()
    unit_svg_count = sum(1 for s in unit_stems
                         if UNIT_SVG_FILES.get(s[len("unit_"):]))
    print(f"[*] unit sprites   : {len(unit_stems)} "
          f"({unit_svg_count} img2img from the game's SVG artwork, "
          f"{len(unit_stems) - unit_svg_count} from the fixed descriptions)")
    init_stems = [s for s in stems
                  if s in inputs_by_stem and s not in FEATURE_TEXT_ONLY_STEMS]
    print(f"[*] img2img stems : {', '.join(init_stems) or '(none)'}")
    print(f"[*] txt2img stems  : "
          f"{', '.join(s for s in stems if s not in set(init_stems))}")

    output_root = Path(args.output_root)
    output_root.mkdir(parents=True, exist_ok=True)
    run_dir = output_root / run_name
    run_dir.mkdir(parents=True, exist_ok=True)
    print(f"[*] output: {run_dir}")

    servers = ServerManager(args)
    registry = VariationRegistry()
    _abstract.LLAMA_RESTART_HOOK = servers.restart_llama
    started = time.time()
    run_manifest: dict[str, Any] = {
        "started": time.strftime("%Y-%m-%d %H:%M:%S"),
        "output": str(run_dir),
        "dry_run": bool(args.dry_run),
        "iterations": args.iterations,
        "selected_features": feature_stems,
        "selected_units": unit_stems,
        "theme_keyword": theme_keyword,
        "style_keyword": style_name or "",
        "unit_style_keyword": unit_style_name or "",
        "terrain_variants": TERRAIN_VARIANTS,
        "size": args.size,
        "terrain_edge_crop": args.edge_crop,
        "terrain_edge_blend": args.edge_blend,
        "feature_size": args.feature_size,
        "steps": args.steps,
        "cfg": args.cfg,
        "seed": args.seed,
        "iteration_manifests": [],
    }

    if not args.dry_run:
        if not servers.start_sd():
            return 1
        if not servers.start_llama():
            servers.shutdown()
            return 1
    elif not servers.llama_up():
        if not servers.start_llama():
            return 1

    def render(prompt: str, negative: str, out_path: Path, width: int, height: int,
               init_image: Path | None = None, seed: int | None = None) -> bool:
        """Render one image, restarting the sd-server when it dies."""
        for attempt in range(1, args.retries + 1):
            try:
                if init_image is not None:
                    data = img2img(prompt, negative, init_image,
                                   args.feature_strength,
                                   args.steps, args.cfg, width, height, seed)
                else:
                    data = txt2img(prompt, negative, args.steps, args.cfg,
                                   width, height, seed)
                out_path.write_bytes(data)
                return True
            except Exception as exc:
                print(f"    x {out_path.name} attempt {attempt}: {exc}")
                if not args.dry_run:
                    servers.restart_sd()
                time.sleep(2)
        return False

    try:
        for i in range(1, args.iterations + 1):
            iter_dir = run_dir / f"iteration_{i:02d}"
            tiles_dir = iter_dir / "tiles"
            features_dir = iter_dir / "features"
            units_dir = iter_dir / "units"
            tiles_dir.mkdir(parents=True, exist_ok=True)
            if feature_stems:
                features_dir.mkdir(parents=True, exist_ok=True)
            if unit_stems:
                units_dir.mkdir(parents=True, exist_ok=True)
            iter_manifest: dict[str, Any] = {
                "iteration": i, "tiles": {}, "features": {}, "units": {},
            }

            print(f"\n=== Iteration {i}/{args.iterations} ===")
            iter_started = time.time()

            # ---- 1. iteration-wide global slots --------------------------
            global_context = (
                "These values are shared by every tile and sprite of one "
                "asset set, so they must work for all terrains at once. "
                "Describe mood, colour and light only - never a place, a "
                "story, an event, a battle or an object"
            )
            if theme_keyword:
                global_context += (
                    f". The run direction keyword is '{theme_keyword}': the "
                    "theme phrase may name it, but the shared palette must "
                    "contain only one or two restrained accent colors and "
                    "lighting must remain neutral, even daylight. Do not "
                    "alter natural terrain/material colors or subject identity"
                )
            else:
                global_context += (
                    ". Pick one or two restrained natural accent colors and "
                    "clear neutral daylight; do not make the set dark or dramatic"
                )
            global_values = resolve_slot_bundle(
                GLOBAL_SLOT_SPECS, GLOBAL_FALLBACKS, registry,
                theme="",
                context=global_context,
                forbidden=GLOBAL_THEME_FORBIDDEN,
                label="iteration globals",
            )
            theme = global_values.get("THEME_PHRASE") or GLOBAL_FALLBACKS["THEME_PHRASE"]
            theme = _strip_article(theme).rstrip(".")
            if registry.themes:
                theme = resolve_theme(registry, {"THEME_PHRASE": theme})
            if theme_keyword and theme_keyword.lower() not in theme.lower():
                theme = f"{theme}, {theme_keyword} shown only in sparse small accents"
            registry.remember_theme(theme)
            global_values["THEME_PHRASE"] = theme
            if style_desc:
                global_values["STYLE_PHRASE"] = f"{style_name}: {style_desc}"
            (iter_dir / "theme.txt").write_text(theme + "\n")
            (iter_dir / "keywords_global.json").write_text(
                json.dumps(global_values, indent=2, sort_keys=True) + "\n"
            )
            print(f"    theme: {theme}")
            print(f"    global slots: {global_values}")
            iter_manifest["theme"] = theme
            iter_manifest["global_keywords"] = global_values

            # ---- 2. terrain tiles ----------------------------------------
            if not args.no_terrains:
                for terrain in terrains:
                    # Every terrain gets TERRAIN_VARIANTS sibling ground tiles:
                    # one shared palette/light, three arrangements of the same
                    # pattern, so neighbouring cells of one terrain never look
                    # like the same image repeated.
                    entry: dict[str, Any] = {"variants": {}}
                    iter_manifest["tiles"][terrain] = entry
                    written_tiles: list[Path] = []
                    for variant in range(1, TERRAIN_VARIANTS + 1):
                        suffix = "" if variant == 1 else f"_{variant - 1}"
                        variant_note = TERRAIN_VARIANT_NOTES[
                            (variant - 1) % len(TERRAIN_VARIANT_NOTES)]
                        prompt, keywords = plan_prompt(
                            "terrain", terrain, variant, NEGATIVE_TERRAIN,
                            lambda: build_terrain_prompt(
                                terrain, theme, global_values, registry,
                                style_desc=style_desc,
                                variant_note=variant_note,
                            ),
                        )
                        (iter_dir / f"prompt_{terrain}{suffix}.txt").write_text(
                            prompt + "\n\nNegative prompt: " + NEGATIVE_TERRAIN + "\n"
                        )
                        (iter_dir / f"keywords_{terrain}{suffix}.json").write_text(
                            json.dumps(keywords, indent=2, sort_keys=True) + "\n"
                        )
                        vrec: dict[str, Any] = {
                            "prompt": prompt,
                            "keywords": keywords,
                        }
                        if variant == 1:
                            entry["prompt"] = prompt
                            entry["keywords"] = keywords
                        entry["variants"][str(variant)] = vrec

                        if args.dry_run:
                            print(f"    ~ tile {terrain} [{variant}/"
                                  f"{TERRAIN_VARIANTS}] (dry run)")
                            continue

                        out_path = tiles_dir / f"terrain_{terrain}{suffix}.png"
                        seed = (None if args.seed < 0 else
                                args.seed + i * 100 + len(terrain) * 7
                                + variant * 13)
                        t0 = time.time()
                        ok = render(prompt, NEGATIVE_TERRAIN, out_path,
                                    args.size, args.size, seed=seed)
                        if ok:
                            clean_terrain_tile(out_path)
                            repair_terrain_edges(
                                out_path, crop_fraction=args.edge_crop,
                                blend_fraction=args.edge_blend,
                                pixel_art=pixel_art_terrain,
                            )
                            if not tile_is_usable(out_path):
                                print(f"    ! tile {terrain} [{variant}]: "
                                      f"unusable output")
                                ok = False
                        if ok:
                            print(f"    + tile {terrain} [{variant}/"
                                  f"{TERRAIN_VARIANTS}] "
                                  f"({human(time.time() - t0)})")
                            vrec["output"] = str(out_path.relative_to(run_dir))
                            written_tiles.append(out_path)
                            if variant == 1:
                                entry["output"] = vrec["output"]
                        else:
                            fallback = PUBLIC_TILES / f"terrain_{terrain}{suffix}.png"
                            if not fallback.exists():
                                fallback = PUBLIC_TILES / f"terrain_{terrain}.png"
                            if not fallback.exists():
                                fallback = PUBLIC_TILES / f"terrain_{terrain}_1.png"
                            if fallback.exists():
                                shutil.copy(fallback, out_path)
                                vrec["output"] = str(out_path.relative_to(run_dir))
                                vrec["fallback"] = True
                                written_tiles.append(out_path)
                                if variant == 1:
                                    entry["output"] = vrec["output"]
                                print(f"    ! tile {terrain} [{variant}]: "
                                      f"fallback to the original tile")

                    # Siblings share one border so any two of them can meet on
                    # the board without showing a seam between variants.
                    if len(written_tiles) > 1:
                        harmonise_terrain_edges(written_tiles[0], written_tiles[1:])

            # ---- 3. feature sprites --------------------------------------
            if feature_stems or unit_stems:
                tmp_dir = iter_dir / "_tmp"
                tmp_dir.mkdir(exist_ok=True)

                # per-iteration rolls: the optional dramatic mountain variant
                # and the mountain atmosphere
                rolls: dict[str, Any] = {}
                active: list[str] = []
                for stem in feature_stems:
                    chance = FEATURE_OPTIONAL_STEMS.get(stem)
                    if chance is not None:
                        forced = stem in feature_wanted
                        if not forced and random.random() >= chance:
                            rolls[stem] = "skipped (optional roll)"
                            continue
                    active.append(stem)
                atmosphere_by_stem: dict[str, str] = {}
                # Units are a separate asset category from feature sprites.
                # Keep their selection, manifest entries, prompt files and
                # generated output directory separate too.
                active.extend(unit_stems)
                for stem in active:
                    if stem.startswith("mountains_feature"):
                        # every mountain variant rolls its own atmosphere
                        atmo = roll_weighted(MOUNTAIN_ATMOSPHERE) or ""
                        atmosphere_by_stem[stem] = atmo
                        rolls[f"{stem}_atmosphere"] = atmo or "clear face"
                crazy = random.choice(MOUNTAIN_CRAZY)
                if "mountains_feature_2" in active:
                    rolls["mountains_feature_2_crazy"] = crazy
                if rolls:
                    iter_manifest["rolls"] = rolls
                    print(f"    rolls: {rolls}")

                for stem in active:
                    if stem in UNIT_SPECS:
                        # a game unit sprite: fixed description, no twist
                        spec_key, twist, presentation = stem, "", "unit sprite"
                    else:
                        spec_info = FEATURE_STEM_SPECS.get(stem)
                        if spec_info is None:
                            base = re.sub(r"_?\d+$", "", stem)
                            spec_info = {"spec": base if base in FEATURE_SPECS else "fish",
                                         "twist": f"a {base}"}
                        spec_key = spec_info["spec"]
                        twist = spec_info["twist"]
                        presentation = "resource feature sprite"
                    is_unit = stem in UNIT_SPECS
                    unit_key = stem[len("unit_"):] if is_unit else ""

                    # per-stem pin clauses: every mountain variant carries its
                    # rolled atmosphere, and the second one also its dramatic
                    # rolled extra
                    extra: tuple[str, ...] = ()
                    if stem in atmosphere_by_stem:
                        clauses: list[str] = []
                        if atmosphere_by_stem[stem]:
                            clauses.append(atmosphere_by_stem[stem])
                        if stem == "mountains_feature_2":
                            clauses.append(crazy)
                        extra = tuple(clauses)

                    # geometry and init art are shared by all variants of a
                    # stem; every variant gets its own freshly resolved prompt
                    fw = args.feature_size
                    fh = int(args.feature_size * 1.5)
                    if stem in UNIT_WIDE_STEMS:
                        fw, fh = fh, fw
                    fpath = inputs_by_stem.get(stem)
                    if unit_key:
                        fpath = None
                        if UNIT_SVG_FILES.get(unit_key):
                            # the game ships real artwork for this unit ->
                            # img2img keeps the identity of that picture
                            src_png = tmp_dir / f"{stem}_src.png"
                            if rasterise_unit_svg(unit_key, src_png):
                                fpath = src_png
                            else:
                                print(f"    [~] unit {unit_key}: SVG artwork "
                                      f"could not be rasterised -> text-only")
                    elif stem in FEATURE_TEXT_ONLY_STEMS:
                        fpath = None
                    init_image: Path | None = None
                    if fpath is not None:
                        init_path = tmp_dir / f"{stem}_init.png"
                        prepare_feature_input(
                            fpath, init_path, fw, fh,
                            mode=FEATURE_SUBJECT_MODE.get(stem, "cluster"),
                            level=args.bg_level, softness=args.bg_softness,
                        )
                        init_image = init_path

                    entry: dict[str, Any] = {"spec": spec_key, "variants": {}}
                    if unit_key:
                        entry["unit"] = unit_names.get(unit_key, unit_key)
                        entry["game_icon"] = unit_icons.get(unit_key, "")
                        if UNIT_SVG_FILES.get(unit_key):
                            entry["game_artwork"] = UNIT_SVG_FILES[unit_key]
                            entry["source"] = "game svg artwork (img2img)"
                        else:
                            entry["source"] = "fixed text description"
                    asset_manifest = iter_manifest["units" if is_unit else "features"]
                    asset_manifest[stem] = entry

                    variant_count = UNIT_VARIANTS if is_unit else 1
                    for variant in range(1, variant_count + 1):
                        suffix = "" if variant == 1 else f"_{variant}"
                        asset_prefix = "unit" if is_unit else "feature"
                        prompt_stem = unit_key if is_unit else stem
                        negative_prompt = NEGATIVE_UNIT if is_unit else NEGATIVE_FEATURE
                        if is_unit and UNIT_NEGATIVE_EXTRA.get(stem):
                            negative_prompt += ", " + UNIT_NEGATIVE_EXTRA[stem]
                        prompt, keywords = plan_prompt(
                            asset_prefix, stem, variant, negative_prompt,
                            lambda: build_feature_prompt(
                                stem, spec_key, twist, theme, global_values,
                                registry, extra_clauses=extra,
                                presentation=presentation,
                                context_extra=THEME_ACCENT_CLAUSE,
                                style_desc=style_desc,
                                style_context=style_context,
                                unit_style_desc=unit_style_desc,
                            ),
                        )
                        (iter_dir /
                         f"prompt_{asset_prefix}_{prompt_stem}{suffix}.txt").write_text(
                            prompt + "\n\nNegative prompt: "
                            + negative_prompt + "\n"
                        )
                        (iter_dir /
                         f"keywords_{asset_prefix}_{prompt_stem}{suffix}.json").write_text(
                            json.dumps(keywords, indent=2, sort_keys=True)
                            + "\n"
                        )
                        vrec: dict[str, Any] = {
                            "prompt": prompt,
                            "keywords": keywords,
                        }
                        if variant == 1:
                            entry["prompt"] = prompt
                            entry["keywords"] = keywords
                        if variant_count > 1:
                            entry["variants"][str(variant)] = vrec

                        if args.dry_run:
                            print(f"    ~ {asset_prefix} {stem} [{variant}/"
                                  f"{variant_count}] (dry run)")
                            continue

                        raw_path = tmp_dir / f"{stem}_raw{suffix}.png"
                        out_name = FEATURE_OUTPUT_NAMES.get(stem, stem)
                        out_name = f"{out_name}{suffix}"
                        asset_dir = units_dir if is_unit else features_dir
                        out_path = asset_dir / f"{out_name}.png"

                        t0 = time.time()
                        seed = (None if args.seed < 0 else
                                args.seed + i * 1000 + len(stem)
                                + variant * 7)
                        ok = render(prompt, negative_prompt, raw_path, fw, fh,
                                    init_image=init_image, seed=seed)

                        # the untouched original is kept next to the result,
                        # before the background is removed
                        backup_path = (asset_dir / BACKUP_DIR_NAME /
                                       f"{out_name}.png")
                        backup_path.parent.mkdir(parents=True, exist_ok=True)
                        if raw_path.exists():
                            shutil.copy(raw_path, backup_path)
                        elif init_image is not None:
                            shutil.copy(init_image, backup_path)

                        if ok:
                            sprite = Image.open(raw_path).convert("RGB")
                            if args.use_rembg and remove_background_rembg(
                                    raw_path, out_path):
                                method = "rembg"
                            else:
                                sprite = key_out_black(
                                    sprite, level=args.bg_level,
                                    softness=args.bg_softness)
                                sprite.save(out_path, "PNG")
                                method = "black-key"
                        elif init_image is not None:
                            # fallback: use the prepared input, still
                            # background-free
                            sprite = Image.open(init_image).convert("RGB")
                            sprite = key_out_black(sprite, level=args.bg_level,
                                                   softness=args.bg_softness)
                            sprite.save(out_path, "PNG")
                            method = "input-fallback"
                        else:
                            # a stem without input art cannot fall back; for a
                            # multi-variant unit the other variants still run
                            vrec["failed"] = True
                            print(f"    ! {asset_prefix} {stem} [{variant}/"
                                  f"{variant_count}]: render failed"
                                  + (", no fallback input (variant skipped)"
                                     if init_image is None else
                                     " (variant skipped)"))
                            continue

                        clean_feature_sprite(out_path, level=args.bg_level,
                                             softness=args.bg_softness)
                        # guard: a sprite that is (almost) fully opaque means
                        # the model painted a grey backdrop panel instead of
                        # a black background
                        _alpha = np.array(
                            Image.open(out_path).convert("RGBA"))[:, :, 3]
                        _cover = float((_alpha > 24).mean())
                        if _cover > 0.88:
                            print(f"    ~ {out_name}: only "
                                  f"{(1 - _cover) * 100:.0f}% of the canvas "
                                  f"is transparent - the sprite may still "
                                  f"carry a backdrop panel; increase "
                                  f"--bg-level or re-run this stem")
                            vrec["opaque_ratio"] = round(_cover, 2)
                        vrec["output"] = str(out_path.relative_to(run_dir))
                        vrec["backup"] = str(backup_path.relative_to(run_dir))
                        vrec["method"] = method
                        if variant == 1:
                            entry["output"] = vrec["output"]
                            entry["backup"] = vrec["backup"]
                            entry["method"] = method
                        print(f"    + {asset_prefix} {stem} "
                              f"[{variant}/{variant_count}] -> {out_name}.png "
                              f"({method}, {human(time.time() - t0)})")

                shutil.rmtree(tmp_dir, ignore_errors=True)

            iter_manifest["seconds"] = round(time.time() - iter_started, 1)
            (iter_dir / "manifest.json").write_text(
                json.dumps(iter_manifest, indent=2) + "\n"
            )
            run_manifest["iteration_manifests"].append(iter_manifest)
            print(f"    -> {iter_dir}  ({human(iter_manifest['seconds'])})")
    finally:
        run_manifest["seconds"] = round(time.time() - started, 1)
        run_manifest["finished"] = time.strftime("%Y-%m-%d %H:%M:%S")
        (run_dir / "run.json").write_text(json.dumps(run_manifest, indent=2) + "\n")
        if not args.keep_servers:
            servers.shutdown()

    if args.emit_prompts:
        label = (args.theme_keyword.strip() or args.style_keyword.strip()
                 or args.unit_style_keyword.strip() or "classic")
        bundle = bundle_document(label, args)
        Path(args.emit_prompts).write_text(
            json.dumps(bundle, indent=2, sort_keys=True, ensure_ascii=False)
            + "\n")
        print(f"[*] prompt bundle written: {args.emit_prompts} "
              f"({len(bundle['assets'])} assets)")

    print(f"\nDone in {human(time.time() - started)}. Tile sets in: {run_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
