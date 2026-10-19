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
     way, and the isolated feature sprite is rendered from the feature-only
     input picture (flattened onto pure black) via img2img, so the sprite keeps
     the identity of the input artwork while the local model re-skins it.
  4. The black ``#000000`` background of every sprite is keyed out to a
     transparent alpha channel.

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
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections import deque
from pathlib import Path
from typing import Any, Iterable

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

Style & Art Direction: Highly detailed semi-realistic digital painting, modern strategy game illustration, intricate surface details, natural textures, realistic lighting and soft shading, crisp high resolution, no thick cartoon outlines. {theme}

Subject Details: {details}

Technical Specs: Flat map view, strictly top-down overhead perspective, no tree trunks, no side perspective, no vertical horizon, continuous organic texture, no repeating grid pattern, even coverage from edge to edge, crisp 8k digital painting."""

FEATURE_PROMPT = """isometric 2D video game resource feature sprite of {subject}, isolated standalone central sprite, isometric strategic 3/4 game view showing height and volume, centrally composed asset, well-balanced framing, occupying the central canvas area, generous margins on all sides so all peaks and edges are fully contained within the frame with no cropped borders and no cut-off peaks, tightly framed with no massive dead space or huge empty areas, centered on a clean solid dark neutral background for easy masking, game UI icon sprite, isolated subject.

Style & Art Direction: Hand-drawn fantasy strategy game illustration, Civilization V game asset style, clean dark linework outlines, smooth cell shading, vibrant yet grounded color palette. {theme}

Subject Details: {details} The sprite shows ONLY the feature itself - {subject} - floating on a completely empty solid pure black #000000 background - no water, no backdrop, no scenery, no texture, no shadows, no ground, no environment of any kind behind the subject.

Technical Specs: High contrast, top-down 45-degree isometric camera view, no shadow cast outside the sprite border, perfectly isolated subject on a pure black #000000 background, 8k resolution, crisp vector-like digital painting."""

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
    "forest_feature": "terrain_forest_feature_1",
    "hills_feature": "terrain_hills_feature",
    "jungle_feature": "terrain_jungle_feature",
    "mountains_feature": "terrain_mountains_feature_1",
    "swamp_feature": "terrain_swamp_feature",
    "horses": "terrain_plains_horses",
    "horses_2": "terrain_plains_horses_2",
}

# One spec per feature *kind*; several inputs may share a kind (fish1..fish5).
FEATURE_SPECS = {
    "fish": {
        "identity": "a single fish",
        "anchors": ["fish", "carp", "trout", "salmon", "perch", "pike", "eel"],
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
        "identity": "a single horse",
        "anchors": ["horse", "stallion", "mare", "pony", "foal", "charger"],
        "fallbacks": {
            "FEATURE_KIND": "horse",
            "FEATURE_FORM": "a standing horse in a calm pose with a clear mane and tail silhouette",
            "FEATURE_DETAIL": "defined musculature, a flowing mane and a visible bridle line",
            "FEATURE_PALETTE": "warm brown and tan tones",
            "FEATURE_LIGHTING": "warm key light from the upper left with soft belly shadow",
            "FEATURE_RENDERING": "clean dark outlines with smooth cell shading",
        },
    },
    "forest_feature": {
        "identity": "a cluster of deciduous trees",
        "anchors": ["tree", "trees", "canopy", "forest", "wood", "foliage"],
        "fallbacks": {
            "FEATURE_KIND": "cluster of deciduous trees",
            "FEATURE_FORM": "interlocking rounded canopies on short dark trunks",
            "FEATURE_DETAIL": "layered leaf clusters, small bushes and low undergrowth",
            "FEATURE_PALETTE": "layered greens with warm yellow-green highlights",
            "FEATURE_LIGHTING": "dappled daylight from above with deep cool shadows",
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
        "identity": "a tropical jungle canopy cluster",
        "anchors": ["jungle", "tropical", "canopy", "palm", "vine", "fern", "leaf"],
        "fallbacks": {
            "FEATURE_KIND": "tropical jungle canopy cluster",
            "FEATURE_FORM": "a dense cluster of broad-leaved trees with hanging vines",
            "FEATURE_DETAIL": "large ferns, giant leaves and a few small bright flowers",
            "FEATURE_PALETTE": "deep emerald and olive greens with emerald highlights",
            "FEATURE_LIGHTING": "humid filtered light with deep green shadows",
            "FEATURE_RENDERING": "semi-realistic digital painting with clean dark outlines",
        },
    },
    "mountains_feature": {
        "identity": "a snow-capped mountain peak cluster",
        "anchors": ["mountain", "peak", "summit", "ridge", "alp", "crag"],
        "fallbacks": {
            "FEATURE_KIND": "snow-capped mountain peak cluster",
            "FEATURE_FORM": "a tight grouping of sharp peaks with steep flanks",
            "FEATURE_DETAIL": "detailed rock faces, icy snow drifts and frost-covered ridges",
            "FEATURE_PALETTE": "icy blue and pale grey with clean white snow caps",
            "FEATURE_LIGHTING": "crisp cold light with hard small shadows",
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

# Which spec every input file uses, plus the little per-file twist (a
# different pose / orientation) that keeps the variants apart.
FEATURE_STEM_SPECS = {
    "fish1": {"spec": "fish", "twist": "swimming to the left, seen from a three-quarter top-down view"},
    "fish2": {"spec": "fish", "twist": "swimming to the right, seen from a three-quarter top-down view"},
    "fish3": {"spec": "fish", "twist": "curving in an S-shape, seen from a three-quarter top-down view"},
    "fish4": {"spec": "fish", "twist": "diving downwards with the tail raised, seen from above"},
    "fish5": {"spec": "fish", "twist": "resting horizontally, seen from directly above"},
    "horses": {"spec": "horse", "twist": "standing in profile, head lowered"},
    "horses_2": {"spec": "horse", "twist": "lying down with folded legs"},
    "forest_feature": {"spec": "forest_feature", "twist": "a tight group of trees"},
    "hills_feature": {"spec": "hills_feature", "twist": "a single rounded rise"},
    "jungle_feature": {"spec": "jungle_feature", "twist": "a dense wall of foliage"},
    "mountains_feature": {"spec": "mountains_feature", "twist": "a tight group of peaks"},
    "swamp_feature": {"spec": "swamp_feature", "twist": "a gnarled stump in shallow water"},
}

# Which subject components are kept when the input picture is prepared:
#   "single"  -> only the biggest connected blob (one horse, one fish)
#   "cluster" -> every blob above 15 % of the biggest one (tree clusters)
FEATURE_SUBJECT_MODE = {
    "horses": "single",
    "horses_2": "single",
    "fish1": "single", "fish2": "single", "fish3": "single",
    "fish4": "single", "fish5": "single",
}

# Words that must not show up in a resolved feature slot - "a single fish"
# must never become a school of fish.
FEATURE_FORBIDDEN = {
    "fish": ["school", "pod", "herd", "group", "multiple", "pair", "bowl",
             "fishing", "hook", "rod"],
    "horse": ["herd", "group", "team", "multiple", "pair", "stable", "rider",
              "saddle", "carriage"],
    "forest_feature": ["single tree", "lone tree"],
    "hills_feature": [],
    "jungle_feature": [],
    "mountains_feature": [],
    "swamp_feature": [],
}


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
        time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"llama-server request failed: {last}")


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
                          registry: VariationRegistry) -> tuple[str, dict[str, str]]:
    """Resolve the terrain slots and assemble the full terrain prompt.

    A prompt that is already in the registry is re-rolled, so no two tiles of
    a run ever share the same description.
    """
    fallbacks = dict(TERRAIN_FALLBACKS.get(terrain, {}))
    fallbacks.update({k: v for k, v in global_values.items()})

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
            subject=subject, theme=theme, details=details))
        if registry.is_new_prompt(prompt):
            break
        print(f"    [~] terrain '{terrain}': prompt repeated, re-rolling")
    registry.remember_prompt(prompt)
    return prompt, values


def build_feature_prompt(stem: str, spec_key: str, twist: str, theme: str,
                         global_values: dict[str, str],
                         registry: VariationRegistry) -> tuple[str, dict[str, str]]:
    """Resolve the feature slots and assemble the full feature prompt.

    A prompt that is already in the registry is re-rolled, so no two sprites
    of a run ever share the same description.
    """
    spec = FEATURE_SPECS[spec_key]
    fallbacks = dict(spec["fallbacks"])
    fallbacks.update({k: v for k, v in global_values.items()})

    prompt = ""
    values: dict[str, str] = {}
    for attempt in range(3):
        local = resolve_slot_bundle(
            FEATURE_SLOT_SPECS, fallbacks, registry,
            identity=spec["identity"],
            theme=theme,
            context=(
                "The feature is a single object shown from a three-quarter "
                "isometric game view"
            ),
            anchors=spec.get("anchors") and {"FEATURE_KIND": spec["anchors"]},
            forbidden=FEATURE_FORBIDDEN.get(spec_key),
            help_overrides={
                "FEATURE_FORM": (
                    f"the shape, pose and silhouette of the feature - here it is "
                    f"{twist}"
                ),
            },
            label=f"feature '{stem}'",
        )

        values = dict(GLOBAL_FALLBACKS)
        values.update(global_values)
        values.update(fallbacks)
        values.update(local)
        if values.get("FEATURE_KIND"):
            values["FEATURE_KIND"] = _strip_article(_head_noun_phrase(
                values["FEATURE_KIND"]))
        if values.get("FEATURE_FORM"):
            values["FEATURE_FORM"] = _capitalise(values["FEATURE_FORM"])
        if values.get("FEATURE_LIGHTING"):
            values["FEATURE_LIGHTING"] = _end_sentence(
                _capitalise(values["FEATURE_LIGHTING"].rstrip(".")))
        if values.get("FEATURE_RENDERING"):
            values["FEATURE_RENDERING"] = _end_sentence(
                _capitalise(values["FEATURE_RENDERING"].rstrip(".")))

        subject = fill_template(FEATURE_SUBJECT_TEMPLATE, values)
        details = fill_template(FEATURE_DETAILS_TEMPLATE, values)

        prompt = _fix_articles(FEATURE_PROMPT.format(
            subject=subject, theme=theme, details=details))
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
    background = np.zeros((h, w), dtype=bool)
    queue: deque[tuple[int, int]] = deque()
    for x in range(w):
        for y in (0, h - 1):
            if candidate[y, x] and not background[y, x]:
                background[y, x] = True
                queue.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if candidate[y, x] and not background[y, x]:
                background[y, x] = True
                queue.append((x, y))
    while queue:
        x, y = queue.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and candidate[ny, nx] and not background[ny, nx]:
                background[ny, nx] = True
                queue.append((nx, ny))
    return background


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
    really black, so dark parts *inside* the subject survive.  The edge is
    feathered with the softness ramp, so nothing is cut off with a hard line.
    """
    im = image.convert("RGB")
    arr = np.array(im).astype(np.int16)
    brightest = arr.max(axis=2)
    darkest = arr.min(axis=2)
    candidate = (brightest < level) & (darkest < max(1, level * 0.5))
    background = _flood_from_border(candidate)
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
                        help="comma separated list of feature inputs (default: all)")
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
    return parser


def main() -> int:
    args = build_parser().parse_args()

    terrains = [t.strip() for t in args.terrains.split(",") if t.strip()] or list(TERRAINS)
    unknown = [t for t in terrains if t not in TERRAINS]
    if unknown:
        print(f"[-] unknown terrain(s): {', '.join(unknown)}")
        return 2

    feature_inputs = sorted(
        p for p in FEATURE_RESOURCES.glob(FEATURE_INPUT_GLOB)
        if not is_backup_path(p)
    )
    if args.features:
        wanted = {f.strip() for f in args.features.split(",") if f.strip()}
        feature_inputs = [p for p in feature_inputs if p.stem in wanted]
    if not feature_inputs and not args.no_features:
        print(f"[-] No feature input pictures in {FEATURE_RESOURCES}")
        return 1
    for p in feature_inputs:
        print(f"[*] feature input: {p.name}")

    output_root = Path(args.output_root)
    output_root.mkdir(parents=True, exist_ok=True)
    run_dir = output_root / str(int(time.time()))
    run_dir.mkdir(parents=True, exist_ok=True)
    print(f"[*] output: {run_dir}")

    servers = ServerManager(args)
    registry = VariationRegistry()
    started = time.time()
    run_manifest: dict[str, Any] = {
        "started": time.strftime("%Y-%m-%d %H:%M:%S"),
        "iterations": args.iterations,
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
            global_values = resolve_slot_bundle(
                GLOBAL_SLOT_SPECS, GLOBAL_FALLBACKS, registry,
                theme="",
                context=(
                    "These values are shared by every tile and sprite of one "
                    "asset set, so they must work for all terrains at once. "
                    "Describe mood, colour and light only - never a place, a "
                    "story, an event, a battle or an object"
                ),
                forbidden=GLOBAL_THEME_FORBIDDEN,
                label="iteration globals",
            )
            theme = global_values.get("THEME_PHRASE") or GLOBAL_FALLBACKS["THEME_PHRASE"]
            theme = _strip_article(theme).rstrip(".")
            if registry.themes:
                theme = resolve_theme(registry, {"THEME_PHRASE": theme})
            registry.remember_theme(theme)
            global_values["THEME_PHRASE"] = theme
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
                for fpath in feature_inputs:
                    stem = fpath.stem
                    spec_info = FEATURE_STEM_SPECS.get(stem)
                    if spec_info is None:
                        base = re.sub(r"_?\d+$", "", stem)
                        spec_info = {"spec": base if base in FEATURE_SPECS else "fish",
                                     "twist": f"a {base}"}
                    spec_key = spec_info["spec"]
                    twist = spec_info["twist"]

                    prompt, keywords = build_feature_prompt(
                        stem, spec_key, twist, theme, global_values, registry,
                    )
                    (iter_dir / f"prompt_feature_{stem}.txt").write_text(
                        prompt + "\n\nNegative prompt: " + NEGATIVE_FEATURE + "\n"
                    )
                    (iter_dir / f"keywords_feature_{stem}.json").write_text(
                        json.dumps(keywords, indent=2, sort_keys=True) + "\n"
                    )
                    iter_manifest["features"][stem] = {
                        "prompt": prompt,
                        "keywords": keywords,
                        "spec": spec_key,
                    }

                    if args.dry_run:
                        print(f"    ~ feature {stem} (dry run)")
                        continue

                    fw = args.feature_size
                    fh = int(args.feature_size * 1.5)
                    init_path = tmp_dir / f"{stem}_init.png"
                    prepare_feature_input(
                        fpath, init_path, fw, fh,
                        mode=FEATURE_SUBJECT_MODE.get(stem, "cluster"),
                        level=args.bg_level, softness=args.bg_softness,
                    )
                    raw_path = tmp_dir / f"{stem}_raw.png"
                    out_name = FEATURE_OUTPUT_NAMES.get(stem, stem)
                    out_path = features_dir / f"{out_name}.png"

                    t0 = time.time()
                    seed = None if args.seed < 0 else args.seed + i * 1000 + len(stem)
                    ok = render(prompt, NEGATIVE_FEATURE, raw_path, fw, fh,
                                init_image=init_path, seed=seed)

                    # the untouched original is kept next to the result, before
                    # the background is removed
                    backup_path = features_dir / BACKUP_DIR_NAME / f"{out_name}.png"
                    backup_path.parent.mkdir(parents=True, exist_ok=True)
                    if ok:
                        shutil.copy(raw_path, backup_path)
                    else:
                        shutil.copy(init_path, backup_path)

                    if ok:
                        sprite = Image.open(raw_path).convert("RGB")
                        if args.use_rembg and remove_background_rembg(raw_path, out_path):
                            method = "rembg"
                        else:
                            sprite = key_out_black(sprite, level=args.bg_level,
                                                   softness=args.bg_softness)
                            sprite.save(out_path, "PNG")
                            method = "black-key"
                    else:
                        # fallback: use the prepared input, still background-free
                        sprite = Image.open(init_path).convert("RGB")
                        sprite = key_out_black(sprite, level=args.bg_level,
                                               softness=args.bg_softness)
                        sprite.save(out_path, "PNG")
                        method = "input-fallback"

                    clean_feature_sprite(out_path, level=args.bg_level,
                                         softness=args.bg_softness)
                    iter_manifest["features"][stem]["output"] = str(
                        out_path.relative_to(run_dir))
                    iter_manifest["features"][stem]["backup"] = str(
                        backup_path.relative_to(run_dir))
                    iter_manifest["features"][stem]["method"] = method
                    print(f"    + feature {stem} -> {out_name}.png "
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
