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
     background.  Every feature carries a fixed positive clause that keeps
     the subject complete and fully visible inside the frame - FLUX ignores
     negative prompts, so framing rules are phrased positively only.
  4. The black ``#000000`` background of every sprite is keyed out to a
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
descriptions in UNIT_SPECS; units showing a person or animal carry a
positively phrased limb-completeness clause.

With ``--theme-keyword`` (/t/ THEME_KEYWORD) one art-direction keyword (e.g.
Halloween, Christmas, "Transylvania and vampires") is shot through theme,
palette, lighting and every resolved slot; feature animals may swap to close
themed equivalents (skeleton horse, reindeer, sea serpent, ...).

With ``--style-keyword`` (STYLE_KEYWORD) one art style (a STYLE_KEYS name
such as american_comic or manga, or a freeform phrase) changes only HOW every
asset is rendered - technique, linework and medium - while every subject
identity stays untouched; ``--write-batch --batch-style-mode`` writes a whole
style tour (add ``--batch-terrains``/``--batch-features`` to pin one selection
across all jobs).

With ``--write-batch`` the generator writes a bash script that runs one
tile-set job after another (one per comma-separated keyword, '' = classic
run), so a whole campaign can run unattended in the background.

Result: ``<output-root>/<unix-timestamp>/iteration_01 .. iteration_N`` each
containing ``tiles/`` (all terrain tiles) and ``features/`` (all feature
sprites, transparent background).  Per-iteration ``keywords_*.json`` files log
which concrete phrases the local model used for each abstract slot.

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
from typing import Any, Callable, Iterable

import numpy as np
from PIL import Image

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

LLAMA_SERVER_BIN = Path(os.environ.get(
    "LLAMA_SERVER_BIN", "/home/jonas/git/Local_AI/source/llama.cpp/build/bin/llama-server"
))
QWEN_MODEL = Path(os.environ.get(
    "QWEN_MODEL", "/home/jonas/git/Local_AI/models/main_model/Qwen3-4B-Q4_K_M.gguf"
))

SD_PORT = int(os.environ.get("SD_PORT", "8081"))
LLAMA_PORT = int(os.environ.get("LLAMA_PORT", "8099"))

SD_LOG = os.environ.get("SD_LOG", "/tmp/sd_server_variate.log")
LLAMA_LOG = os.environ.get("LLAMA_LOG", "/tmp/llama_server_variate.log")

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

TERRAINS = [
    "arctic", "desert", "forest", "grassland", "hills", "jungle",
    "mountains", "ocean", "plains", "river", "swamp", "tundra",
]

# ===========================================================================
# Prompt structure (matches the project art direction)
#   Title line .......: "seamless top-down 2D ground texture map of ..."
#   Style & Art ......: semi-realistic strategy game illustration + theme
#   Subject Details ..: concrete description of what is across the surface
#   Technical Specs ..: orthographic top-down camera, full-bleed, no framing
#   Negative prompt ..: photorealism / backgrounds / framing artifacts
#
# The {subject} and {details} parts are built from the abstract #KEYWORD#
# templates further down - they are never hard-coded.
# ===========================================================================

TERRAIN_PROMPT = """Seamless top-down 2D ground texture map of {subject}, pure orthographic bird's-eye view looking straight down at the ground plane, 90% to 100% full-bleed canvas coverage, flat surface pattern, seamlessly tileable on all four edges, natural varied non-repeating pattern.

Style & Art Direction: Highly detailed semi-realistic digital painting, modern strategy game illustration, intricate surface details, natural textures, realistic lighting and soft shading, crisp high resolution, no thick cartoon outlines.{style} {theme}

Subject Details: {details}

Technical Specs: Flat map view, strictly top-down overhead perspective, no tree trunks, no side perspective, no vertical horizon, continuous organic texture, no repeating grid pattern, even coverage from edge to edge, crisp 8k digital painting."""

FEATURE_PROMPT = """isometric 2D video game {presentation} of {subject}, isolated standalone central sprite, isometric strategic 3/4 game view showing height and volume, centrally composed asset, well-balanced framing, the whole subject complete and fully visible in the central canvas area, every part of the silhouette fully inside the frame and surrounded by generous clear margin on all four sides, tightly framed around the subject, centered on a completely uniform pure black background that fills the whole canvas edge to edge, easy masking background, game UI icon sprite, isolated subject.

Style & Art Direction: Hand-drawn fantasy strategy game illustration, Civilization V game asset style, clean dark linework outlines, smooth cell shading, vibrant yet grounded color palette.{style} {theme}

Subject Details: {details} The sprite shows ONLY the feature itself - {subject} - floating on a completely empty solid pure black #000000 background, clean flat black around every edge of the subject for easy masking.

Technical Specs: High contrast, top-down 45-degree isometric camera view, perfectly isolated subject on a pure black #000000 background, the full silhouette inside the frame with crisp black margin on all four sides, 8k resolution, crisp vector-like digital painting."""

NEGATIVE_TERRAIN = (
    "photorealistic, realistic landscape, photography, border frame, "
    "ground plane background, horizon line, sky, ambient occlusion shadows on "
    "canvas, cut off edges, blurry lines, 3D render artifacts, low resolution, "
    "empty background, transparent corners, grid lines, diamond layout, "
    "repeating pattern, tiled grid, isolated subject on black, black "
    "background, pitch black, vignette, frame, picture, poster, text, "
    "watermark, characters, buildings, animals"
)

# NOTE: the bare word "background" is deliberately NOT negative here - the
# sprite must sit on a *black* background.  Only competing backdrops are.
NEGATIVE_FEATURE = (
    "scenery, backdrop, environment, landscape, horizon, sky, clouds, "
    "terrain, ground plane, grass, dirt, sand, water surface, waves, foam, "
    "rocks, trees, plants, bushes, forest, border frame, cast shadow, "
    "diamond tile, hexagon, isometric tile, tile grid, snowflakes, "
    "photorealistic, photography, 3D render, blurry lines, low resolution, "
    "text, watermark, multiple objects, collage, thumbnail layout, "
    "white background, light background, gradient background, textured "
    "background, studio backdrop, floor, wall, table"
)

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
#     TEXTURE_DETAIL  micro texture and small structures
#     ACCENT_ELEMENT  scattered decorations on the surface
#     EDGE_ELEMENT    small details toward the tile corners
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

# A theme describes light, never a place or a story - without this the model
# keeps painting the same "golden hour over a misty valley".
GLOBAL_THEME_FORBIDDEN = [
    "valley", "plain", "mountain", "hill", "forest", "field", "river", "sea",
    "ocean", "desert", "city", "castle", "village", "island", "beach", "branch",
    "tree", "lake", "frozen", "icy", "glacier", "tundra", "arctic", "jungle",
    "battle", "war", "ruin", "abandoned", "destroyed", "kingdom", "empire",
    "siege",
]

GLOBAL_SLOT_SPECS = [
    {"name": "THEME_PHRASE",
     "help": "the shared mood of the whole asset set - ONLY a season, a time of "
             "day and a light quality (3-8 words), never a place, story, event "
             "or object",
     "max_words": 8, "forbidden": GLOBAL_THEME_FORBIDDEN},
    {"name": "GLOBAL_PALETTE",
     "help": "the shared colour mood of the whole asset set - only colours and "
             "tones, 3-6 words, no light, no shadows, no sun",
     "max_words": 8, "forbidden": ["light", "shadow", "glow", "sun", "moon",
                                    "ray", "beam"]},
    {"name": "GLOBAL_LIGHTING",
     "help": "the shared lighting mood of the whole asset set - only the "
             "quality and direction of the light, 3-6 words",
     "max_words": 8, "not_color_list": True},
]

# Colour words - a slot that is nothing but a list of these describes a
# palette, not a lighting mood.
COLOR_WORDS = {
    "red", "orange", "yellow", "green", "blue", "purple", "violet", "pink",
    "brown", "grey", "gray", "black", "white", "gold", "golden", "silver",
    "bronze", "copper", "rust", "russet", "crimson", "scarlet", "amber",
    "ochre", "olive", "emerald", "sapphire", "teal", "cyan", "magenta",
    "maroon", "beige", "cream", "ivory", "navy", "indigo", "slate", "ash",
    "charcoal", "tan", "khaki", "azure", "turquoise", "lime", "jade", "mint",
    "coral", "salmon", "pearl", "tin", "pewter", "brass", "umber", "sienna",
    "sepia", "burgundy", "fuchsia", "lavender", "plum", "amber", "cerulean",
    "saffron", "apricot", "ebony", "ivory", "mint", "coral", "peach",
}

# The lighting slot must talk about light - a bare colour list is a palette,
# not a lighting mood.  The check is done by ``looks_like_color_list()``,
# which is softer than an anchor list and never throws a good phrase away.

# ``theme: False`` marks a slot that must describe the *physical* surface
# only - the theme must never leak into it (that is what turned a forest into
# a battlefield or an ocean into an ice field).
TERRAIN_SLOT_SPECS = [
    {"name": "SURFACE_FORM",
     "help": "the overall kind of terrain, e.g. 'vast frozen glacial ice plain'",
     "max_words": 10, "theme": False},
    {"name": "BASE_MATERIAL",
     "help": "the dominant ground material of the surface",
     "max_words": 10, "theme": False},
    {"name": "TEXTURE_DETAIL",
     "help": "micro texture and small structures spread across the surface",
     "max_words": 14, "theme": False},
    {"name": "ACCENT_ELEMENT",
     "help": "small scattered decorations lying on the surface",
     "max_words": 14, "theme": False},
    {"name": "EDGE_ELEMENT",
     "help": "tiny details placed toward the tile corners",
     "max_words": 14, "theme": False},
    {"name": "LIGHTING_NOTE",
     "help": "one short sentence about the light and shadow falling on this "
             "terrain - it must match the theme",
     "max_words": 14, "theme": True},
    {"name": "COLOR_PALETTE",
     "help": "the concrete colour range of this terrain - it must match the theme",
     "max_words": 10, "theme": True},
]

FEATURE_SLOT_SPECS = [
    {"name": "FEATURE_KIND",
     "help": "the kind of thing the feature is - a plain noun phrase of 1-3 "
             "words such as 'fish', 'horse' or 'tree cluster'; no pose, no "
             "view, no adjectives",
     "max_words": 3, "theme": False},
    {"name": "FEATURE_FORM",
     "help": "the shape, pose and silhouette of the feature",
     "max_words": 14, "theme": False},
    {"name": "FEATURE_DETAIL",
     "help": "surface detail, markings and texture of the feature",
     "max_words": 14, "theme": False},
    {"name": "FEATURE_PALETTE",
     "help": "the natural colour range of the feature's own material",
     "max_words": 10, "theme": False},
    {"name": "FEATURE_LIGHTING",
     "help": "how the light falls on the feature - it must match the theme",
     "max_words": 10, "theme": True},
    {"name": "FEATURE_RENDERING",
     "help": "the rendering treatment, e.g. 'clean dark outlines with soft cell "
             "shading'",
     "max_words": 12, "theme": False},
]

# --- hard identities: the local model must never drift away from these -----

TERRAIN_IDENTITIES = {
    "arctic": "a frozen arctic ice field",
    "desert": "a sun-scorched desert of golden sand dunes",
    "forest": "a temperate forest floor ground surface (no trees)",
    "grassland": "an open green grassland",
    "hills": "rolling green and brown hills",
    "jungle": "a tropical jungle floor ground surface (no trees)",
    "mountains": "a rocky mountain ground surface (no peaks, ground only)",
    "ocean": "a deep open ocean water surface",
    "plains": "an open dry plains",
    "river": "a fresh water river surface",
    "swamp": "a murky swamp ground surface",
    "tundra": "a cold windswept tundra",
}

# Words that must appear in the resolved SURFACE_FORM - this is the guard that
# keeps "forest" from degrading into "desert".
TERRAIN_ANCHORS = {
    "arctic": ["ice", "snow", "frozen", "glacier", "arctic", "tundra"],
    "desert": ["desert", "sand", "dune", "arid", "oasis"],
    "forest": ["forest", "wood", "leaf", "moss", "soil", "floor", "trees"],
    "grassland": ["grass", "meadow", "grassland", "prairie", "field", "savanna"],
    "hills": ["hill", "mound", "slope", "knoll", "ridge", "rolling"],
    "jungle": ["jungle", "tropical", "canopy", "vines", "fern", "rainforest"],
    "mountains": ["mountain", "rock", "scree", "stone", "alpine", "ground"],
    "ocean": ["ocean", "sea", "water", "waves", "marine", "blue"],
    "plains": ["plain", "steppe", "prairie", "grassland", "dry", "savanna"],
    "river": ["river", "stream", "water", "brook", "creek"],
    "swamp": ["swamp", "marsh", "bog", "muddy", "mire", "fen"],
    "tundra": ["tundra", "moss", "lichen", "cold", "frost", "plain"],
}

# Words that must NOT show up in a resolved terrain slot - this is what stops
# an ocean from turning into an ice field or a forest into a battlefield.
# The "no ice" set is added to every warm terrain, the "no water" set to the
# dry ones.
_NO_ICE = ["frozen", "icy", "glacier", "snowdrift", "permafrost"]
_NO_WATER = ["wade", "kayak", "canoe", "buoy", "anchor", "harbour", "harbor"]

TERRAIN_FORBIDDEN = {
    "arctic": ["sand", "grass", "mud", "palm", "cactus", "jungle"] + _NO_WATER,
    "desert": ["ice", "snow", "frost", "mud", "moss", "jungle", "water"] + _NO_ICE + _NO_WATER,
    "forest": ["sand", "dune", "cactus", "snow", "salt", "water", "wave", "ice"] + _NO_ICE + _NO_WATER,
    "grassland": ["sand", "dune", "cactus", "snow", "ice", "mud", "rock face"] + _NO_ICE + _NO_WATER,
    "hills": ["cactus", "snow", "ice", "palm", "swamp"] + _NO_ICE + _NO_WATER,
    "jungle": ["snow", "ice", "frost", "sand", "dune", "cactus", "savanna"] + _NO_ICE + _NO_WATER,
    "mountains": ["sand", "dune", "cactus", "palm", "mangrove", "swamp"] + _NO_WATER,
    "ocean": ["ice", "snow", "frost", "sand", "dune", "grass", "mud", "soil",
              "rock", "leaf", "bark", "crack", "cracked", "cracks", "dry",
              "polygon", "voronoi", "crust", "shell", "mudflat"] + _NO_ICE,
    "plains": ["snow", "ice", "frost", "cactus", "jungle", "swamp", "mangrove"] + _NO_ICE + _NO_WATER,
    "river": ["sand", "dune", "cactus", "ice", "snow", "jungle", "moss", "mud",
              "crack", "cracked", "cracks", "dry"] + _NO_ICE,
    "swamp": ["sand", "dune", "cactus", "snow", "ice", "glacier"] + _NO_ICE,
    "tundra": ["sand", "dune", "cactus", "palm", "jungle", "swamp"] + _NO_WATER,
}

# The colour palette of a terrain must keep its own colour family - without
# this an ocean can turn into a golden cracked lake bed.
TERRAIN_PALETTE_ANCHORS = {
    "arctic": ["white", "ice", "blue", "pale", "cyan", "grey", "silver", "frost"],
    "desert": ["ochre", "gold", "tan", "sand", "amber", "yellow", "beige", "brown"],
    "forest": ["green", "brown", "moss", "olive", "umber", "earth"],
    "grassland": ["green", "yellow", "lime", "olive", "emerald", "fresh"],
    "hills": ["green", "brown", "olive", "earth", "tan"],
    "jungle": ["green", "emerald", "olive", "lime", "jade", "forest"],
    "mountains": ["grey", "gray", "brown", "slate", "stone", "mauve"],
    "ocean": ["blue", "navy", "sapphire", "teal", "cyan", "aqua", "indigo",
              "turquoise", "sea green"],
    "plains": ["gold", "green", "olive", "straw", "tan", "amber", "yellow"],
    "river": ["blue", "teal", "cyan", "aqua", "green", "turquoise", "sapphire"],
    "swamp": ["olive", "brown", "green", "murky", "moss", "umber", "muddy"],
    "tundra": ["grey", "gray", "green", "moss", "lichen", "olive", "pale", "brown"],
}

# A short, fixed clause that pins the material of a terrain down.  The
# abstract slots still describe every detail, but the tile can never stop
# being the terrain it is supposed to be.
TERRAIN_IDENTITY_CLAUSE = {
    "arctic": "Solid arctic ice and snow, unmistakably a frozen surface.",
    "desert": "Dry sand and sun-baked earth, unmistakably arid ground.",
    "forest": "Forest soil and leaf litter, unmistakably the floor of a forest.",
    "grassland": "Open meadow grass, unmistakably grassland.",
    "hills": "Grassy hills and slopes, unmistakably rolling high ground.",
    "jungle": "Tropical soil and jungle litter, unmistakably a jungle floor.",
    "mountains": "Bare rock and scree, unmistakably high mountain ground.",
    "ocean": "Liquid open sea water with moving ripples, unmistakably deep water.",
    "plains": "Short dry steppe grass, unmistakably open flat plains.",
    "river": "Liquid fresh river water with moving ripples, unmistakably running water.",
    "swamp": "Murky standing water, mud and marsh, unmistakably swamp.",
    "tundra": "Moss, lichen and frozen soil, unmistakably cold tundra.",
}

# The slots that describe the *physical* surface.  Only these may be held to
# the strict word list - a colour palette may well say "slate rock grey" and a
# lighting note may well say "light cracks across the surface".
TERRAIN_MATERIAL_SLOTS = (
    "SURFACE_FORM", "BASE_MATERIAL", "TEXTURE_DETAIL",
    "ACCENT_ELEMENT", "EDGE_ELEMENT",
)

# Words that are perfectly normal inside a colour or a light phrase.
_COLOR_SAFE_WORDS = {
    "rock", "leaf", "bark", "crack", "cracked", "cracks", "dry", "shell",
    "water", "wave", "waves", "grass",
}

# The colour palette may not name a foreign material either.
TERRAIN_COLOR_FORBIDDEN = {
    terrain: [w for w in words if w not in _COLOR_SAFE_WORDS]
    for terrain, words in TERRAIN_FORBIDDEN.items()
}

# Extra hard constraints that must survive every variation.
TERRAIN_EXTRA_CONSTRAINTS = {
    "forest": "No trees, no trunks, no canopies, no vertical elements - only "
              "the flat ground layer. Strict top-down bird's-eye view.",
    "jungle": "No trees, no trunks, no canopy, no vertical elements - only "
              "the flat ground layer. Strict top-down bird's-eye view.",
    "mountains": "No peaks, no cliffs, no vertical elements - only the flat "
                 "rocky ground layer. Strict top-down bird's-eye view.",
    "swamp": "No tree stumps, no vertical elements - only the flat ground "
             "layer. Strict top-down bird's-eye view.",
}

TERRAIN_BASE_CONSTRAINT = (
    "No horizon, no sky, no scenery, no buildings, no characters, no animals, "
    "no frame and no vignette - only the flat ground surface, edge to edge."
)

# --- abstract terrain templates -------------------------------------------

TERRAIN_SUBJECT_TEMPLATE = "a #SURFACE_FORM#"

TERRAIN_DETAILS_TEMPLATE = (
    "A continuous surface of #BASE_MATERIAL# with #TEXTURE_DETAIL#, "
    "#ACCENT_ELEMENT#, and #EDGE_ELEMENT#. #LIGHTING_NOTE# The surface is "
    "rendered in #COLOR_PALETTE#, unified by a #GLOBAL_PALETTE# and "
    "#GLOBAL_LIGHTING#."
)

# --- abstract feature templates -------------------------------------------

FEATURE_SUBJECT_TEMPLATE = "a single #FEATURE_KIND#"

FEATURE_DETAILS_TEMPLATE = (
    "The feature is #FEATURE_FORM#, with #FEATURE_DETAIL#. It is painted in "
    "#FEATURE_PALETTE# and unified by a #GLOBAL_PALETTE#. #FEATURE_LIGHTING#. "
    "#FEATURE_RENDERING#."
)

# --- fallback phrases (used whenever the model is unavailable/unusable) ----

GLOBAL_FALLBACKS = {
    "THEME_PHRASE": "balanced natural daylight",
    "GLOBAL_PALETTE": "natural daylight colours",
    "GLOBAL_LIGHTING": "soft balanced natural daylight",
}

TERRAIN_FALLBACKS = {
    "arctic": {
        "SURFACE_FORM": "vast frozen arctic ice plain",
        "BASE_MATERIAL": "packed white-blue glacial ice",
        "TEXTURE_DETAIL": "deep cracked crevasses and raised pressure ridges",
        "ACCENT_ELEMENT": "drifting snow patches and pale frost crystals sparkling along the ridges",
        "EDGE_ELEMENT": "small shards of translucent ice near the tile corners",
        "LIGHTING_NOTE": "Subtle pale blue shadows pool inside the crevasses",
        "COLOR_PALETTE": "white, ice blue and pale frost grey tones",
    },
    "desert": {
        "SURFACE_FORM": "sun-scorched desert of golden sand dunes",
        "BASE_MATERIAL": "rolling ochre and golden sand",
        "TEXTURE_DETAIL": "soft wind-rippled dune ridges and dry cracked patches of pale earth",
        "ACCENT_ELEMENT": "scattered small smooth pebbles",
        "EDGE_ELEMENT": "sparse tiny cactus and dry brush near the tile edges",
        "LIGHTING_NOTE": "Warm sunlight rakes across the dune ridges",
        "COLOR_PALETTE": "ochre, gold and sun-bleached tan tones",
    },
    "forest": {
        "SURFACE_FORM": "temperate forest floor ground surface",
        "BASE_MATERIAL": "dark brown forest soil",
        "TEXTURE_DETAIL": "fallen leaves, small ferns, moss patches, twigs and scattered acorns",
        "ACCENT_ELEMENT": "dappled light patterns shifting across the soil",
        "EDGE_ELEMENT": "a few low-growing forest plants toward the tile corners",
        "LIGHTING_NOTE": "Soft dappled sunlight filters through onto the ground",
        "COLOR_PALETTE": "dark browns, deep greens and mossy tones",
    },
    "grassland": {
        "SURFACE_FORM": "open green grassland",
        "BASE_MATERIAL": "lush bright green meadow grass",
        "TEXTURE_DETAIL": "soft rolling tufts with a gentle carpet-like shading",
        "ACCENT_ELEMENT": "tiny wildflowers in yellow and white and a few small rounded bushes",
        "EDGE_ELEMENT": "scattered grass tufts near the tile corners",
        "LIGHTING_NOTE": "Even natural daylight lays soft green shading across the meadow",
        "COLOR_PALETTE": "fresh greens with yellow and white accents",
    },
    "hills": {
        "SURFACE_FORM": "cluster of smooth rolling green and brown hills",
        "BASE_MATERIAL": "grassy sod hilltops packed tightly across the surface",
        "TEXTURE_DETAIL": "green grass on top and exposed light brown earth on the steep sides",
        "ACCENT_ELEMENT": "small rocky outcrops and a few shrubs between the hills",
        "EDGE_ELEMENT": "gentle hill slopes fading toward the tile corners",
        "LIGHTING_NOTE": "Soft directional light models the hill curvature",
        "COLOR_PALETTE": "greens and light earth browns",
    },
    "jungle": {
        "SURFACE_FORM": "tropical jungle floor ground surface",
        "BASE_MATERIAL": "dark moist soil covered in dense moss",
        "TEXTURE_DETAIL": "small ferns, tropical leaf litter and low ground vines",
        "ACCENT_ELEMENT": "scattered exotic leaf debris and tiny sprouting plants",
        "EDGE_ELEMENT": "creeping vines reaching toward the tile corners",
        "LIGHTING_NOTE": "Humid dim light with deep soft shadows",
        "COLOR_PALETTE": "dark greens and moist earth browns",
    },
    "mountains": {
        "SURFACE_FORM": "rocky mountain ground surface",
        "BASE_MATERIAL": "grey-brown scree and broken rocks",
        "TEXTURE_DETAIL": "gravel, shattered stone and patches of bare rock",
        "ACCENT_ELEMENT": "sharp-edged rock fragments",
        "EDGE_ELEMENT": "loose gravel drifting toward the tile corners",
        "LIGHTING_NOTE": "Crisp high-altitude light throws hard small shadows",
        "COLOR_PALETTE": "greys and muted browns",
    },
    "ocean": {
        "SURFACE_FORM": "deep open ocean water surface",
        "BASE_MATERIAL": "natural blue water with realistic depth transparency",
        "TEXTURE_DETAIL": "subtle realistic surface ripples and gentle wave crests with white sea foam",
        "ACCENT_ELEMENT": "light caustic patterns shifting across the surface",
        "EDGE_ELEMENT": "lighter turquoise shallows toward the tile corners",
        "LIGHTING_NOTE": "Bright daylight sparkles on the moving water",
        "COLOR_PALETTE": "layered blues with turquoise accents",
    },
    "plains": {
        "SURFACE_FORM": "open dry plains",
        "BASE_MATERIAL": "dry golden-green plain grassland with short patchy grass",
        "TEXTURE_DETAIL": "small tufts of wheat-coloured steppe grass",
        "ACCENT_ELEMENT": "scattered tiny stones and a few small dry shrubs",
        "EDGE_ELEMENT": "patchy dry grass toward the tile corners",
        "LIGHTING_NOTE": "Warm natural light with a dry hazy softness",
        "COLOR_PALETTE": "warm earthy golden-green tones",
    },
    "river": {
        "SURFACE_FORM": "winding fresh water river",
        "BASE_MATERIAL": "natural blue river water with realistic depth transparency",
        "TEXTURE_DETAIL": "subtle realistic surface ripples and a naturally varied water flow",
        "ACCENT_ELEMENT": "smooth river stones along the banks",
        "EDGE_ELEMENT": "bright green grassy banks with small reeds at the water edge",
        "LIGHTING_NOTE": "Clear daylight reflects off the moving water",
        "COLOR_PALETTE": "fresh blues and greens",
    },
    "swamp": {
        "SURFACE_FORM": "murky swamp ground surface",
        "BASE_MATERIAL": "dark muddy water and brown-green stagnant pools",
        "TEXTURE_DETAIL": "marsh grass tufts, lily pads and soft muddy banks",
        "ACCENT_ELEMENT": "floating lily pads drifting on the still water",
        "EDGE_ELEMENT": "marsh grass thickening toward the tile corners",
        "LIGHTING_NOTE": "Dim overcast light with murky soft shadows",
        "COLOR_PALETTE": "dark olives, browns and muddy greens",
    },
    "tundra": {
        "SURFACE_FORM": "cold windswept tundra",
        "BASE_MATERIAL": "pale grey-green tundra ground",
        "TEXTURE_DETAIL": "patches of dry moss and lichen and thin brittle grass tufts",
        "ACCENT_ELEMENT": "scattered small rocks and dirty melting snow in the shade",
        "EDGE_ELEMENT": "lichen patches creeping toward the tile corners",
        "LIGHTING_NOTE": "Cold diffuse light with muted shadows",
        "COLOR_PALETTE": "muted grey-green and pale cold tones",
    },
}

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

FEATURE_INPUT_GLOB = "**/*.png"

# The game (TerrainTextureManager) expects these exact file names.
FEATURE_OUTPUT_NAMES = {
    "fish1": "terrain_ocean_fish",
    "fish2": "terrain_ocean_fish_2",
    "fish3": "terrain_ocean_fish_3",
    "fish4": "terrain_ocean_fish_4",
    "fish5": "terrain_ocean_fish_5",
    "horses": "terrain_plains_horses",
    "horses_2": "terrain_plains_horses_2",
    "forest_feature_1": "terrain_forest_feature_1",
    "forest_feature_2": "terrain_forest_feature_2",
    "forest_feature_3": "terrain_forest_feature_3",
    "jungle_feature": "terrain_jungle_feature",
    "hills_feature": "terrain_hills_feature",
    "swamp_feature": "terrain_swamp_feature",
    "mountains_feature_1": "terrain_mountains_feature_1",
    "mountains_feature_2": "terrain_mountains_feature_2",
    "mountains_feature_3": "terrain_mountains_feature_3",
    "mountains_feature_4": "terrain_mountains_feature_4",
    "seal": "terrain_arctic_seal",
    "gems": "terrain_jungle_gems",
    "gold": "terrain_mountains_gold",
    "coal": "terrain_hills_coal",
    "oil": "terrain_swamp_oil",
    "game": "terrain_forest_game",
    "oasis": "terrain_desert_oasis",
}

# Every feature stem, in render order.  The stems below with an input picture
# (src/assets/resources/<stem>.png) are rendered with img2img so they keep the
# identity of the artwork; all other stems are composed purely from their text
# prompt onto the black sprite background.
FEATURE_STEM_ORDER = [
    "fish1", "fish2", "fish3", "fish4", "fish5",
    "horses", "horses_2",
    "forest_feature_1", "forest_feature_2", "forest_feature_3",
    "jungle_feature",
    "hills_feature", "swamp_feature",
    "mountains_feature_1", "mountains_feature_2",
    "mountains_feature_3", "mountains_feature_4",
    "seal", "gems", "gold", "coal", "oil", "game", "oasis",
]

# Optional stems: rendered only on a per-iteration roll, so some iterations
# carry the extra image and others stay without it.  Naming the stem exactly
# in `--features` forces it on.  (Currently empty: every stem including all
# four mountain variants renders ALWAYS.)
FEATURE_OPTIONAL_STEMS: dict[str, float] = {}

# These stems are always rendered from text alone, even when an input picture
# exists: the prompt defines their composition (the proud wild horse poses,
# the tree groups with flush trunks, the multi-peak range) and an img2img pass
# would pin them to the old artwork's single-subject silhouette.
FEATURE_TEXT_ONLY_STEMS = {
    "horses", "horses_2",
    "forest_feature_1", "forest_feature_2", "forest_feature_3",
    "jungle_feature",
    "mountains_feature_1", "mountains_feature_2",
    "mountains_feature_3", "mountains_feature_4",
}

# The atmosphere of EVERY mountain variant varies per iteration: each of the
# four rolls its own fog / snow / valley-mist / clear face.
MOUNTAIN_ATMOSPHERE = [
    ("Thin morning fog drifts between the lower rock slopes.", 0.25),
    ("Fresh bright snow caps the summits and streaks the upper ledges.", 0.25),
    ("Low mist wraps the valleys beneath the range while the peaks stay clear.", 0.10),
]

# The second mountain image always carries a dramatic extra feature -
# one of these is rolled per iteration.
MOUNTAIN_CRAZY = [
    "One central peak is an erupting volcano, glowing orange lava rivers spill down its flanks.",
    "A huge waterfall plunges between two of the peaks and wreathes their lower slopes in mist.",
    "Giant glowing crystal spires grow out of the central rock faces and cast coloured light.",
    "One summit is a lush green rocky island with tiny trees, the other peaks stay bare rock.",
    "An ancient ruined stone watchtower sits on one summit, wrapped in drifting cloud.",
    "A colossal natural rock arch spans two of the peaks high above the ground.",
]

# When the run carries a direction keyword (--theme-keyword), every feature
# and unit slot resolution gets this clause: themed dressing - and, where the
# slot is an animal, swapping it for a close themed equivalent - is allowed.
# The identity anchors of the slot still hold: a "skeleton horse" still
# contains "horse", a Christmas "reindeer" still matches the game deer slot.
THEMED_EQUIVALENT_CLAUSE = (
    "The run direction keyword allows heavy themed dressing, and where the "
    "subject is an animal it MAY be swapped for a close themed equivalent "
    "(for example a skeleton horse or ghost horse at Halloween, a reindeer "
    "at Christmas, a sea serpent at Transylvania) as long as the core animal "
    "noun stays clearly recognisable"
)

# ===========================================================================
# ART-STYLE keywords (--style-keyword)
#
# A style is NOT a theme: a theme dresses the subjects (snow, vampires,
# hearts) and may swap them for themed equivalents; a style only changes HOW
# everything is rendered (technique, linework, shading, medium).  The
# selected subject identities stay completely untouched.  The style text is
# injected deterministically into both the terrain and the feature/unit
# prompt templates, so even fallback prompts carry it.
# ===========================================================================

STYLE_KEYS = (
    "american_comic", "manga", "pixel_art", "papercraft",
    "watercolor_storybook", "stained_glass", "byzantine_mosaic",
    "greek_pottery", "norse_woodcarving", "illuminated_manuscript",
    "constructivist_poster", "art_deco_poster", "linocut_print",
    "tarot_engraving", "vintage_box_art", "anime_cel", "naive_folk_art",
    "egyptian_tomb", "ligne_claire", "painted_miniature",
)

STYLE_DESCRIPTIONS: dict[str, str] = {
    "american_comic":
        "bold American comic book art: strong black ink outlines, halftone "
        "dot shading, flat bright poster colours, dynamic cel highlights, "
        " heroic drama in every contour",
    "manga":
        "Japanese manga art: crisp black-and-white ink work, screentone "
        "shading, clean economical linework, expressive emphasis strokes",
    "pixel_art":
        "16-bit pixel art sprite: chunky readable pixels, limited retro "
        "SNES-era palette, hard pixel edges, dithered shading",
    "papercraft":
        "layered papercraft: cut-paper shapes with visible paper edges and "
        "fold seams, stacked depth layers, soft cast paper shadows",
    "watercolor_storybook":
        "ink-and-watercolour storybook art: loose wet washes, soft bleeding "
        "colours, fine pen-and-ink contour accents, warm paper tint",
    "stained_glass":
        "stained glass window art: black lead came contour lines, glowing "
        "jewel-toned glass panes, light streaming through translucent colour",
    "byzantine_mosaic":
        "Byzantine mosaic art: small irregular gold and stone tesserae, "
        "curved piece-by-piece shading, glinting golden highlights",
    "greek_pottery":
        "ancient Greek black-figure pottery: terracotta clay ground, jet-black "
        "silhouettes with fine incised detail, meander key border accents",
    "norse_woodcarving":
        "carved Norse wood relief: deep knife-cut V-groove lines, knotted "
        "Nordic interlace tracery, warm oak grain surface",
    "illuminated_manuscript":
        "medieval illuminated manuscript: gold leaf accents, fine gothic ink "
        "linework, flat symbolic colour, ornate decorative flourishes",
    "constructivist_poster":
        "Soviet constructivist propaganda poster: stark red-black-cream "
        "reduction, bold diagonal shapes, flat printed ink surfaces",
    "art_deco_poster":
        "Art Deco travel poster: streamlined symmetrical geometry, gold and "
        "teal palette, elegant flat shading, decorative sunburst accents",
    "linocut_print":
        "linocut relief print: chunky white carving lines through flat ink, "
        "bold two-tone contrast, hand-pressed texture",
    "tarot_engraving":
        "tarot card engraving: fine cross-hatched copper-plate lines, ornate "
        "symbolic composition, aged ivory paper",
    "vintage_box_art":
        "vintage 1970s board-game box art: rich gouache painting, warm retro "
        "palette, heroic painterly impression, printed cardstock feel",
    "anime_cel":
        "1990s anime cel animation: clean outlines, two-tone cel shadows, "
        "saturated animator colours, crisp studio finish",
    "naive_folk_art":
        "naive folk art: charming simplification, rounded confident shapes, "
        "cheerful local palette, hand-painted brush texture",
    "egyptian_tomb":
        "ancient Egyptian tomb painting: limestone ground, flat profile "
        "figures, ochre and lapis palette, fine hieroglyph-like incisions",
    "ligne_claire":
        "Franco-Belgian ligne claire comics: uniform weight ink lines, flat "
        "saturation without hatching, clear readable shading",
    "painted_miniature":
        "hand-painted tabletop miniature: glossy enamel highlight layering "
        "with micro-brush precision, dramatic contrast lighting, display "
        "figure finish",
}


def resolve_style(input_text: str) -> tuple[str, str]:
    """Accept a STYLE_KEYS name or any freeform style phrase.

    Returns ``(name, long_description)``: a registry name is upgraded to its
    handcrafted descriptor, a freeform phrase is used verbatim.
    """
    s = input_text.strip()
    if not s:
        return "", ""
    if s in STYLE_DESCRIPTIONS:
        return s, STYLE_DESCRIPTIONS[s]
    return s, s


def style_clauses(name: str, desc: str) -> str:
    """The context clause handed to every slot resolution of a styled run."""
    name_words = name.replace("_", " ")
    return (
        f"Every asset of this run is rendered entirely in the {name_words} "
        f"art style: {desc}. This rendering direction overrides the default "
        "game-art look of this handbook everywhere, while every subject keeps "
        "its identity and function completely unchanged"
    )

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

# game unit key -> its artwork file name (as used by UnitIconConfig)
UNIT_SVG_FILES = {
    "settler": "settler.svg",
    "warrior": "worrier.svg",      # the artwork ships with its typo name
    "scout": "scout.svg",
    "phalanx": "phalanx.svg",
    "knights": "knights.svg",
    "chariot": "chariot.svg",
    "cannon": "cannon.svg",
    "artillery": "artillerie.svg",  # the artwork ships with its German name
    "submarine": "submarin.svg",
    "tank": "tank.svg",
    "archer": "archer.svg",
    "riflemen": "riflemen.svg",
    "musketeer": "musketeer.svg",
    "trireme": "trireme.svg",
    "frigate": "frigate.svg",
}

# Stems with real game artwork get img2img; every other unit is text-only.
UNIT_KEY_ORDER = [
    "warrior", "scout", "archer", "phalanx", "chariot", "knights", "legion",
    "catapult", "musketeer", "riflemen", "cavalry", "mech_inf", "cannon",
    "artillery", "tank",
    "sail", "trireme", "caravel", "frigate", "ironclad", "destroyer",
    "cruiser", "battleship", "submarine", "carrier", "transport",
    "fisher_boat", "trade_ship",
    "settler", "diplomat", "caravan", "ferry",
    "fighter", "bomber", "nuclear",
]

UNIT_STEM_ORDER = [f"unit_{key}" for key in UNIT_KEY_ORDER]

# Wooden horse-drawn stuff and camels need the same anatomy clause as the
# horse resource feature - saddle animals are easy for the model to break.
_UNIT_LEGS_CLAUSE = ("Every horse shown is anatomically correct and drawn "
                     "complete, with all four legs clearly visible.")
_UNIT_CAMEL_LEGS_CLAUSE = ("Every camel is anatomically correct and drawn "
                           "complete, with all four legs clearly visible.")

_UNIT_RELIABLE_LIGHT = "warm key light from the upper left with a soft shaded side"
_UNIT_RELIABLE_RENDER = "clean dark outlines with smooth cell shading"

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


UNIT_SPECS: dict[str, dict[str, Any]] = {
    "unit_warrior": _unit_spec(
        "stone-age tribal warrior", ["warrior", "tribesman", "clubman"],
        "a brawny tribal fighter mid-stride swinging a rough wooden club, "
        "a bark-lined shield raised on the other arm",
        "painted skin stripes, fur straps and a bone necklace",
        "earthen hides of brown ochre and umber",
        identity="the Warrior game unit: a stone-age tribal fighter",
    ),
    "unit_scout": _unit_spec(
        "woodland scout", ["scout", "pathfinder", "explorer"],
        "an agile scout striding forward with a walking staff and a leather "
        "haversack",
        "worn travel cloak, a rolled map and a coil of rope on the belt",
        "muted greens and worn leather browns",
        identity="the Scout game unit: a lightly equipped explorer",
    ),
    "unit_archer": _unit_spec(
        "bronze-age archer", ["archer", "bowman", "archery"],
        "an archer in strict side profile: his straight leading arm holds "
        "the fully bent bow out ahead of him, the bow limbs sweep clearly "
        "above and below the body with background space between bow and "
        "chest, the drawn string touches his cheek",
        "quiver on the back, feathered fletching, leather bracers and cap",
        "dulled bronze and forest tan",
        identity="the Archer game unit: a bronze-age bowman",
        fixed=("The archer holds one strung, fully bent bow: both bow "
               "limbs, the taut string and the nocked arrow all stay "
               "clearly in view. Bow and body are two separate shapes: a "
               "strip of background always shows between the archer's "
               "torso and the bow limbs, and the arrow flies straight "
               "ahead past the bow hand."),
        kind_help=("the noun is 'archer' (or 'bowman') - one fighter whose "
                   "whole identification is the bent bow he draws"),
        forbidden=["crossbow", "firearm"],
    ),
    "unit_phalanx": _unit_spec(
        "phalanx spearman", ["spearman", "phalanx", "hoplite"],
        "a braced spearman behind his round bronze shield with his long "
        "spear upright",
        "horsehair-crested helmet, bronze cuirass and greaves",
        "polished bronze and deep crimson cloth",
        identity="the Phalanx game unit: a close-formation spearman of an "
                 "antique phalanx (themed dressing allowed - a skeletal or "
                 "otherwise themed spearman still reads as hoplite)",
        fixed=("The rank stands shoulder to shoulder like a real antique "
               "phalanx: overlapping round shields form a solid front "
               "line, every long spear is raised upright behind the "
               "helmets with clear background space between each shaft "
               "and every helmet, and below the shield line every "
               "soldier's legs stay visible."),
        kind_help=("one singular figure noun for a spearman of the rank "
                   "('hoplite' or 'phalanx spearman') - the count is "
                   "carried by the rank template itself"),
        subject_template="a tight antique phalanx rank of #FEATURE_KIND#",
        forbidden=["firearm", "musket"],
    ),
    "unit_chariot": _unit_spec(
        "horse-drawn war chariot", ["chariot", "war chariot"],
        "a light two-wheeled war chariot in three-quarter isometric view, "
        "pulled by its matched team of two harnessed horses seen in full "
        "profile galloping left to right, the team clearly IN FRONT of "
        "the chariot, a driver and an archer standing in the chariot box",
        "braided reins, a quiver mounted at the rail and polished fittings",
        "warm wood and gleaming bronze",
        identity="the Chariot game unit: a horse-drawn war chariot with its crew",
        fixed=(_UNIT_LEGS_CLAUSE +
               " The chariot and the horses are two clearly separate "
               "objects joined only by their harness: visible background "
               "space separates the horses' hindquarters from the "
               "chariot's front, and the draught pole leads from the "
               "horses' yoke straight to the chariot box. Both horses run "
               "side by side in step, galloping in one and the same "
               "direction."),
        kind_help=("exactly the plain noun 'war chariot' - the draught team "
                   "and the direction belong to FEATURE_FORM, the noun is "
                   "never dressed with weather or story words"),
    ),
    "unit_knights": _unit_spec(
        "medieval knight", ["knight", "crusader", "knightly"],
        "one iron-armoured knight riding one caparisoned warhorse in "
        "three-quarter isometric view: the single horse's head, neck, "
        "saddle and hindquarters all clearly belong to the same one "
        "animal, the rider sitting centred in the saddle",
        "visored great helm, heraldic surcoat and laminated armour plates",
        "iron grey with heraldic blue and gold",
        identity="the Knights game unit: an armoured medieval knight "
                 "mounted on a warhorse",
        fixed=("The knight rides exactly ONE single warhorse: one head, "
               "one neck and one body, with clear background space "
               "between its head and chest. The rider straddles the "
               "saddle of that single animal once and once only. "
               + _UNIT_LEGS_CLAUSE),
        kind_help=("exactly the noun 'knight' - one rider"),
    ),
    "unit_legion": _unit_spec(
        "Roman legionary", ["legionary", "legion", "centurion"],
        "a Roman legionary at attention, a rectangular scutum shield planted "
        "and a short gladius drawn",
        "red-plumed galea helmet, segmented lorica armour and leather "
        "skirt strips",
        "oxblood red and burnished iron",
        identity="the Legion game unit: an armoured Roman legionary",
        forbidden=["firearm", "musket", "medieval"],
    ),
    "unit_catapult": _unit_spec(
        "wooden catapult", ["catapult", "mangonel", "onager"],
        "a classic siege catapult with two large spoked wheels, a sturdy "
        "A-shaped timber frame and a long throwing arm cranked down ready "
        "to fire, a sling with a round grey stone at the arm tip",
        "fresh timber planks, crossed support beams with rope lashings, a "
        "windlass crank and a second stone ball beside the wheels",
        "warm oak planks and pale birch beams",
        identity="the Catapult game unit: a wooden siege catapult on wheels",
        forbidden=["firearm", "rubber tyres"],
    ),
    "unit_musketeer": _unit_spec(
        "musketeer", ["musketeer", "arquebusier"],
        "a plumed wide-brimmed musketeer in strict side profile resting "
        "the slim long musket on a forked rest: both hands grip the light "
        "wooden stock together, the muzzle rises clearly beyond his hat "
        "with background space between barrel and face",
        "a bandolier of powder charges, bucket-top boots and lace cuffs",
        "royal blue coat and buff leather",
        identity="the Musketeer game unit: an early-modern musketeer",
        fixed=("The musket is historically proportioned and held the way "
               "a real musketeer would hold it: slim tapered barrel with "
               "a light wooden stock sized like a genuine early-modern "
               "weapon, the stock line passing beside the cheek and not "
               "across it, barrel and hat clearly separated by air."),
        kind_help=("exactly the noun 'musketeer': a soldier whose central "
                   "weapon is the long smoking musket"),
        forbidden=["sword", "shield", "pistol", "rapier", "dagger",
                   "rifle with scope", "modern"],
    ),
    "unit_riflemen": _unit_spec(
        "line rifleman", ["rifleman", "infantry soldier", "redcoat"],
        "a uniformed rifleman in strict side profile holding his long "
        "rifle in a two-handed carry: both hands on the wooden stock, the "
        "muzzle raised diagonally ahead of him and clearly beyond the hat "
        "line, the butt resting at the shoulder",
        "tailcoat uniform, shako with cords, cross-belts and a puff of "
        "muzzle smoke",
        "deep field blue with brass buttons",
        identity="the Riflemen game unit: a line-infantry rifleman of the "
                 "industrial era",
        fixed=("The rifle is held as a real weapon is carried: the whole "
               "stock, lock and barrel read as one straight line, both "
               "hands grip the wood, and a visible gap of background "
               "separates the barrel from the face and hat."),
        forbidden=["laser", "scope"],
    ),
    "unit_cavalry": _unit_spec(
        "dragoon cavalryman", ["cavalry", "dragoon", "cavalier",
                               "mounted soldier"],
        "a uniformed dragoon riding a galloping horse, sabre raised and a "
        "pennant snapping in the wind",
        "high boots, plumed helmet and a carbine slung across the back",
        "midnight blue uniform and glossy black horse",
        identity="the Cavalry game unit: a sabre-armed dragoon mounted on "
                 "a horse",
        fixed=_UNIT_LEGS_CLAUSE,
    ),
    "unit_mech_inf": _unit_spec(
        "mechanised infantry squad", ["mechanised infantry", "mech infantry",
                                      "infantry squad"],
        "a squad of helmeted mechanised riflemen advancing together beside "
        "a compact armoured personnel carrier",
        "flak vests, assault rifles and olive webbing gear",
        "olive drab and gunmetal",
        identity="the Mech. Inf. game unit: one mechanised infantry squad",
        forbidden=["ancient", "musket", "sword"],
    ),
    "unit_cannon": _unit_spec(
        "field cannon", ["cannon", "artillery gun"],
        "a black-powder field cannon built of a long tapered bronze barrel "
        "mounted on a tall-arched wooden carriage with two large spoked "
        "wheels clearly visible, a rammer and a powder barrel standing "
        "beside it",
        "iron reinforcement bands around the barrel, a coil of fuse rope "
        "and a neat pyramid of round iron shot",
        "aged bronze and pale carriage wood",
        identity="the Cannon game unit: a black-powder field cannon",
        kind_help=("the complete gun: barrel, wooden carriage and its two "
                   "large spoked wheels - all three parts belong to the "
                   "noun, nothing may be dropped"),
        forbidden=["close-up", "emerging", "turret"],
    ),
    "unit_artillery": _unit_spec(
        "heavy howitzer", ["howitzer", "artillery piece"],
        "a massive artillery howitzer with a thick dark barrel raised high "
        "on a wheeled steel split-trail carriage, its open breech and "
        "hinged elevating gear on the wheels",
        "army-green painted plate steel, canvas-wrapped shells stacked on a "
        "rack and a periscope sight post",
        "military green and dark iron",
        identity="the Artillery game unit: a heavy howitzer artillery piece",
        kind_help=("the noun is 'howitzer': one gun barrel on its wheeled "
                   "split-trail carriage, complete with breech and wheels"),
        forbidden=["tank", "tracked", "tripod", "tower", "legs",
                   "recoiling track"],
    ),
    "unit_tank": _unit_spec(
        "main battle tank", ["tank", "battle tank"],
        "a sloped-armoured main battle tank in three-quarter view with a "
        "long gun barrel, side skirts and tracks",
        "an open commander's hatch, track guards and a small radio antenna",
        "sand-dust camouflage tan and gunmetal",
        identity="the Tank game unit: a modern main battle tank",
    ),
    "unit_sail": _unit_spec(
        "small sailing boat", ["sailboat", "sailing boat", "boat"],
        "a small single-mast sailing boat with a triangular sail fully set, "
        "seen broadside",
        "hull planking, a coiled mooring line and a pennant at the masthead",
        "weathered wood and canvas white",
        identity="the Sail game unit: a small early sailing boat",
    ),
    "unit_trireme": _unit_spec(
        "ancient war galley", ["trireme", "galley", "warship"],
        "an ancient war galley seen in full profile, three rows of oars "
        "pulled out, a bronze wave-ram bow and a curled stern ornament",
        "a painted eye on the bow, a brailed sail and oar ports with leather "
        "bosses",
        "tarred timber with red and ochre paintwork",
        identity="the Trireme game unit: an ancient war galley with three "
                 "banks of oars",
    ),
    "unit_caravel": _unit_spec(
        "caravel", ["caravel", "sailing ship", "exploring vessel"],
        "a late-medieval caravel with two lateen masts and a high stern "
        "castle gliding on calm sea",
        "billowing canvas, rigging lines and a long banner at the masthead",
        "weathered oak and sun-bleached canvas",
        identity="the Caravel game unit: a late-medieval exploring caravel",
    ),
    "unit_frigate": _unit_spec(
        "sailing frigate", ["frigate", "sailing warship"],
        "an Age-of-Sail frigate under full sail, two rows of gun ports along "
        "the hull and a streamer flying",
        "a bow figurehead, striped gun ports and a ship's gig hanging at "
        "the stern davits",
        "navy black hull with sun-yellow bands",
        identity="the Frigate game unit: an Age-of-Sail frigate",
    ),
    "unit_ironclad": _unit_spec(
        "steam ironclad", ["ironclad", "steam warship", "armoured ship"],
        "a low armoured steam ironclad with a casemate battery, twin "
        "smokestacks and a ram bow",
        "riveted armour plates, a paddle housing and gun barrels at "
        "portholes",
        "gunmetal grey with pitch-black smoke",
        identity="the Ironclad game unit: a steam-powered armoured ironclad",
    ),
    "unit_destroyer": _unit_spec(
        "destroyer warship", ["destroyer"],
        "a long lean grey destroyer with a raked clipper bow, twin funnels "
        "with smoke and deck guns fore and aft",
        "torpedo launchers, depth-charge racks and a painted pennant number",
        "haze grey with slate shadows",
        identity="the Destroyer game unit: a fast grey destroyer warship",
    ),
    "unit_cruiser": _unit_spec(
        "armoured cruiser", ["cruiser"],
        "a grey armoured cruiser with triple gun turrets fore and aft and a "
        "stepped pagoda bridge",
        "twin funnels with smoke, secondary turrets and a boat crane "
        "amidships",
        "battleship grey with a navy blue waterline",
        identity="the Cruiser game unit: a heavy armoured cruiser",
    ),
    "unit_battleship": _unit_spec(
        "battleship", ["battleship"],
        "a mighty grey battleship with towering turret guns fore and aft, a "
        "tall bridge tower and a flared hull",
        "heavy calibre barrels, a range-finder on top and rows of rivets",
        "steel grey with a deep blue sea shadow",
        identity="the Battleship game unit: a mighty battleship of the line",
    ),
    "unit_submarine": _unit_spec(
        "attack submarine", ["submarine"],
        "a dark grey attack submarine seen from a low three-quarter view, "
        "with a conning tower, diving planes and bow torpedo tubes",
        "a raised periscope, hull plate seams and trailing wake foam",
        "deep sea grey and black rubber",
        identity="the Submarine game unit: a military attack submarine",
    ),
    "unit_carrier": _unit_spec(
        "aircraft carrier", ["aircraft carrier", "carrier"],
        "a huge flat-topped aircraft carrier with a wide flight deck lined "
        "with parked planes and a starboard island tower",
        "arresting cables across the deck, jaunty deck markings and a radar "
        "mast",
        "flight-deck blue-grey and bleached deck boards",
        identity="the Carrier game unit: an aircraft carrier",
    ),
    "unit_transport": _unit_spec(
        "troop transport", ["transport ship", "troop ship", "freighter"],
        "a bulky grey troop transport ship with davit-mounted landing boats "
        "along the hull",
        "a grid of portholes, cargo cranes and a striped dummy funnel",
        "dust grey and weathered steel",
        identity="the Transport game unit: a troop transport ship",
    ),
    "unit_trade_ship": _unit_spec(
        "merchant trade ship", ["merchant ship", "trade ship", "cargo ship"],
        "a stocky merchant trade ship with cargo cranes loading crates onto "
        "the deck",
        "stacked crates, bollards and a funnel painted with a house flag",
        "hull red below the waterline and black above",
        identity="the Trade Ship game unit: a merchant trade ship",
    ),
    "unit_fisher_boat": _unit_spec(
        "fishing boat", ["fishing boat", "fishing vessel", "rowboat"],
        "a small wooden fishing boat with a lantern mast and a weathered "
        "fisherman hauling in a net",
        "coiled nets, crates of the catch and oars shipped aboard",
        "rustic planks with a bottle-green gunwale",
        identity="the Fisher Boat game unit: a small wooden fishing boat",
    ),
    "unit_ferry": _unit_spec(
        "ferry boat", ["ferry", "passenger ferry"],
        "a broad double-decked ferry with an open vehicle deck forward, a "
        "glassed passenger cabin aft and a twin funnel",
        "a row of lifebuoys, ramp chains and a company flag on the mast",
        "crisp white with a signal-green funnel band",
        identity="the Ferry game unit: a passenger and vehicle ferry",
    ),
    "unit_settler": _unit_spec(
        "pioneer settler", ["settler", "pioneer", "colonist"],
        "a pioneer settler striding forward with a walking staff and a large "
        "bundle of belongings on the shoulder",
        "patched clothes, a wide-brimmed hat and rolled bedding",
        "homespun linen browns and sun-faded cloth",
        identity="the Settler game unit: a determined pioneer settler",
    ),
    "unit_diplomat": _unit_spec(
        "court diplomat", ["diplomat", "envoy", "courtier"],
        "a dignified diplomat in a long morning coat with a silk top hat, a "
        "leather satchel under one arm and a rolled treaty in a gloved hand",
        "silver-buckled shoes, a pocket watch chain and quill-and-ink "
        "accents",
        "black coat, pearl grey waistcoat and polished boots",
        identity="the Diplomat game unit: a dignified courtly diplomat",
    ),
    "unit_caravan": _unit_spec(
        "trade caravan", ["caravan", "camel caravan", "pack train"],
        "a loaded trade caravan of two camels with woven saddlebags, led "
        "forward by a turbaned trader",
        "rolled rugs, brass jugs and trade beads hanging off the packs",
        "desert sand tan with indigo saddle cloth",
        identity="the Caravan game unit: a loaded trade caravan led by camels",
        fixed=_UNIT_CAMEL_LEGS_CLAUSE,
    ),
    "unit_fighter": _unit_spec(
        "fighter jet", ["fighter jet", "fighter aircraft"],
        "a sleek fighter jet banking in flight, afterburner glow trailing, "
        "seen from a low three-quarter view",
        "air-to-air missiles under the wings, roundel markings and a bubble "
        "canopy",
        "iron-radar grey with a sky-blue afterburner",
        identity="the Fighter game unit: a fast fighter jet",
    ),
    "unit_bomber": _unit_spec(
        "strategic bomber", ["bomber", "strategic bomber", "bomber aircraft"],
        "a heavy four-engined bomber aircraft with broad wings in level "
        "flight, seen from a low three-quarter view",
        "twin tail fins, gun turrets and a closed bomb-bay outline",
        "night black-green with sky reflection",
        identity="the Bomber game unit: a heavy strategic bomber plane",
    ),
    "unit_nuclear": _unit_spec(
        "thermonuclear missile", ["nuclear missile", "thermonuclear missile",
                                  "missile"],
        "a white strategic missile with fins and a red nose cone standing "
        "upright on a launch cradle",
        "warning chevrons, access panels and a chain rig at the cradle base",
        "pale launcher white with hazard orange stripes",
        identity="the Nuclear game unit: a strategic thermonuclear missile",
        forbidden=["explosion", "mushroom cloud", "city"],
    ),
}

# keep the table in the canonical order of UNIT_STEM_ORDER (the render
# order), so the manifest lists units in a stable sequence
UNIT_SPECS = {f"unit_{key}": UNIT_SPECS[f"unit_{key}"]
              for key in UNIT_KEY_ORDER}

# Every unit that shows a person or an animal additionally carries the
# limb-completeness clause; pure machines (tank, cannon, ships, ...) do not
# have arms or legs, so the clause would only confuse the prompt there.
_UNIT_PERSON_STEMS = {
    "unit_warrior", "unit_scout", "unit_archer", "unit_phalanx",
    "unit_chariot", "unit_knights", "unit_legion", "unit_musketeer",
    "unit_riflemen", "unit_cavalry", "unit_mech_inf",
    "unit_settler", "unit_diplomat", "unit_caravan",
}
for _stem in _UNIT_PERSON_STEMS:
    _spec = UNIT_SPECS[_stem]
    _base = _spec.get("fixed")
    _spec["fixed"] = (f"{_base} {_UNIT_LIMB_CLAUSE}" if _base
                      else _UNIT_LIMB_CLAUSE)
del _stem, _spec, _base

# Every game unit is intentionally rendered as THREE sprite variants per
# iteration (unit_<key>.png, unit_<key>_2.png, unit_<key>_3.png) so the
# game can pick a favourite or cycle them.  Feature resources stay one
# sprite per stem.
UNIT_VARIANTS = 3

# naval and air units read better on a landscape canvas
UNIT_WIDE_STEMS = {
    "unit_sail", "unit_trireme", "unit_caravel", "unit_frigate",
    "unit_ironclad", "unit_destroyer", "unit_cruiser", "unit_battleship",
    "unit_submarine", "unit_carrier", "unit_transport", "unit_trade_ship",
    "unit_fisher_boat", "unit_ferry", "unit_fighter", "unit_bomber",
}

# the whole stem list the engine knows: terrain features first, then units
FEATURE_STEM_ORDER_ALL = list(FEATURE_STEM_ORDER) + list(UNIT_STEM_ORDER)


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

# One spec per feature *kind*; several inputs may share a kind (fish1..fish5).
FEATURE_SPECS = {
    "fish": {
        "identity": "a single fish",
        # 'shark'/'piranha'/'koi' let themed runs swap in a close equivalent
        "anchors": ["fish", "carp", "trout", "salmon", "perch", "pike", "eel",
                    "shark", "piranha", "koi"],
        "fallbacks": {
            "FEATURE_KIND": "fish",
            "FEATURE_FORM": "a streamlined body with a forked tail and clearly separated fins",
            "FEATURE_DETAIL": "clean outlined scales and a crisp fin silhouette",
            "FEATURE_PALETTE": "grounded silver-blue and teal tones",
            "FEATURE_LIGHTING": "soft top light with a bright rim along the back",
            "FEATURE_RENDERING": "clean dark outlines with smooth cell shading",
        },
    },
    "horse": {
        "identity": "one or more proud, strong wild horses",
        "kind_help": ("a plain animal noun such as 'stallion', 'mare' or "
                      "'wild horse' - anatomy belongs to FEATURE_FORM, "
                      "never here"),
        "fixed": ("Every horse is drawn complete and anatomically correct, "
                  "with all four legs clearly visible - standing, rearing "
                  "or galloping are all fine. The frame may hold a single "
                  "proud stallion or a small group of two or three horses, "
                  "and every horse included is fully visible. Alert eyes, "
                  "arched neck with the head held high, powerful defined "
                  "musculature, long flowing mane and raised tail, full of "
                  "untamed wild energy."),
        "anchors": ["horse", "stallion", "mare", "wild horse", "mustang",
                    "charger", "warhorse", "nightmare"],
        "fallbacks": {
            "FEATURE_KIND": "wild horse",
            "FEATURE_FORM": "a proud horse standing on all four legs with the neck arched and the head high",
            "FEATURE_DETAIL": "defined musculature, a long flowing mane, a raised tail and four strong legs",
            "FEATURE_PALETTE": "rich bay brown and warm tan tones",
            "FEATURE_LIGHTING": "warm key light from the upper left with a bright rim along the back",
            "FEATURE_RENDERING": "clean dark outlines with smooth cell shading",
        },
    },
    "forest_mixed": {
        "identity": "a mixed forest group of trees",
        "subject_template": "a group of #FEATURE_KIND#",
        "kind_help": ("the tree kinds standing in the group, as plural noun "
                      "phrases such as 'deciduous trees' or 'conifers' - "
                      "never singular"),
        "fixed": ("The trees stand as clearly separated individuals with their "
                  "own full trunks and crowns, and every tree is complete and "
                  "fully visible inside the frame, with clear black margin "
                  "around the whole group. The mixture includes both rounded "
                  "broadleaf crowns and a few conical needle crowns. The "
                  "trunks and greenery end freely in mid-air, so the entire "
                  "frame beneath the group stays empty solid black."),
        "anchors": ["mixed forest", "trees", "broadleaf", "conifers", "forest group"],
        "fallbacks": {
            "FEATURE_KIND": "mixed forest trees",
            "FEATURE_FORM": "four to six individual trees, rounded broadleaf crowns beside conical needle crowns",
            "FEATURE_DETAIL": "each tree with its own visible trunk, layered leaf clusters and low undergrowth",
            "FEATURE_PALETTE": "layered greens with warm yellow-green highlights",
            "FEATURE_LIGHTING": "warm daylight filtering through the crowns",
            "FEATURE_RENDERING": "semi-realistic digital painting with clean dark outlines",
        },
    },
    "forest_coniferous": {
        "identity": "a coniferous forest group of trees",
        "subject_template": "a group of #FEATURE_KIND#",
        "kind_help": ("the tree kinds standing in the group, as plural noun "
                      "phrases such as 'pines and spruces' - never singular"),
        "fixed": ("The trees stand as clearly separated individuals with their "
                  "own full trunks and crowns, and every tree is complete and "
                  "fully visible inside the frame, with clear black margin "
                  "around the whole group. Every tree is a conifer with dark "
                  "needle foliage and a conical evergreen crown. The trunks "
                  "end freely in mid-air, so the entire frame beneath the "
                  "group stays empty solid black."),
        "anchors": ["coniferous", "pine", "spruce", "fir", "evergreen", "needle"],
        "fallbacks": {
            "FEATURE_KIND": "coniferous trees",
            "FEATURE_FORM": "five to seven individual conical trees standing together, needle foliage and slender trunks",
            "FEATURE_DETAIL": "dense layered needle branch fans, small cones and dark trunks in view",
            "FEATURE_PALETTE": "deep fir greens with cool blue-green shadow tones",
            "FEATURE_LIGHTING": "cool clear highland light with deep green shadows",
            "FEATURE_RENDERING": "semi-realistic digital painting with clean dark outlines",
        },
    },
    "forest_deciduous": {
        "identity": "a deciduous forest group of trees",
        "subject_template": "a group of #FEATURE_KIND#",
        "kind_help": ("the tree kinds standing in the group, as plural noun "
                      "phrases such as 'oaks and beeches' - never singular"),
        "fixed": ("The trees stand as clearly separated individuals with their "
                  "own full trunks and crowns, and every tree is complete and "
                  "fully visible inside the frame, with clear black margin "
                  "around the whole group. Every tree is a broadleaf deciduous "
                  "tree with a full rounded crown. The trunks end freely in "
                  "mid-air, so the entire frame beneath the group stays empty "
                  "solid black."),
        "anchors": ["deciduous", "broadleaf", "oak", "beech", "maple", "birch"],
        "fallbacks": {
            "FEATURE_KIND": "deciduous trees",
            "FEATURE_FORM": "five to seven individual broadleaf trees with full rounded crowns on visible trunks",
            "FEATURE_DETAIL": "layered leaf clusters, soft dappled grass between the trunks and light foliage gaps",
            "FEATURE_PALETTE": "fresh greens with warm yellow-green highlights",
            "FEATURE_LIGHTING": "warm daylight filtering through the crowns",
            "FEATURE_RENDERING": "semi-realistic digital painting with clean dark outlines",
        },
    },
    "hills_feature": {
        "identity": "a grassy hill mound",
        "anchors": ["hill", "mound", "knoll", "slope", "rise", "ridge"],
        "fallbacks": {
            "FEATURE_KIND": "grassy hill mound",
            "FEATURE_FORM": "a single rounded mound with a smooth continuous crest",
            "FEATURE_DETAIL": "short grass tufts and a few mossy patches on the flanks",
            "FEATURE_PALETTE": "muted earthy olive-green with lighter yellow-green crests",
            "FEATURE_LIGHTING": "soft directional light modelling the curved surface",
            "FEATURE_RENDERING": "semi-realistic digital painting with clean dark outlines",
        },
    },
    "jungle_feature": {
        "identity": "a jungle group of trees with lianas",
        "subject_template": "a group of #FEATURE_KIND#",
        "kind_help": ("the tree kinds standing in the group, as plural noun "
                      "phrases such as 'tropical jungle trees' - never singular"),
        "fixed": ("Several tall tropical trees stand as a group, each tree "
                  "complete and fully visible inside the frame with its own "
                  "trunk and crown, and thick winding lianas with hanging "
                  "vines loop between the trunks and drape from the crowns, "
                  "with clear black margin around the whole group. The trunks "
                  "and root tangle end freely in mid-air, so the entire frame "
                  "beneath the group stays empty solid black."),
        "anchors": ["jungle", "tropical trees", "lianas", "vines", "palm", "rainforest"],
        "fallbacks": {
            "FEATURE_KIND": "tropical jungle trees",
            "FEATURE_FORM": "five tall tropical trees in a loose group with looping lianas",
            "FEATURE_DETAIL": "broad glossy leaves, twisting vines, ferns and small bright flowers",
            "FEATURE_PALETTE": "deep emerald and olive greens with vine highlights",
            "FEATURE_LIGHTING": "humid filtered light with deep green shadows",
            "FEATURE_RENDERING": "semi-realistic digital painting with clean dark outlines",
        },
    },
    "mountains_feature": {
        "identity": "a mountain range of several peaks",
        "subject_template": "a range of #FEATURE_KIND#",
        "kind_help": ("the peaks of the range, as a plural noun phrase such as "
                      "'mountain peaks' - never singular"),
        "fixed": ("Several distinct rocky peaks rise side by side as one range, "
                  "and every peak is whole and fully visible inside the frame "
                  "with clear black margin around the entire range - each "
                  "summit tip, each shoulder and each lower slope complete."),
        "anchors": ["mountain", "peak", "summit", "ridge", "crag", "alp"],
        "fallbacks": {
            "FEATURE_KIND": "mountain peaks",
            "FEATURE_FORM": "four to six sharp peaks rising side by side with steep flanks",
            "FEATURE_DETAIL": "layered rock faces with clear ledges and visible summit tips",
            "FEATURE_PALETTE": "cool granite grey with pale blue tones",
            "FEATURE_LIGHTING": "crisp cold light with hard small shadows",
            "FEATURE_RENDERING": "semi-realistic digital painting with clean dark outlines",
        },
    },
    "seal": {
        "identity": "a single seal",
        "kind_help": ("a plain seal noun such as 'harbour seal', 'sea lion' "
                      "or 'fur seal' - one animal"),
        "anchors": ["seal", "sea lion", "harbour seal", "ringed seal", "fur seal"],
        "fallbacks": {
            "FEATURE_KIND": "seal",
            "FEATURE_FORM": "a plump seal resting upright on its rear flippers with both flippers visible",
            "FEATURE_DETAIL": "short wet fur, dark back and pale belly, long whiskers",
            "FEATURE_PALETTE": "cool silver-grey tones with a pale cream belly",
            "FEATURE_LIGHTING": "cold crisp polar light with a bright sheen along the wet back",
            "FEATURE_RENDERING": "clean dark outlines with smooth cell shading",
        },
    },
    "gems": {
        "identity": "a small cluster of precious gemstones",
        "anchors": ["gems", "gemstones", "crystals", "jewels", "precious stones"],
        "fallbacks": {
            "FEATURE_KIND": "gemstone cluster",
            "FEATURE_FORM": "several cut gemstones of different sizes resting together on a small rocky base",
            "FEATURE_DETAIL": "brilliant faceted cuts catching the light with sharp highlights and inner fire",
            "FEATURE_PALETTE": "rich jewel colours of ruby red, emerald green and sapphire blue",
            "FEATURE_LIGHTING": "sparkling point light with tiny star glints on each facet",
            "FEATURE_RENDERING": "clean dark outlines with glassy translucent shading",
        },
    },
    "gold": {
        "identity": "a small pile of gold",
        "kind_help": "a plain noun phrase such as 'gold nugget pile' or 'gold seam' - singular",
        "anchors": ["gold", "gold nuggets", "gold ore", "gold vein", "bullion"],
        "fallbacks": {
            "FEATURE_KIND": "gold nugget pile",
            "FEATURE_FORM": "a small mound of irregular gold nuggets and a few coins",
            "FEATURE_DETAIL": "rough hammered surfaces with bright glints and small embedded quartz specks",
            "FEATURE_PALETTE": "warm gold and amber highlights over deeper bronze shadows",
            "FEATURE_LIGHTING": "warm glinting light with sharp specular sparkles",
            "FEATURE_RENDERING": "clean dark outlines with polished metal shading",
        },
    },
    "coal": {
        "identity": "a small coal outcrop",
        "anchors": ["coal", "anthracite", "carbon"],
        "fallbacks": {
            "FEATURE_KIND": "coal outcrop",
            "FEATURE_FORM": "a small mound of chunky coal lumps over a grey rocky base",
            "FEATURE_DETAIL": "angular split faces with a slick glossy sheen and fine dust in the cracks",
            "FEATURE_PALETTE": "deep charcoal black over cool slate grey rock",
            "FEATURE_LIGHTING": "hard cool light with a wet-looking shine on the split faces",
            "FEATURE_RENDERING": "clean dark outlines with matte stony shading",
        },
    },
    "oil": {
        "identity": "a natural oil seep",
        "anchors": ["oil", "crude oil", "tar", "bitumen", "petroleum"],
        "fallbacks": {
            "FEATURE_KIND": "oil seep",
            "FEATURE_FORM": "a dark bubbling oil pool welling up out of cracked muddy ground",
            "FEATURE_DETAIL": "thick glossy black liquid with slow bubbles and oily rainbow films at the rim",
            "FEATURE_PALETTE": "ink black with petrol purple sheens over muddy brown earth",
            "FEATURE_LIGHTING": "dim slick light with one bright skim of reflection",
            "FEATURE_RENDERING": "clean dark outlines with glossy liquid shading",
        },
    },
    "game": {
        "identity": "a single wild game animal",
        "kind_help": "a plain animal noun such as 'stag', 'elk' or 'roe deer' - one animal",
        # 'reindeer'/'doe' let themed runs swap in a close equivalent
        "anchors": ["deer", "stag", "elk", "roe deer", "buck", "reindeer",
                    "doe"],
        "fallbacks": {
            "FEATURE_KIND": "stag",
            "FEATURE_FORM": "an alert stag standing with the head raised and a fine branching antler crown",
            "FEATURE_DETAIL": "smooth short summer coat with a pale chest patch and a soft dark nose",
            "FEATURE_PALETTE": "warm russet brown and tan tones with a cream belly",
            "FEATURE_LIGHTING": "soft forest light with a warm rim along the back",
            "FEATURE_RENDERING": "clean dark outlines with smooth cell shading",
        },
    },
    "oasis": {
        "identity": "a small desert oasis",
        "subject_template": "a small tropical #FEATURE_KIND#",
        "kind_help": ("a plain noun phrase such as 'oasis' or 'water pool' "
                      "- singular, no cluster"),
        "anchors": ["oasis", "watering hole", "spring", "water pool"],
        "fallbacks": {
            "FEATURE_KIND": "oasis",
            "FEATURE_FORM": "a small clear blue water pool ringed by fresh green palms and tufted grasses",
            "FEATURE_DETAIL": "shining water with a soft ripple, curved palm trunks and tall green fronds",
            "FEATURE_PALETTE": "vivid turquoise water with fresh greens over sandy gold",
            "FEATURE_LIGHTING": "bright desert sunlight with cool shade under the palms",
            "FEATURE_RENDERING": "semi-realistic digital painting with clean dark outlines",
        },
    },
    "swamp_feature": {
        "identity": "a swamp tree stump cluster",
        "anchors": ["stump", "swamp", "marsh", "bog", "moss", "reed", "lily"],
        "fallbacks": {
            "FEATURE_KIND": "swamp tree stump cluster",
            "FEATURE_FORM": "gnarled stumps with tangled roots rising from shallow water",
            "FEATURE_DETAIL": "hanging moss, lily pads and marsh grass tufts",
            "FEATURE_PALETTE": "dark olive and brown tones with murky green water",
            "FEATURE_LIGHTING": "dim overcast light with soft murky shadows",
            "FEATURE_RENDERING": "semi-realistic digital painting with clean dark outlines",
        },
    },
}

# Which spec every stem uses, plus the little per-stem twist (a different
# pose / arrangement) that keeps the variants apart.
FEATURE_STEM_SPECS = {
    "fish1": {"spec": "fish", "twist": "swimming to the left, seen from a three-quarter top-down view"},
    "fish2": {"spec": "fish", "twist": "swimming to the right, seen from a three-quarter top-down view"},
    "fish3": {"spec": "fish", "twist": "curving in an S-shape, seen from a three-quarter top-down view"},
    "fish4": {"spec": "fish", "twist": "diving downwards with the tail raised, seen from above"},
    "fish5": {"spec": "fish", "twist": "resting horizontally, seen from directly above"},
    "horses": {"spec": "horse",
               "twist": "standing tall in profile with the neck arched and the head high"},
    "horses_2": {"spec": "horse",
                 "twist": ("galloping at full stride with the mane and tail "
                           "flying")},
    "forest_feature_1": {"spec": "forest_mixed", "twist": "a loose group of individual trees"},
    "forest_feature_2": {"spec": "forest_coniferous", "twist": "a stand of individual conical trees"},
    "forest_feature_3": {"spec": "forest_deciduous", "twist": "a stand of individual broadleaf trees"},
    "jungle_feature": {"spec": "jungle_feature", "twist": "a loose group of tall jungle trees"},
    "hills_feature": {"spec": "hills_feature", "twist": "a single rounded rise"},
    "swamp_feature": {"spec": "swamp_feature", "twist": "a gnarled stump in shallow water"},
    "mountains_feature_1": {"spec": "mountains_feature", "twist": "several peaks side by side"},
    "mountains_feature_2": {"spec": "mountains_feature", "twist": "the most dramatic variant of the range"},
    "mountains_feature_3": {"spec": "mountains_feature",
                            "twist": ("two massive twin peaks rising "
                                      "shoulder to shoulder with one "
                                      "high saddle between them")},
    "mountains_feature_4": {"spec": "mountains_feature",
                            "twist": ("a long slope-shouldered ridge line "
                                      "with small rounded foothills "
                                      "climbing in front of it")},
    "seal": {"spec": "seal", "twist": "resting upright on its rear flippers"},
    "gems": {"spec": "gems", "twist": "a small sparkling cluster"},
    "gold": {"spec": "gold", "twist": "a glittering little mound"},
    "coal": {"spec": "coal", "twist": "a dark chunky outcrop"},
    "oil": {"spec": "oil", "twist": "a small bubbling pool"},
    "game": {"spec": "game", "twist": "standing alert in profile"},
    "oasis": {"spec": "oasis", "twist": "a small ring of palms around clear water"},
}

# Which subject components are kept when the input picture is prepared:
#   "single"  -> only the biggest connected blob (one horse, one fish)
#   "cluster" -> every blob above 15 % of the biggest one (tree clusters)
# Only relevant for stems that have an input picture to prepare.
FEATURE_SUBJECT_MODE = {
    "fish1": "single", "fish2": "single", "fish3": "single",
    "fish4": "single", "fish5": "single",
}

# Words that must not show up in a resolved feature slot - "a single fish"
# must never become a school of fish.
FEATURE_FORBIDDEN = {
    "fish": ["school", "pod", "herd", "group", "multiple", "pair", "bowl",
             "fishing", "hook", "rod"],
    # more than one horse is explicitly allowed now - only domesticating and
    # toy-like dressing stays forbidden
    "horse": ["stable", "rider", "saddle", "carriage", "grazing", "plush",
              "toy", "cute", "cartoon"],
    "forest_mixed": ["single tree", "lone tree", "stump", "logs", "clear-cut"],
    "forest_coniferous": ["single tree", "lone tree", "broadleaf", "stump",
                          "logs", "clear-cut"],
    "forest_deciduous": ["single tree", "lone tree", "pine", "spruce", "fir",
                         "stump", "logs", "clear-cut"],
    "hills_feature": [],
    "jungle_feature": ["single tree", "lone tree", "foliage wall", "clear-cut"],
    "mountains_feature": ["single peak", "lone peak", "plateau", "mesa"],
    "swamp_feature": [],
    "seal": ["fish", "shark", "whale", "dolphin", "human"],
    "gems": ["ring", "necklace", "crown", "chest", "treasure"],
    "gold": ["ring", "necklace", "crown", "chest", "treasure", "bar"],
    "coal": ["diamond", "crystal", "emerald"],
    "oil": ["pump", "derrick", "rig", "barrel", "pipe"],
    "game": ["hunt", "rifle", "arrow", "herd", "group", "multiple"],
    "oasis": ["camel", "caravan", "tent", "building", "city"],
}

# words that leak the run's story into a unit slot or drift the machine
# shape - banned for every unit slot, merged with each unit's own forbidden
# list (see UNIT_SPECS) so resolve_slot_bundle repeats them in its
# instruction to the local model
_UNIT_ALL_SLOT_BANS = ["storm", "stormy", "tattered", "drenched",
                       "embattled", "damaged", "ruined", "broken",
                       "weathered", "battle-worn"]
FEATURE_FORBIDDEN.update({
    f"unit_{key}": list(UNIT_SPECS[f"unit_{key}"].get("forbidden") or [])
                   + _UNIT_ALL_SLOT_BANS
    for key in UNIT_KEY_ORDER
})
del _UNIT_ALL_SLOT_BANS

# Per-slot bans for FEATURE_KIND only: words that describe a pose or a detail
# belong to FEATURE_FORM, and a group subject needs a plural noun phrase.
FEATURE_KIND_FORBIDDEN = {
    "horse": ["charge", "rearing", "standing", "silhouette", "pose",
              "gesture", "figure", "statue", "stern"],
    "game": ["antler", "horn", "carcass", "cluster", "group"],
    "seal": ["storm", "lightning", "myth"],
}

# FEATURE_KIND bans for group subjects: a singular head noun ('coniferous
# tree cluster') or a wrapper word ('mix of tall trees') reads broken inside
# 'a group of #FEATURE_KIND#' / 'a range of #FEATURE_KIND#'.
_GROUP_KIND_BANS = ["cluster", "clump", "group", "wall", "bunch", "mix",
                    "mixture", "blend", "assortment", "range", "band", "row",
                    "line", "hedge"]


def select_feature_stems(wanted: set[str] | None) -> list[str]:
    """Resolve the --features filter to the concrete stems to render.

    A filter entry matches a stem exactly or by variant base: "forest_feature"
    hits forest_feature_1..3, "mountains_feature" hits _1 and _2, and the
    special entry "units" hits every unit stem.  Stems that are only pulled
    in over their base name keep their optional-roll behaviour
    (FEATURE_OPTIONAL_STEMS); naming a stem exactly forces it on.
    """
    if not wanted:
        return list(FEATURE_STEM_ORDER_ALL)
    return [stem for stem in FEATURE_STEM_ORDER_ALL
            if stem in wanted
            or ("units" in wanted and stem in UNIT_SPECS)
            or re.sub(r"_\d+$", "", stem) in wanted]


def roll_weighted(entries: list[tuple[str, float]]) -> str | None:
    """Return one entry of a [(text, weight), ...] list, or None to skip.

    Weights need not sum to 1 - whatever is left rolls empty ("nothing this
    time").  Used for the per-iteration mountain atmosphere.
    """
    roll = random.random()
    acc = 0.0
    for text, weight in entries:
        acc += weight
        if roll < acc:
            return text
    return None


_MASS_NOUNS = {"deer", "water", "oil", "coal", "gold", "snow", "ice", "fish",
               "horse", "seal", "year"}

# irregular plurals for group subjects ('a tight rank of spearman' would
# naively pluralise to 'spearmans' - the real formation word is 'spearmen')
_IRREGULAR_PLURALS = {
    "man": "men", "woman": "women", "person": "people", "child": "children",
    "spearman": "spearmen", "horseman": "horsemen", "footman": "footmen",
    "bowman": "bowmen", "clubman": "clubmen",
    "foot": "feet", "goose": "geese", "leaf": "leaves", "loaf": "loaves",
    "tooth": "teeth", "mouse": "mice", "ox": "oxen",
}


def _pluralize_last(phrase: str) -> str:
    """Pluralise the last word of a noun phrase ('coniferous tree cluster'
    -> 'coniferous tree clusters') - used for group subjects like
    'a group of #FEATURE_KIND#', where a singular head noun reads broken."""
    if not phrase:
        return phrase
    head, _, last = phrase.rpartition(" ")
    low = last.lower()
    if low in _MASS_NOUNS or low.endswith("s"):
        return phrase
    if low in _IRREGULAR_PLURALS:
        last = _IRREGULAR_PLURALS[low]
        return f"{head} {last}" if head else last
    if low.endswith(("sh", "ch", "x", "s")):
        last += "es"
    elif low.endswith("y") and len(low) > 2 and low[-2] not in "aeiou":
        last = last[:-1] + "ies"
    else:
        last += "s"
    return f"{head} {last}" if head else last


# ===========================================================================
# small helpers
# ===========================================================================

def http_ok(url: str, timeout: float = 3) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status == 200
    except Exception:
        return False


def start_process(cmd: Iterable[str], log_path: str) -> tuple[subprocess.Popen, Any]:
    log = open(log_path, "w")
    proc = subprocess.Popen(list(cmd), stdout=log, stderr=subprocess.STDOUT)
    return proc, log


def stop_process(proc: subprocess.Popen | None) -> None:
    if not proc:
        return
    try:
        proc.terminate()
        proc.wait(timeout=10)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def wait_for(url: str, timeout: float = 240) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if http_ok(url):
            return True
        time.sleep(2)
    return False


def human(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    return f"{m:d}m{s:02d}s"


# ===========================================================================
# Qwen client
# ===========================================================================

LLAMA_SYSTEM = (
    "You are the prompt writer for a fantasy strategy game asset generator. "
    "You invent short, concrete, visual English phrases for image prompts. "
    "Answer with the requested format only - no explanations, no notes, no "
    "markdown fences, no apologies."
)


def run_llama_prompt(instruction: str, max_tokens: int = 400,
                     temperature: float = 0.9, seed: int | None = None,
                     retries: int = 3) -> str:
    """Ask the local Qwen model for a completion (raw text)."""
    payload: dict[str, Any] = {
        "messages": [
            {"role": "system", "content": LLAMA_SYSTEM},
            {"role": "user", "content": f"/no_think {instruction}"},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if seed is not None:
        payload["seed"] = seed
    body = json.dumps(payload).encode()
    last: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                f"http://127.0.0.1:{LLAMA_PORT}/v1/chat/completions",
                data=body, headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=180) as r:
                resp = json.loads(r.read())
            msg = resp["choices"][0]["message"]
            text = (msg.get("content") or msg.get("reasoning_content") or "").strip()
            text = text.strip('"').strip("'").strip()
            text = re.sub(r"\s+", " ", text)
            if text:
                return text
            last = RuntimeError("empty completion")
        except Exception as exc:  # pragma: no cover - network/local server
            last = exc
            if attempt > 0:
                # the server stopped answering instead of failing the request -
                # let the run restart it, a dead resolver would push every
                # prompt into its fallback phrase
                restart = LLAMA_RESTART_HOOK
                if restart is not None:
                    try:
                        restart()
                    except Exception as restart_exc:
                        last = restart_exc
                        print(f"    [!] llama-server restart failed: {restart_exc}")
        time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"llama-server request failed: {last}")


# main() wires this to ServerManager.restart_llama so a wedged Qwen server is
# brought back automatically instead of degrading the run to fallback phrases
LLAMA_RESTART_HOOK: Callable[[], object] | None = None


def _repair_json(blob: str) -> str:
    """Best-effort repair of slightly broken JSON from a small model."""
    out = re.sub(r",\s*([}\]])", r"\1", blob)
    out = re.sub(r"([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:", r'\1"\2":', out)
    out = re.sub(r"(?<![\w\\])'([^'\n]*)'(?=\s*[:,])", r'"\1"', out)
    out = out.replace("\n", " ")
    return out


def extract_json_object(text: str) -> dict[str, Any] | None:
    """Pull a JSON object out of a model answer, however it is formatted."""
    if not text:
        return None
    blob = text
    fence = re.search(r"```(?:json)?\s*(.*?)```", blob, re.S)
    if fence:
        blob = fence.group(1)
    start = blob.find("{")
    if start < 0:
        return None
    depth = 0
    in_str = False
    esc = False
    end = None
    for i, ch in enumerate(blob[start:], start):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end is None:
        return None
    candidate = blob[start:end]
    for attempt in (candidate, _repair_json(candidate)):
        try:
            data = json.loads(attempt)
        except Exception:
            continue
        if isinstance(data, dict):
            return data
    return None


def extract_key_values(text: str, keys: Iterable[str]) -> dict[str, str]:
    """Fallback extractor: pull `"KEY": "value"` pairs out of broken text."""
    found: dict[str, str] = {}
    if not text:
        return found
    for key in keys:
        m = re.search(
            rf'"{re.escape(key)}"\s*:\s*"([^"]*)"', text, re.I
        ) or re.search(
            rf"'{re.escape(key)}'\s*:\s*'([^']*)'", text, re.I
        ) or re.search(
            rf'"{re.escape(key)}"\s*:\s*([^,}}\n]+)', text, re.I
        )
        if m:
            found[key] = m.group(1).strip()
    return found


def normalise_phrase(value: Any) -> str:
    """Turn a raw model answer into a clean single-line phrase."""
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        value = ", ".join(str(v) for v in value)
    if isinstance(value, dict):
        value = ", ".join(f"{k} {v}" for k, v in value.items())
    text = str(value)
    text = text.replace("\n", " ").replace("\r", " ")
    text = re.sub(r"\s+", " ", text).strip()
    text = text.strip('"').strip("'").strip()
    text = re.sub(r"^[-*•]\s*", "", text)
    text = re.sub(r"\s*#+\s*", " ", text)
    text = re.sub(r"[,;]\s*$", "", text).strip()
    return text


def looks_like_color_list(phrase: str) -> bool:
    """True when a phrase is nothing but a list of colours."""
    words = re.findall(r"[a-z]+", phrase.lower())
    if len(words) < 2:
        return False
    colors = [w for w in words if w in COLOR_WORDS]
    return len(colors) >= 2 and len(colors) >= len(words) * 0.6


def phrase_is_usable(phrase: str, spec: dict[str, Any],
                     anchors: list[str] | None = None,
                     forbidden: list[str] | None = None) -> bool:
    """A slot value is usable when it is a real, on-topic phrase."""
    if not phrase or len(phrase) < 4:
        return False
    if len(phrase.split()) > int(spec.get("max_words", 16)) + 4:
        return False
    first = phrase.split()[0] if phrase.split() else ""
    if "{" in phrase or "}" in phrase or first.endswith(":"):
        return False
    low = phrase.lower()
    if anchors and not any(a in low for a in anchors):
        return False
    if forbidden and any(re.search(rf"\b{re.escape(f)}", low) for f in forbidden):
        return False
    if spec.get("not_color_list") and looks_like_color_list(phrase):
        return False
    return True


class VariationRegistry:
    """Remembers every phrase the local model produced in this run.

    Used to force real variation: a phrase that was already used is re-rolled
    instead of silently producing a duplicate tile.
    """

    def __init__(self) -> None:
        self.phrases: set[str] = set()
        self.prompts: set[str] = set()
        self.themes: list[str] = []
        self._phrase_words: list[set[str]] = []

    @staticmethod
    def _key(text: str) -> str:
        return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()

    def is_new_phrase(self, text: str) -> bool:
        return self._key(text) not in self.phrases

    def is_similar_phrase(self, text: str, threshold: float = 0.6) -> bool:
        """True when the phrase is (nearly) a copy of one that was used."""
        words = set(self._key(text).split())
        if not words:
            return False
        for other in self._phrase_words:
            union = words | other
            if not union:
                continue
            if len(words & other) / len(union) >= threshold:
                return True
        return False

    def remember_phrase(self, text: str) -> None:
        key = self._key(text)
        if not key:
            return
        self.phrases.add(key)
        self._phrase_words.append(set(key.split()))

    def remember_theme(self, text: str) -> None:
        if text:
            self.themes.append(text)

    def is_new_prompt(self, text: str) -> bool:
        return self._key(text) not in self.prompts

    def remember_prompt(self, text: str) -> None:
        self.prompts.add(self._key(text))


# ===========================================================================
# slot resolution
# ===========================================================================

def _slot_lines(specs: list[dict[str, Any]],
                help_overrides: dict[str, str] | None = None) -> str:
    """Render the slot list for the model - with the theme rule spelled out."""
    lines = []
    for spec in specs:
        hint = (help_overrides or {}).get(spec["name"]) or spec.get(
            "help", "a short concrete visual phrase")
        if spec.get("theme") is False and "ignore the theme" not in hint:
            hint += (" - describe the physical subject only, never the time of "
                     "day, the season, the weather or the mood")
        lines.append(f'  "{spec["name"]}": {hint}')
    return "\n".join(lines)


def resolve_slot_bundle(
    specs: list[dict[str, Any]],
    fallbacks: dict[str, str],
    registry: VariationRegistry,
    *,
    identity: str = "",
    theme: str = "",
    context: str = "",
    anchors: dict[str, list[str]] | None = None,
    forbidden: list[str] | dict[str, list[str]] | None = None,
    help_overrides: dict[str, str] | None = None,
    label: str = "",
) -> dict[str, str]:
    """Resolve every slot of one prompt with the local model.

    One call for the whole bundle; slots that come back unusable are re-asked
    one by one; whatever is still missing falls back to a default phrase.

    ``anchors`` maps a slot name to the words that must appear in its value.
    ``forbidden`` is either a list of words that must not appear in any value
    or a mapping of slot name to its own word list.
    """
    values: dict[str, str] = {}
    if not specs:
        return values
    anchors = anchors or {}

    def slot_forbidden(name: str) -> list[str]:
        if isinstance(forbidden, dict):
            words = list(forbidden.get(name, []))
        else:
            words = list(forbidden or [])
        for spec in specs:
            if spec["name"] == name:
                words += list(spec.get("forbidden", []))
        return words

    all_forbidden = sorted({
        word
        for name in (s["name"] for s in specs)
        for word in slot_forbidden(name)
    })

    instruction = (
        "Fill the abstract slots of an image-generation prompt for ONE "
        "asset of a fantasy strategy game. "
        + (f"The asset is {identity}. It MUST stay clearly recognisable as "
           f"{identity}. " if identity else "")
        + (f"The art-direction theme of the set is '{theme}'. " if theme else "")
        + "Be creative but concrete and visual - every value must be a short "
          "English phrase an image model can draw, never a sentence that "
          "contains instructions. "
        + (f"Extra guidance: {context}. " if context else "")
        + (f"The result must not contain any of these words: "
           f"{', '.join(all_forbidden)}. " if all_forbidden else "")
        + "Return ONLY a JSON object mapping each key below to one short "
          "English visual phrase (3-12 words, no quotes inside the value, no "
          "labels, no explanation):\n"
        + _slot_lines(specs, help_overrides)
    )

    raw = ""
    try:
        raw = run_llama_prompt(instruction, max_tokens=420)
    except Exception as exc:
        print(f"    [!] slot resolution for {label} failed: {exc}")

    data = extract_json_object(raw) or {}
    if not data:
        data = extract_key_values(raw, [s["name"] for s in specs])

    for spec in specs:
        name = spec["name"]
        value = ""
        for key in (name, name.lower(), name.capitalize()):
            if key in data:
                value = normalise_phrase(data[key])
                break
        if not phrase_is_usable(value, spec, anchors.get(name),
                                slot_forbidden(name)):
            value = ""
        values[name] = value

    # --- re-ask unusable slots individually, with an explicit "different" nudge
    for spec in specs:
        name = spec["name"]
        if values.get(name):
            continue
        value = _ask_single_slot(
            spec, identity=identity, theme=theme, context=context,
            anchors=anchors.get(name), forbidden=slot_forbidden(name),
            registry=registry, label=label,
        )
        if value:
            values[name] = value

    # --- fall back to the default phrase for whatever is still missing
    for spec in specs:
        name = spec["name"]
        if not values.get(name):
            values[name] = fallbacks.get(name, "")
            if values[name]:
                print(f"    [~] {label}: slot #{name}# fell back to its default")

    # --- force variation: a phrase that was already used is re-rolled once
    for spec in specs:
        name = spec["name"]
        value = values.get(name, "")
        if not value or registry.is_new_phrase(value):
            continue
        fresh = _ask_single_slot(
            spec, identity=identity, theme=theme, context=context,
            anchors=anchors.get(name), forbidden=slot_forbidden(name),
            registry=registry, label=label, avoid=value,
        )
        if fresh:
            values[name] = fresh

    for name, value in values.items():
        registry.remember_phrase(value)
    return values


def _ask_single_slot(spec: dict[str, Any], *, identity: str, theme: str,
                     context: str, anchors: list[str] | None,
                     forbidden: list[str] | None,
                     registry: VariationRegistry, label: str,
                     avoid: str = "") -> str:
    """Ask the local model for a single slot value."""
    name = spec["name"]
    theme_part = ""
    if theme:
        if spec.get("theme") is False:
            theme_part = "Ignore the theme, describe the physical subject only. "
        else:
            theme_part = f"Match the theme '{theme}'. "
    ask = (
        f"Give ONE short English visual phrase for the prompt slot "
        f'"{name}" of a fantasy strategy game asset. '
        + (f"The asset is {identity}; it MUST stay recognisable as "
           f"{identity}. " if identity else "")
        + theme_part
        + f"The phrase describes: {spec['help']}. "
        + (f"Extra guidance: {context}. " if context else "")
        + (f"It must mention one of: {', '.join(anchors[:8])}. " if anchors else "")
        + (f"It must not contain: {', '.join(forbidden)}. " if forbidden else "")
        + (f"It must be different from '{avoid}'. " if avoid else "")
        + f"Maximum {int(spec.get('max_words', 12))} words. "
        + "Answer with the phrase only - no quotes, no label, no explanation."
    )
    for _ in range(2):
        try:
            answer = run_llama_prompt(ask, max_tokens=90, temperature=1.05)
        except Exception as exc:
            print(f"    [!] single-slot ask for {name} failed: {exc}")
            return ""
        answer = normalise_phrase(answer)
        # strip a leading label like "SURFACE_FORM:" the model sometimes adds
        answer = re.sub(rf"^{re.escape(name)}\s*[:\-]\s*", "", answer, flags=re.I)
        if phrase_is_usable(answer, spec, anchors, forbidden):
            return answer
    return ""


def resolve_theme(registry: VariationRegistry,
                  global_values: dict[str, str]) -> str:
    """Make sure the iteration theme is not a near-copy of an earlier one.

    The local model has a strong prior ("golden hour glow over ...") and
    would happily paint three iterations in the same light.  A theme that
    shares too many words with a theme that was already used is re-asked.
    """
    spec = next(s for s in GLOBAL_SLOT_SPECS if s["name"] == "THEME_PHRASE")
    theme = global_values.get("THEME_PHRASE") or ""
    if theme and not registry.is_similar_phrase(theme, 0.6):
        return theme

    previous = "; ".join(registry.themes)
    fresh = _ask_single_slot(
        spec, identity="", theme="",
        context=(
            "the shared mood of a fantasy strategy game asset set - ONLY a "
            "season, a time of day and a light quality, never a place, a "
            "story, an event or an object"
        ),
        anchors=None,
        forbidden=GLOBAL_THEME_FORBIDDEN,
        registry=registry, label="theme", avoid=previous,
    )
    if fresh:
        print(f"    [~] theme was too similar to an earlier one, using: {fresh}")
        return fresh.rstrip(".")
    return theme


def fill_template(text: str, values: dict[str, str]) -> str:
    """Replace every #KEYWORD# in a template with its resolved value."""
    def repl(match: re.Match[str]) -> str:
        return values.get(match.group(1)) or ""

    out = re.sub(r"#([A-Z][A-Z0-9_]*)#", repl, text)
    out = re.sub(r"\s+", " ", out)
    out = re.sub(r"\.\s*,", ",", out)              # "surface., rendered" -> "surface, rendered"
    out = re.sub(r"\s+([,.;])", r"\1", out)
    out = re.sub(r"(?:\s*,\s*)+", ", ", out)       # repeated commas
    out = re.sub(r",\s*\.", ".", out)              # dangling comma before period
    out = re.sub(r"\s*\.\s*\.", ".", out)          # doubled period
    out = re.sub(r"\s+", " ", out)
    return out.strip()


def _strip_article(text: str) -> str:
    """'a single fish' -> 'fish' - the template adds the article itself."""
    return re.sub(r"^(?:an?|the|one)\s+(?:single\s+)?", "", text, flags=re.I).strip()


def _head_noun_phrase(text: str) -> str:
    """Cut a phrase down to its head part.

    'Swimming salmon in three-quarter top-down view' -> 'Swimming salmon'
    (the model likes to smuggle the pose into the kind slot).
    """
    cleaned = re.sub(
        r"\b(?:in|with|from|on|at|seen|viewed|shown|holding|and)\b.*$",
        "", text, flags=re.I,
    ).strip(" ,-")
    return cleaned or text


def _capitalise(text: str) -> str:
    """Upper-case the first letter so a slot can start a sentence."""
    return text[:1].upper() + text[1:] if text else text


def _end_sentence(text: str) -> str:
    """Make sure a slot that ends a sentence carries full stop."""
    text = text.rstrip()
    if text and text[-1] not in ".!?":
        text += "."
    return text


# English articles do not follow the spelling - these words start with a
# vowel letter but take "a" (or vice versa).
_A_EXCEPTIONS = ("one", "once", "european", "eulogy", "utopia", "ubiquitous")
_AN_EXCEPTIONS = ("hour", "honest", "honor", "honour", "heir")
_A_U_EXCEPTIONS = ("umbrella", "uncle", "urgent")


def _fix_articles(text: str) -> str:
    """'a endless expanse' -> 'an endless expanse', 'a wet' stays 'a wet'."""
    def repl(match: re.Match[str]) -> str:
        word = match.group(2)
        low = word.lower()
        if low.startswith(_A_EXCEPTIONS):
            return match.group(0)
        if low.startswith(_AN_EXCEPTIONS):
            return f"an {word}"
        if low.startswith("u"):
            if low.startswith(_A_U_EXCEPTIONS):
                return f"an {word}"
            return match.group(0)
        if low[0] in "aeio":
            return f"an {word}"
        return match.group(0)

    return re.sub(r"\b(a)\s+([A-Za-z]+)", repl, text)


def build_terrain_prompt(terrain: str, theme: str, global_values: dict[str, str],
                          registry: VariationRegistry,
                          style_desc: str = "") -> tuple[str, dict[str, str]]:
    """Resolve the terrain slots and assemble the full terrain prompt.

    A prompt that is already in the registry is re-rolled, so no two tiles of
    a run ever share the same description.
    """
    fallbacks = dict(TERRAIN_FALLBACKS.get(terrain, {}))
    fallbacks.update({k: v for k, v in global_values.items()})
    style_text = (f" Rendered completely in the selected art style: "
                  f"{style_desc}.") if style_desc else ""

    material_words = TERRAIN_FORBIDDEN.get(terrain, [])
    forbidden: dict[str, list[str]] = {
        slot: material_words for slot in TERRAIN_MATERIAL_SLOTS
    }
    forbidden["COLOR_PALETTE"] = TERRAIN_COLOR_FORBIDDEN.get(terrain, [])

    prompt = ""
    values: dict[str, str] = {}
    for attempt in range(3):
        local = resolve_slot_bundle(
            TERRAIN_SLOT_SPECS, fallbacks, registry,
            identity=TERRAIN_IDENTITIES[terrain],
            theme=theme,
            context=(
                "The result is a flat ground texture seen from directly above, "
                "so describe only the surface, never objects standing on it"
            ),
            anchors={
                "SURFACE_FORM": TERRAIN_ANCHORS.get(terrain, []),
                "COLOR_PALETTE": TERRAIN_PALETTE_ANCHORS.get(terrain, []),
            },
            forbidden=forbidden,
            label=f"terrain '{terrain}'",
        )

        values = dict(GLOBAL_FALLBACKS)
        values.update(global_values)
        values.update(fallbacks)
        values.update(local)
        if values.get("LIGHTING_NOTE"):
            values["LIGHTING_NOTE"] = _end_sentence(
                _capitalise(values["LIGHTING_NOTE"].rstrip(".")))

        subject = fill_template(TERRAIN_SUBJECT_TEMPLATE, values)
        details = fill_template(TERRAIN_DETAILS_TEMPLATE, values)
        extra = TERRAIN_EXTRA_CONSTRAINTS.get(terrain, "")
        identity_clause = TERRAIN_IDENTITY_CLAUSE.get(terrain, "")
        details = f"{details} {identity_clause} {extra} {TERRAIN_BASE_CONSTRAINT}".strip()

        prompt = _fix_articles(TERRAIN_PROMPT.format(
            subject=subject, theme=theme, details=details, style=style_text))
        if registry.is_new_prompt(prompt):
            break
        print(f"    [~] terrain '{terrain}': prompt repeated, re-rolling")
    registry.remember_prompt(prompt)
    return prompt, values


def build_feature_prompt(stem: str, spec_key: str, twist: str, theme: str,
                         global_values: dict[str, str],
                         registry: VariationRegistry,
                         extra_clauses: tuple[str, ...] = (),
                         presentation: str = "resource feature sprite",
                         context_extra: str = "",
                         style_desc: str = "",
                         style_context: str = "") -> tuple[str, dict[str, str]]:
    """Resolve the feature slots and assemble the full feature prompt.

    A prompt that is already in the registry is re-rolled, so no two sprites
    of a run ever share the same description.
    """
    spec = UNIT_SPECS.get(spec_key) or FEATURE_SPECS[spec_key]
    fallbacks = dict(spec["fallbacks"])
    fallbacks.update({k: v for k, v in global_values.items()})

    subject_template = spec.get("subject_template", FEATURE_SUBJECT_TEMPLATE)
    group_subject = "of #FEATURE_KIND#" in subject_template
    fixed_clauses = [spec["fixed"]] if spec.get("fixed") else []
    # the caller (the stem loop) can pin per-iteration clauses, e.g. the
    # rolled mountain atmosphere or the rolled dramatic mountain variant
    fixed_clauses.extend(extra_clauses)
    fixed_text = " ".join(fixed_clauses)
    style_text = (f" Rendered completely in the selected art style: "
                  f"{style_desc}.") if style_desc else ""

    # per-slot bans for FEATURE_KIND: pose/detail words belong to FEATURE_FORM
    slot_specs = [dict(s) for s in FEATURE_SLOT_SPECS]
    for s in slot_specs:
        if s["name"] != "FEATURE_KIND":
            continue
        if group_subject:
            # a group subject reads broken with a singular head noun such as
            # 'cluster' - the group clause in "fixed" carries the arrangement
            s["forbidden"] = list(_GROUP_KIND_BANS)
    kind_forbidden = FEATURE_KIND_FORBIDDEN.get(spec_key)
    if kind_forbidden:
        for s in slot_specs:
            if s["name"] == "FEATURE_KIND":
                s["forbidden"] = list(s.get("forbidden") or []) + list(kind_forbidden)

    help_overrides: dict[str, str] = {}
    if twist:
        help_overrides["FEATURE_FORM"] = (
            f"the shape, pose and silhouette of the feature - here it is "
            f"{twist}"
        )
    if spec.get("kind_help"):
        help_overrides["FEATURE_KIND"] = spec["kind_help"]

    prompt = ""
    values: dict[str, str] = {}
    for attempt in range(3):
        local = resolve_slot_bundle(
            slot_specs, fallbacks, registry,
            identity=spec["identity"],
            theme=theme,
            context=(
                "The feature is a single object shown from a three-quarter "
                "isometric game view"
                + (f". {context_extra}" if context_extra else "")
                + (f" {style_context}." if style_context else "")
            ),
            anchors=spec.get("anchors") and {"FEATURE_KIND": spec["anchors"]},
            forbidden=FEATURE_FORBIDDEN.get(spec_key),
            help_overrides=help_overrides,
            label=f"feature '{stem}'",
        )

        values = dict(GLOBAL_FALLBACKS)
        values.update(global_values)
        values.update(fallbacks)
        values.update(local)
        if values.get("FEATURE_KIND"):
            values["FEATURE_KIND"] = _strip_article(_head_noun_phrase(
                values["FEATURE_KIND"]))
            # the templates prepend "a single" themselves - a model answer
            # like "single fish" would read "a single single fish"
            stripped = re.sub(r"^(?:single\s+)+", "", values["FEATURE_KIND"],
                              flags=re.I)
            if stripped:
                values["FEATURE_KIND"] = stripped
            if group_subject:
                # lose a leading wrapper ('mix of tall trees' -> 'tall trees')
                kind = values["FEATURE_KIND"]
                if " of " in kind:
                    kind = kind.rsplit(" of ", 1)[1]
                values["FEATURE_KIND"] = _pluralize_last(kind)
        if values.get("FEATURE_FORM"):
            values["FEATURE_FORM"] = _capitalise(values["FEATURE_FORM"])
        if values.get("FEATURE_LIGHTING"):
            values["FEATURE_LIGHTING"] = _end_sentence(
                _capitalise(values["FEATURE_LIGHTING"].rstrip(".")))
        if values.get("FEATURE_RENDERING"):
            values["FEATURE_RENDERING"] = _end_sentence(
                _capitalise(values["FEATURE_RENDERING"].rstrip(".")))
            if style_desc:
                values["FEATURE_RENDERING"] = (
                    "Rendered completely in the selected art style: "
                    f"{style_desc}.")

        subject = fill_template(subject_template, values)
        details = fill_template(FEATURE_DETAILS_TEMPLATE, values)
        if fixed_text:
            details = f"{details} {fixed_text}"

        prompt = _fix_articles(FEATURE_PROMPT.format(
            subject=subject, theme=theme, details=details,
            presentation=presentation, style=style_text))
        if registry.is_new_prompt(prompt):
            break
        print(f"    [~] feature '{stem}': prompt repeated, re-rolling")
    registry.remember_prompt(prompt)
    return prompt, values


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
    """Make the black background of a sprite transparent.

    A flood fill from the image border removes every pixel that is connected
    to the border *and* looks like background: the background has to be
    really black, so dark parts *inside* the subject survive.  Enclosed black
    regions bigger than a small threshold (gaps between the trees of a group)
    are keyed out as well - they are background the terrain behind the sprite
    must show through.  The edges are feathered with the softness ramp, so
    nothing is cut off with a hard line.
    """
    im = image.convert("RGB")
    arr = np.array(im).astype(np.int16)
    brightest = arr.max(axis=2)
    darkest = arr.min(axis=2)
    candidate = (brightest < level) & (darkest < max(1, level * 0.5))
    background = _flood_from_border(candidate)
    # enclosed background holes ('gaps between the trees'): keep tiny ones -
    # they are usually real subject detail like an eye - key out the big ones
    min_area = max(1, int(image.width * image.height * 0.002))
    background |= _enclosed_background(candidate, background, min_area)
    out = arr.astype(np.uint8)
    out[background] = 0
    alpha = _feather_edge(background, brightest, level, softness)
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
        description="Generate variated tile sets (terrain tiles + feature sprites).",
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
    parser.add_argument("--feature-size", type=int,
                        default=int(os.environ.get("FEATURE_SIZE", "256")),
                        help="feature sprite width in pixels (height is 1.5x)")
    parser.add_argument("--seed", type=int, default=int(os.environ.get("SEED", "-1")),
                        help="base seed for reproducible runs (-1 = random)")
    parser.add_argument("--retries", type=int, default=int(os.environ.get("RETRIES", "3")),
                        help="render attempts per image before the fallback is used")
    parser.add_argument("--bg-level", type=int, default=int(os.environ.get("BG_LEVEL", str(BG_LEVEL))),
                        help="background removal level: the black point 0-255, higher "
                             "removes more (default: %(default)s)")
    parser.add_argument("--bg-softness", type=int,
                        default=int(os.environ.get("BG_SOFTNESS", str(BG_SOFTNESS))),
                        help="background removal softness 0-255: the width of the "
                             "anti-aliasing ramp, 0 is a hard edge (default: %(default)s)")
    parser.add_argument("--terrains", default=os.environ.get("TERRAINS", ""),
                        help="comma separated list of terrains (default: all)")
    parser.add_argument("--features", default=os.environ.get("FEATURES", ""),
                        help="comma separated feature stems, matches also by "
                             "variant base name ('forest_feature' renders "
                             "forest_feature_1..3); a stem named exactly "
                             "forces an optional variant on")
    parser.add_argument("--dry-run", action="store_true",
                        help="only resolve the prompts with the local model, render nothing")
    parser.add_argument("--no-features", action="store_true",
                        help="skip the feature sprites")
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
                        help="one art-direction keyword for this whole run "
                             "(e.g. Halloween, Christmas, 'Transylvania and "
                             "vampires', Easter) - theme, palette, lighting "
                             "and every slot phrase are clearly shot through "
                             "with it, and feature animals may swap to close "
                             "themed equivalents")
    parser.add_argument("--style-keyword",
                        default=os.environ.get("STYLE_KEYWORD", ""),
                        help="one art STYLE for this whole run (a STYLE_KEYS "
                             "name such as american_comic, manga, pixel_art, "
                             "... or any freeform style phrase) - changes "
                             "only HOW everything is rendered; subject "
                             "identities stay untouched")
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
                        help="with --write-batch: feature/unit whitelist "
                             "passed to every generated job (--features ...)")
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
        "# Runs one tile-set job after another, each with its own log under",
        "# tools/tile-generator/run_logs/.  Start it in the background:",
        f"#   nohup bash {script.name} > batch.out 2>&1 &",
        "set -u",
        f'cd "{ROOT}"',
        'GEN="tools/tile-generator/generate_variated_tile_sets.py"',
        'LOG_DIR="tools/tile-generator/run_logs"',
        'mkdir -p "$LOG_DIR"',
        "",
        "fail=0",
        "",
        "run_job() {",
        '  local label="$1"; shift',
        '  local log="$LOG_DIR/$label.log"',
        '  echo "=== job: $label ($(date -Is)) ==="',
        '  if python3 -u "$GEN" "$@" >>"$log" 2>&1; then',
        '    echo "    OK     -> $log"',
        "  else",
        '    fail=$((fail+1))',
        '    echo "    FAILED -> $log"',
        "  fi",
        "}",
        "",
    ]
    for label, cmd_args in jobs:
        quoted = " ".join(shlex.quote(a) for a in cmd_args)
        lines.append(f'run_job {shlex.quote(label)} {quoted}'.rstrip())
    lines += [
        "",
        'echo "=== batch done ($(date -Is)): $fail job(s) failed ==="',
        f'echo "logs: $LOG_DIR"',
        'exit "$fail"',
        "",
    ]
    script.write_text("\n".join(lines))
    script.chmod(0o755)
    return script


def main() -> int:
    global LLAMA_RESTART_HOOK
    args = build_parser().parse_args()
    theme_keyword = args.theme_keyword.strip()
    if theme_keyword:
        print(f"[*] direction keyword: {theme_keyword!r} - theme, palette, "
              f"lighting and slot phrases will be shot through with it")
    style_name, style_desc, style_context = "", "", ""
    if args.style_keyword.strip():
        style_name, style_desc = resolve_style(args.style_keyword)
        style_context = style_clauses(style_name, style_desc)
        print(f"[*] art style: {style_name} - rendering only, identities "
              f"untouched")

    if args.write_batch:
        extra: list[str] = []
        if args.batch_terrains.strip():
            extra += ["--terrains", args.batch_terrains.strip()]
        if args.batch_features.strip():
            extra += ["--features", args.batch_features.strip()]
        script = write_batch_script(
            args.write_batch.split(","), args.batch_iterations,
            style_mode=args.batch_style_mode, extra_args=extra)
        print(f"[*] batch script written: {script}")
        print(f"    start it in the background with:")
        print(f"    nohup bash \"{script}\" > \"{script.with_suffix('.out')}\" 2>&1 &")
        return 0

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
    wanted = ({f.strip().lower() for f in args.features.split(",") if f.strip()}
              if args.features else None)
    stems = select_feature_stems(wanted)
    if not stems:
        print(f"[-] --features {args.features!r} matches none of: "
              f"{', '.join(FEATURE_STEM_ORDER_ALL)}")
        return 2
    for p in feature_inputs:
        print(f"[*] feature input: {p.name}")
    unit_icons, unit_names = load_unit_game_icons()
    unit_stems = [s for s in stems if s in UNIT_SPECS]
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
    run_dir = output_root / str(int(time.time()))
    run_dir.mkdir(parents=True, exist_ok=True)
    print(f"[*] output: {run_dir}")

    servers = ServerManager(args)
    registry = VariationRegistry()
    LLAMA_RESTART_HOOK = servers.restart_llama
    started = time.time()
    run_manifest: dict[str, Any] = {
        "started": time.strftime("%Y-%m-%d %H:%M:%S"),
        "iterations": args.iterations,
        "theme_keyword": theme_keyword,
        "size": args.size,
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
            tiles_dir.mkdir(parents=True, exist_ok=True)
            features_dir.mkdir(parents=True, exist_ok=True)
            iter_manifest: dict[str, Any] = {"iteration": i, "tiles": {}, "features": {}}

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
                    "theme phrase, palette and lighting must be clearly shot "
                    "through with it"
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
                theme = f"{theme}, strongly infused with a {theme_keyword} mood"
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
                    prompt, keywords = build_terrain_prompt(
                        terrain, theme, global_values, registry,
                        style_desc=style_desc,
                    )
                    (iter_dir / f"prompt_{terrain}.txt").write_text(
                        prompt + "\n\nNegative prompt: " + NEGATIVE_TERRAIN + "\n"
                    )
                    (iter_dir / f"keywords_{terrain}.json").write_text(
                        json.dumps(keywords, indent=2, sort_keys=True) + "\n"
                    )
                    iter_manifest["tiles"][terrain] = {
                        "prompt": prompt,
                        "keywords": keywords,
                    }

                    if args.dry_run:
                        print(f"    ~ tile {terrain} (dry run)")
                        continue

                    out_path = tiles_dir / f"terrain_{terrain}.png"
                    seed = None if args.seed < 0 else args.seed + i * 100 + len(terrain)
                    t0 = time.time()
                    ok = render(prompt, NEGATIVE_TERRAIN, out_path,
                                args.size, args.size, seed=seed)
                    if ok:
                        clean_terrain_tile(out_path)
                        if not tile_is_usable(out_path):
                            print(f"    ! tile {terrain}: unusable output")
                            ok = False
                    if ok:
                        print(f"    + tile {terrain} ({human(time.time() - t0)})")
                        iter_manifest["tiles"][terrain]["output"] = str(
                            out_path.relative_to(run_dir))
                    else:
                        fallback = PUBLIC_TILES / f"terrain_{terrain}.png"
                        if not fallback.exists():
                            fallback = PUBLIC_TILES / f"terrain_{terrain}_1.png"
                        if fallback.exists():
                            shutil.copy(fallback, out_path)
                            iter_manifest["tiles"][terrain]["output"] = str(
                                out_path.relative_to(run_dir))
                            iter_manifest["tiles"][terrain]["fallback"] = True
                        print(f"    ! tile {terrain}: fallback to the original tile")

            # ---- 3. feature sprites --------------------------------------
            if not args.no_features:
                tmp_dir = iter_dir / "_tmp"
                tmp_dir.mkdir(exist_ok=True)

                # per-iteration rolls: the optional dramatic mountain variant
                # and the mountain atmosphere
                rolls: dict[str, Any] = {}
                active: list[str] = []
                for stem in stems:
                    chance = FEATURE_OPTIONAL_STEMS.get(stem)
                    if chance is not None:
                        forced = bool(wanted and stem in wanted)
                        if not forced and random.random() >= chance:
                            rolls[stem] = "skipped (optional roll)"
                            continue
                    active.append(stem)
                atmosphere_by_stem: dict[str, str] = {}
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
                    iter_manifest["features"][stem] = entry

                    variant_count = UNIT_VARIANTS if is_unit else 1
                    for variant in range(1, variant_count + 1):
                        suffix = "" if variant == 1 else f"_{variant}"
                        prompt, keywords = build_feature_prompt(
                            stem, spec_key, twist, theme, global_values,
                            registry, extra_clauses=extra,
                            presentation=presentation,
                            context_extra=THEMED_EQUIVALENT_CLAUSE,
                            style_desc=style_desc,
                            style_context=style_context,
                        )
                        (iter_dir /
                         f"prompt_feature_{stem}{suffix}.txt").write_text(
                            prompt + "\n\nNegative prompt: "
                            + NEGATIVE_FEATURE + "\n"
                        )
                        (iter_dir /
                         f"keywords_feature_{stem}{suffix}.json").write_text(
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
                            print(f"    ~ feature {stem} [{variant}/"
                                  f"{variant_count}] (dry run)")
                            continue

                        raw_path = tmp_dir / f"{stem}_raw{suffix}.png"
                        out_name = FEATURE_OUTPUT_NAMES.get(stem, stem)
                        out_name = f"{out_name}{suffix}"
                        out_path = features_dir / f"{out_name}.png"

                        t0 = time.time()
                        seed = (None if args.seed < 0 else
                                args.seed + i * 1000 + len(stem)
                                + variant * 7)
                        ok = render(prompt, NEGATIVE_FEATURE, raw_path, fw, fh,
                                    init_image=init_image, seed=seed)

                        # the untouched original is kept next to the result,
                        # before the background is removed
                        backup_path = (features_dir / BACKUP_DIR_NAME /
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
                            print(f"    ! feature {stem} [{variant}/"
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
                        print(f"    + feature {stem} "
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

    print(f"\nDone in {human(time.time() - started)}. Tile sets in: {run_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
