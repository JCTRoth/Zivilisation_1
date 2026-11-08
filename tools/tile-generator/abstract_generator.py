#!/usr/bin/env python3
"""The abstract prompt generator: JSON in, prompt bundle out.

This module is the *planning* half of the tile generator. It owns nothing
that touches a GPU: no sd-server, no image files, no post-processing. What it
owns is everything that decides WHAT to ask the image model for:

  * ``specs/*.json`` - the source of truth for the asset roster, the abstract
    slot system, the prompt templates and the negative prompts. The Python
    constants are gone; edit the JSON,
  * the slot resolver (Qwen through llama-server: anchors, forbidden words,
    re-ask, fallback, deduplication),
  * prompt assembly for terrains, feature sprites and game units,
  * the request -> bundle planning API shared by the CLI below and
    ``generate_variated_tile_sets.py``, which renders the bundle.

Usage::

    python3 abstract_generator.py --request request.json --out bundle.json
    python3 abstract_generator.py --request - --out -          # stdin/stdout
    python3 abstract_generator.py --request request.json --no-llm
    python3 abstract_generator.py --selftest                  # golden check

Contract: ``version`` is checked on every spec file, on the request and on
the bundle. Unknown keys, unknown ``#SLOT#`` placeholders, unknown template
placeholders and unknown asset/spec ids are HARD errors (SpecError, exit 2)
naming the offending key - a typo must never silently degrade a prompt.
Qwen being unreachable is different: it degrades to the built-in fallback
phrase and is reported as a warning, exactly like the renderer does.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import random
import re
import string
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any, Callable, Iterable

# ── llama-server (env overridable; the renderer imports these too) ──────────
LLAMA_SERVER_BIN = Path(os.environ.get(
    "LLAMA_SERVER_BIN", "/home/jonas/git/Local_AI/source/llama.cpp/build/bin/llama-server"
))
QWEN_MODEL = Path(os.environ.get(
    "QWEN_MODEL", "/home/jonas/git/Local_AI/models/main_model/Qwen3-4B-Q4_K_M.gguf"
))
LLAMA_PORT = int(os.environ.get("LLAMA_PORT", "8099"))
LLAMA_LOG = os.environ.get("LLAMA_LOG", "/tmp/llama_server_variate.log")

# ── specs: JSON is the source of truth ──────────────────────────────────────
SPECS_DIR = Path(__file__).resolve().parent / "specs"
SPEC_VERSION = 1
SPEC_FILES = ("assets", "slots", "templates", "negatives")

# False under --no-llm: every Qwen call fails fast and the resolver falls
# back to the built-in phrases, which makes a run fully deterministic.
LLM_ENABLED = True


class SpecError(RuntimeError):
    """A spec/request/bundle contract violation (bad data, not bad luck)."""


# Bound by load_specs() from specs/*.json. The explicit values keep static
# checkers happy (a bare annotation is not a binding) and load_specs() — run
# once at import, again when --specs points somewhere else — fills them in.
TERRAINS: Any = None
TERRAIN_VARIANTS: Any = None
TERRAIN_VARIANT_NOTES: Any = None
FEATURE_STEM_ORDER: Any = None
FEATURE_OPTIONAL_STEMS: Any = None
FEATURE_TEXT_ONLY_STEMS: Any = None
FEATURE_INPUT_GLOB: Any = None
FEATURE_OUTPUT_NAMES: Any = None
FEATURE_STEM_SPECS: Any = None
FEATURE_SUBJECT_MODE: Any = None
MOUNTAIN_ATMOSPHERE: Any = None
MOUNTAIN_CRAZY: Any = None
UNIT_KEY_ORDER: Any = None
UNIT_STEM_ORDER: Any = None
UNIT_VARIANTS: Any = None
UNIT_WIDE_STEMS: Any = None
UNIT_SVG_FILES: Any = None
COLOR_WORDS: Any = None
GLOBAL_THEME_FORBIDDEN: Any = None
GLOBAL_SLOT_SPECS: Any = None
TERRAIN_SLOT_SPECS: Any = None
FEATURE_SLOT_SPECS: Any = None
GLOBAL_FALLBACKS: Any = None
TERRAIN_FALLBACKS: Any = None
TERRAIN_IDENTITIES: Any = None
TERRAIN_ANCHORS: Any = None
TERRAIN_FORBIDDEN: Any = None
TERRAIN_PALETTE_ANCHORS: Any = None
TERRAIN_IDENTITY_CLAUSE: Any = None
TERRAIN_MATERIAL_SLOTS: Any = None
TERRAIN_COLOR_FORBIDDEN: Any = None
TERRAIN_EXTRA_CONSTRAINTS: Any = None
TERRAIN_BASE_CONSTRAINT: Any = None
FEATURE_SPECS: Any = None
FEATURE_FORBIDDEN: Any = None
FEATURE_KIND_FORBIDDEN: Any = None
UNIT_SPECS: Any = None
_MASS_NOUNS: Any = None
_IRREGULAR_PLURALS: Any = None
TERRAIN_PROMPT: Any = None
TERRAIN_SUBJECT_TEMPLATE: Any = None
TERRAIN_DETAILS_TEMPLATE: Any = None
FEATURE_PROMPT: Any = None
FEATURE_SUBJECT_TEMPLATE: Any = None
FEATURE_DETAILS_TEMPLATE: Any = None
FEATURE_ART_DIRECTION: Any = None
UNIT_PROMPT: Any = None
UNIT_DETAILS_TEMPLATE: Any = None
UNIT_ART_DIRECTION: Any = None
_UNIT_RELIABLE_LIGHT: Any = None
_UNIT_RELIABLE_RENDER: Any = None
THEME_ACCENT_CLAUSE: Any = None
STYLE_KEYS: Any = None
STYLE_DESCRIPTIONS: Any = None
NEGATIVE_TERRAIN: Any = None
NEGATIVE_FEATURE: Any = None
NEGATIVE_UNIT: Any = None
UNIT_NEGATIVE_EXTRA: Any = None

_BINDINGS: list[tuple[str, str]] = [
    ("assets.terrains.order", "TERRAINS"),
    ("assets.terrains.variants", "TERRAIN_VARIANTS"),
    ("assets.terrains.variantNotes", "TERRAIN_VARIANT_NOTES"),
    ("assets.features.order", "FEATURE_STEM_ORDER"),
    ("assets.features.optional", "FEATURE_OPTIONAL_STEMS"),
    ("assets.features.textOnly", "FEATURE_TEXT_ONLY_STEMS"),
    ("assets.features.inputGlob", "FEATURE_INPUT_GLOB"),
    ("assets.features.outputNames", "FEATURE_OUTPUT_NAMES"),
    ("assets.features.stemSpecs", "FEATURE_STEM_SPECS"),
    ("assets.features.subjectMode", "FEATURE_SUBJECT_MODE"),
    ("assets.features.rolls.MOUNTAIN_ATMOSPHERE", "MOUNTAIN_ATMOSPHERE"),
    ("assets.features.rolls.MOUNTAIN_CRAZY", "MOUNTAIN_CRAZY"),
    ("assets.units.order", "UNIT_KEY_ORDER"),
    ("assets.units.stems", "UNIT_STEM_ORDER"),
    ("assets.units.variants", "UNIT_VARIANTS"),
    ("assets.units.wide", "UNIT_WIDE_STEMS"),
    ("assets.units.svgFiles", "UNIT_SVG_FILES"),
    ("slots.COLOR_WORDS", "COLOR_WORDS"),
    ("slots.GLOBAL_THEME_FORBIDDEN", "GLOBAL_THEME_FORBIDDEN"),
    ("slots.GLOBAL_SLOT_SPECS", "GLOBAL_SLOT_SPECS"),
    ("slots.TERRAIN_SLOT_SPECS", "TERRAIN_SLOT_SPECS"),
    ("slots.FEATURE_SLOT_SPECS", "FEATURE_SLOT_SPECS"),
    ("slots.GLOBAL_FALLBACKS", "GLOBAL_FALLBACKS"),
    ("slots.TERRAIN_FALLBACKS", "TERRAIN_FALLBACKS"),
    ("slots.TERRAIN_IDENTITIES", "TERRAIN_IDENTITIES"),
    ("slots.TERRAIN_ANCHORS", "TERRAIN_ANCHORS"),
    ("slots.TERRAIN_FORBIDDEN", "TERRAIN_FORBIDDEN"),
    ("slots.TERRAIN_PALETTE_ANCHORS", "TERRAIN_PALETTE_ANCHORS"),
    ("slots.TERRAIN_IDENTITY_CLAUSE", "TERRAIN_IDENTITY_CLAUSE"),
    ("slots.TERRAIN_MATERIAL_SLOTS", "TERRAIN_MATERIAL_SLOTS"),
    ("slots.TERRAIN_COLOR_FORBIDDEN", "TERRAIN_COLOR_FORBIDDEN"),
    ("slots.TERRAIN_EXTRA_CONSTRAINTS", "TERRAIN_EXTRA_CONSTRAINTS"),
    ("slots.TERRAIN_BASE_CONSTRAINT", "TERRAIN_BASE_CONSTRAINT"),
    ("slots.FEATURE_SPECS", "FEATURE_SPECS"),
    ("slots.FEATURE_FORBIDDEN", "FEATURE_FORBIDDEN"),
    ("slots.FEATURE_KIND_FORBIDDEN", "FEATURE_KIND_FORBIDDEN"),
    ("slots.UNIT_SPECS", "UNIT_SPECS"),
    ("slots._MASS_NOUNS", "_MASS_NOUNS"),
    ("slots._IRREGULAR_PLURALS", "_IRREGULAR_PLURALS"),
    ("templates.terrain.prompt", "TERRAIN_PROMPT"),
    ("templates.terrain.subject", "TERRAIN_SUBJECT_TEMPLATE"),
    ("templates.terrain.details", "TERRAIN_DETAILS_TEMPLATE"),
    ("templates.feature.prompt", "FEATURE_PROMPT"),
    ("templates.feature.subject", "FEATURE_SUBJECT_TEMPLATE"),
    ("templates.feature.details", "FEATURE_DETAILS_TEMPLATE"),
    ("templates.feature.artDirection", "FEATURE_ART_DIRECTION"),
    ("templates.unit.prompt", "UNIT_PROMPT"),
    ("templates.unit.details", "UNIT_DETAILS_TEMPLATE"),
    ("templates.unit.artDirection", "UNIT_ART_DIRECTION"),
    ("templates.unit.reliableLight", "_UNIT_RELIABLE_LIGHT"),
    ("templates.unit.reliableRender", "_UNIT_RELIABLE_RENDER"),
    ("templates.clauses.themeAccent", "THEME_ACCENT_CLAUSE"),
    ("templates.clauses.styleKeys", "STYLE_KEYS"),
    ("templates.clauses.styleDescriptions", "STYLE_DESCRIPTIONS"),
    ("negatives.terrain", "NEGATIVE_TERRAIN"),
    ("negatives.feature", "NEGATIVE_FEATURE"),
    ("negatives.unit", "NEGATIVE_UNIT"),
    ("negatives.unitExtra", "UNIT_NEGATIVE_EXTRA"),
]


def _dig(data: Any, path: str) -> Any:
    cur = data
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            raise SpecError(f"specs: missing key {path!r} (at {part!r})")
        cur = cur[part]
    return cur


def _slot_names(specs: Any) -> set[str]:
    if not isinstance(specs, list):
        return set()
    return {str(s.get("name")) for s in specs if isinstance(s, dict)}


def _format_placeholders(text: str) -> set[str]:
    """Every ``{name}`` a str.format() call on this template would need."""
    return {field for _, field, _, _ in string.Formatter().parse(text) if field}


def _hash_slots(text: str) -> set[str]:
    """Every ``#SLOT#`` the template expects the resolver to fill in."""
    return set(re.findall(r"#([A-Z][A-Z0-9_]*)#", text))


def validate_specs(raw: dict[str, Any]) -> list[str]:
    """Contract check for the four spec files. Returns every problem found."""
    errors: list[str] = []
    for name in SPEC_FILES:
        version = raw.get(name, {}).get("version")
        if version != SPEC_VERSION:
            errors.append(f"{name}.json: version {version!r} != {SPEC_VERSION}")

    slots = raw.get("slots", {})
    templates = raw.get("templates", {})
    assets = raw.get("assets", {})

    global_slots = _slot_names(slots.get("GLOBAL_SLOT_SPECS"))
    global_fallbacks = set(slots.get("GLOBAL_FALLBACKS") or {})
    terrain_fallbacks: set[str] = set()
    for values in (slots.get("TERRAIN_FALLBACKS") or {}).values():
        terrain_fallbacks |= set(values or {})

    known_by_category = {
        "terrain": global_slots | _slot_names(slots.get("TERRAIN_SLOT_SPECS"))
        | global_fallbacks | terrain_fallbacks,
        "feature": global_slots | _slot_names(slots.get("FEATURE_SLOT_SPECS"))
        | global_fallbacks,
        "unit": global_slots | _slot_names(slots.get("FEATURE_SLOT_SPECS"))
        | global_fallbacks,
    }
    format_kwargs = {"subject", "theme", "details", "style", "presentation",
                     "art_direction"}
    for category in ("terrain", "feature", "unit"):
        tmpl = templates.get(category) or {}
        for field in ("prompt", "subject", "details"):
            text = tmpl.get(field)
            if not isinstance(text, str):
                continue
            for name_ in sorted(_format_placeholders(text) - format_kwargs):
                errors.append(f"templates.{category}.{field}: unknown "
                              f"placeholder {{{name_}}}")
            for name_ in sorted(_hash_slots(text) - known_by_category[category]):
                errors.append(f"templates.{category}.{field}: unknown slot "
                              f"#{name_}#")

    feature_specs = set(slots.get("FEATURE_SPECS") or {})
    unit_specs = set(slots.get("UNIT_SPECS") or {})
    stem_specs = (assets.get("features") or {}).get("stemSpecs") or {}
    for stem, info in stem_specs.items():
        spec_key = info.get("spec") if isinstance(info, dict) else info
        if spec_key not in feature_specs:
            errors.append(f"assets.features.stemSpecs.{stem}: unknown spec "
                          f"{spec_key!r}")
    outputs: dict[str, str] = {}
    output_names = (assets.get("features") or {}).get("outputNames") or {}
    for stem in (assets.get("features") or {}).get("order") or []:
        out = output_names.get(stem, stem)
        if out in outputs and outputs[out] != stem:
            errors.append(f"duplicate output name {out!r}: "
                          f"{outputs[out]} and {stem}")
        outputs[out] = stem
    for stem in (assets.get("units") or {}).get("stems") or []:
        if stem not in unit_specs:
            errors.append(f"assets.units.stems: {stem} has no UNIT_SPECS entry")
    clauses = templates.get("clauses") or {}
    descriptions = clauses.get("styleDescriptions") or {}
    for key in clauses.get("styleKeys") or []:
        if key not in descriptions:
            errors.append(f"templates.clauses.styleKeys: {key!r} has no "
                          f"description")
    return errors


def load_specs(directory: Path | str | None = None) -> dict[str, Any]:
    """Read, validate and bind specs/*.json. Raises SpecError on a breach."""
    base = Path(directory) if directory else SPECS_DIR
    raw: dict[str, Any] = {}
    for name in SPEC_FILES:
        path = base / f"{name}.json"
        if not path.exists():
            raise SpecError(f"missing spec file: {path}")
        try:
            raw[name] = json.loads(path.read_text())
        except json.JSONDecodeError as exc:
            raise SpecError(f"{path}: invalid JSON: {exc}") from exc
    errors = validate_specs(raw)
    if errors:
        raise SpecError("specs invalid:\n  - " + "\n  - ".join(errors))
    scope = globals()
    for path_, name_ in _BINDINGS:
        scope[name_] = _dig(raw, path_)
    return raw


# Bind the shipped specs at import time, so `import abstract_generator` is
# enough to use the engine; a different --specs directory re-binds through
# load_specs() again.
load_specs()



# ==========================================================================
# prompt engine (moved verbatim from generate_variated_tile_sets.py)
# ==========================================================================

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

# FEATURE_KIND bans for group subjects: a singular head noun ('coniferous
# tree cluster') or a wrapper word ('mix of tall trees') reads broken inside
# 'a group of #FEATURE_KIND#' / 'a range of #FEATURE_KIND#'.
_GROUP_KIND_BANS = ["cluster", "clump", "group", "wall", "bunch", "mix",
                    "mixture", "blend", "assortment", "range", "band", "row",
                    "line", "hedge"]

def select_feature_stems(wanted: set[str] | None) -> list[str]:
    """Resolve ``--features`` to feature-only stems (never game units).

    A filter entry matches a stem exactly or by variant base. The historic
    ``--features units`` spelling remains accepted as a compatibility alias,
    but new callers should use the dedicated ``--units`` option.
    """
    feature_stems = list(FEATURE_STEM_ORDER)
    if not wanted:
        return feature_stems
    if "all" in wanted:
        return feature_stems
    return [stem for stem in feature_stems
            if stem in wanted or re.sub(r"_\d+$", "", stem) in wanted]

def select_unit_stems(wanted: set[str] | None) -> list[str]:
    """Resolve ``--units`` values to canonical ``unit_<key>`` stems.

    Accept either the canonical stem (``unit_phalanx``) or its game key
    (``phalanx``). An empty filter means all units when the unit category is
    selected explicitly.
    """
    unit_stems = list(UNIT_STEM_ORDER)
    if not wanted or "all" in wanted:
        return unit_stems
    normalized = {value.removeprefix("unit_") for value in wanted}
    return [stem for stem in unit_stems if stem in wanted or stem[5:] in normalized]

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
    if not LLM_ENABLED:
        raise RuntimeError("llama disabled (--no-llm)")
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
    fixed: dict[str, str] | None = None,
    label: str = "",
) -> dict[str, str]:
    """Resolve every slot of one prompt with the local model.

    One call for the whole bundle; slots that come back unusable are re-asked
    one by one; whatever is still missing falls back to a default phrase.

    ``anchors`` maps a slot name to the words that must appear in its value.
    ``forbidden`` is either a list of words that must not appear in any value
    or a mapping of slot name to its own word list.
    ``fixed`` pins slot values from the request (``overrides``): those slots
    are never asked for, never re-asked and never re-rolled - a pinned phrase
    is the one thing of a request that must survive every run.
    """
    values: dict[str, str] = {}
    if not specs:
        return values
    anchors = anchors or {}
    known = {spec["name"] for spec in specs}
    pinned = {name: str(value) for name, value in (fixed or {}).items()
              if str(value).strip()}
    unknown = sorted(set(pinned) - known)
    if unknown:
        raise SpecError(
            f"{label or 'overrides'}: not a slot of this prompt: "
            + ", ".join(unknown))
    values.update(pinned)
    ask_specs = [spec for spec in specs if spec["name"] not in pinned]

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
        for name in (s["name"] for s in ask_specs)
        for word in slot_forbidden(name)
    })

    raw = ""
    if ask_specs:
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
            + _slot_lines(ask_specs, help_overrides)
        )

        try:
            raw = run_llama_prompt(instruction, max_tokens=420)
        except Exception as exc:
            print(f"    [!] slot resolution for {label} failed: {exc}")

    data = extract_json_object(raw) or {}
    if not data:
        data = extract_key_values(raw, [s["name"] for s in ask_specs])

    for spec in ask_specs:
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
    for spec in ask_specs:
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
    for spec in ask_specs:
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
    out = re.sub(r"\.\s+and\b", " and", out)       # "…tones. and light" -> "…tones and light"
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
                          style_desc: str = "",
                          variant_note: str = "",
                          fixed: dict[str, str] | None = None
                          ) -> tuple[str, dict[str, str]]:
    """Resolve the terrain slots and assemble the full terrain prompt.

    A prompt that is already in the registry is re-rolled, so no two tiles of
    a run ever share the same description.  ``variant_note`` pins one of the
    TERRAIN_VARIANTS siblings of the same terrain: same palette, same light,
    a different arrangement of the same ground pattern, so the three tiles can
    sit next to each other on the board.
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
                "The result is a flat 2D ground texture seen from directly "
                "above - no depth, no height, no cliffs, no camera view. "
                "Terrain identity and its natural base colors dominate. Use "
                "broad, low-frequency patterns and sparse details. The theme "
                "may affect only tiny secondary accents; lighting stays "
                "neutral and even."
            ),
            anchors={
                "SURFACE_FORM": TERRAIN_ANCHORS.get(terrain, []),
                "COLOR_PALETTE": TERRAIN_PALETTE_ANCHORS.get(terrain, []),
            },
            forbidden=forbidden,
            fixed=fixed,
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
        if variant_note:
            details = f"{details} {variant_note}"

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
                         style_context: str = "",
                         unit_style_desc: str = "",
                         fixed: dict[str, str] | None = None
                         ) -> tuple[str, dict[str, str]]:
    """Resolve the feature slots and assemble the full feature prompt.

    A prompt that is already in the registry is re-rolled, so no two sprites
    of a run ever share the same description.
    """
    spec = UNIT_SPECS.get(spec_key) or FEATURE_SPECS[spec_key]
    fallbacks = dict(spec["fallbacks"])
    fallbacks.update({k: v for k, v in global_values.items()})
    # slots pinned by the request keep the exact text the sender wrote
    pinned = set(fixed or {})

    subject_template = spec.get("subject_template", FEATURE_SUBJECT_TEMPLATE)
    group_subject = "of #FEATURE_KIND#" in subject_template
    fixed_clauses = [spec["fixed"]] if spec.get("fixed") else []
    # the caller (the stem loop) can pin per-iteration clauses, e.g. the
    # rolled mountain atmosphere or the rolled dramatic mountain variant
    fixed_clauses.extend(extra_clauses)
    fixed_text = " ".join(fixed_clauses)
    style_text = (f" Rendered completely in the selected art style: "
                  f"{style_desc}.") if style_desc else ""
    is_unit = bool(spec.get("unit"))
    if is_unit:
        # The unit art direction is its own lever: --unit-style-keyword wins,
        # then the global --style-keyword, then the default serious drawn set.
        chosen = unit_style_desc or style_desc
        if chosen:
            # The unit style is stated once in the dedicated art-direction
            # slot below; repeating the long custom phrase confuses FLUX.2.
            style_text = ""
            art_direction = (
                f"{chosen}. Keep every unit in this set consistent in "
                "line weight, shading, proportions and detail density"
            )
        else:
            art_direction = UNIT_ART_DIRECTION
        unit_context = (
            "This is one member of a cohesive set of illustrated strategy-game "
            "units. Keep the specified historical or mechanical identity exact; "
            "use a concise, literal description of the defining silhouette and "
            "materials. Render it as a hand-drawn unit illustration rather than "
            "an environmental scene. Keep any run theme to restrained "
            "color or small decoration; do not transform the unit into a different "
            "kind of subject."
        )
    else:
        art_direction = (
            f"Selected art style: {style_desc}"
            if style_desc else FEATURE_ART_DIRECTION
        )
        if style_desc:
            style_text = ""
        unit_context = ""

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
                ("The unit is one complete, composed game-unit icon shown "
                 "from a three-quarter isometric view; a formation, crew or "
                 "support vehicle may contain several parts but must read as "
                 "one unit silhouette"
                 if is_unit else
                 "The feature is a single object shown from a three-quarter "
                 "isometric game view")
                + (f". {unit_context}" if unit_context else "")
                + (f". {context_extra}" if context_extra and not is_unit else "")
                + (f" {style_context}." if style_context else "")
            ),
            anchors=spec.get("anchors") and {"FEATURE_KIND": spec["anchors"]},
            forbidden=FEATURE_FORBIDDEN.get(spec_key),
            help_overrides=help_overrides,
            fixed=fixed,
            label=f"{'unit' if is_unit else 'feature'} '{stem}'",
        )

        values = dict(GLOBAL_FALLBACKS)
        values.update(global_values)
        values.update(fallbacks)
        values.update(local)
        if values.get("FEATURE_KIND") and "FEATURE_KIND" not in pinned:
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
        if values.get("FEATURE_RENDERING") and "FEATURE_RENDERING" not in pinned:
            values["FEATURE_RENDERING"] = _end_sentence(
                _capitalise(values["FEATURE_RENDERING"].rstrip(".")))
            if (unit_style_desc or style_desc) and is_unit:
                values["FEATURE_RENDERING"] = (
                    "Matching the selected shared unit-set art direction")
            elif style_desc:
                values["FEATURE_RENDERING"] = (
                    "Rendered consistently in the selected art style")
            elif is_unit:
                values["FEATURE_RENDERING"] = (
                    "Matching the shared serious inked unit-set illustration style")

        subject = fill_template(subject_template, values)
        details_template = UNIT_DETAILS_TEMPLATE if is_unit else FEATURE_DETAILS_TEMPLATE
        details = fill_template(details_template, values)
        if fixed_text:
            details = f"{details} {fixed_text}"

        prompt_template = UNIT_PROMPT if is_unit else FEATURE_PROMPT
        prompt = _fix_articles(prompt_template.format(
            subject=subject, theme=theme, details=details,
            presentation=presentation, style=style_text,
            art_direction=art_direction))
        if registry.is_new_prompt(prompt):
            break
        print(f"    [~] {'unit' if is_unit else 'feature'} '{stem}': "
              "prompt repeated, re-rolling")
    registry.remember_prompt(prompt)
    return prompt, values


# ===========================================================================
# llama-server lifecycle
# ===========================================================================

_LLAMA_PROC: Any = None
_LLAMA_RESTART_AT = 0.0


def restart_llama() -> bool:
    """Bring an unresponsive llama-server back (at most once a minute)."""
    global _LLAMA_PROC, _LLAMA_RESTART_AT
    health = f"http://127.0.0.1:{LLAMA_PORT}/health"
    if http_ok(health):
        return True
    now = time.time()
    if now - _LLAMA_RESTART_AT < 60:
        return False
    _LLAMA_RESTART_AT = now
    if _LLAMA_PROC:
        stop_process(_LLAMA_PROC)
        _LLAMA_PROC = None
    time.sleep(2)
    if not http_ok(health):
        # a process stuck in uninterruptible I/O ignores terminate() - hard
        # kill it by its command line, then start a fresh one
        subprocess.run(["pkill", "-9", "-f",
                        f"{LLAMA_SERVER_BIN}.*--port {LLAMA_PORT}"],
                       capture_output=True)
        time.sleep(2)
    if http_ok(health):
        return True
    return ensure_llama()


def ensure_llama() -> bool:
    """Start llama-server when it is not answering, and wire the restart
    hook run_llama_prompt uses when a slot resolver goes silent."""
    global LLAMA_RESTART_HOOK
    health = f"http://127.0.0.1:{LLAMA_PORT}/health"
    if http_ok(health):
        LLAMA_RESTART_HOOK = restart_llama
        return True
    if not LLAMA_SERVER_BIN.exists():
        print(f"[-] llama-server not found at {LLAMA_SERVER_BIN}")
        return False
    print("[*] Starting llama-server (Qwen3-4B)...")
    cmd = [str(LLAMA_SERVER_BIN), "-m", str(QWEN_MODEL),
           "--port", str(LLAMA_PORT), "--host", "127.0.0.1", "-c", "4096"]
    _LLAMA_PROC, _ = start_process(cmd, LLAMA_LOG)
    if not wait_for(health, timeout=300):
        print(f"[-] llama-server did not start. See {LLAMA_LOG}")
        return False
    LLAMA_RESTART_HOOK = restart_llama
    return True


def shutdown_llama() -> None:
    global _LLAMA_PROC
    if _LLAMA_PROC:
        stop_process(_LLAMA_PROC)
        _LLAMA_PROC = None


# ===========================================================================
# planning: request -> bundle
# ===========================================================================

def resolve_iteration_globals(theme_keyword: str, style_desc: str,
                              registry: VariationRegistry,
                              style_name: str = "",
                              fixed: dict[str, str] | None = None
                              ) -> tuple[dict[str, str], str]:
    """Resolve the iteration-wide slots (theme, palette, lighting).

    Returns ``(global_values, theme)``; the caller writes theme.txt and
    keywords_global.json itself.  ``fixed`` pins global slots from the
    request (``overrides.global``): a pinned theme is never re-asked for
    being too similar to an earlier one and never gets the direction keyword
    appended to it.
    """
    pinned = set(fixed or {})
    global_context = (
        "These values are shared by every tile and sprite of one asset set, "
        "so they must work for all terrains at once. Describe mood, colour "
        "and light only - never a place, a story, an event, a battle or an object"
    )
    if theme_keyword:
        global_context += (
            f". The run direction keyword is '{theme_keyword}': the theme "
            "phrase may name it, but the shared palette must contain only one "
            "or two restrained accent colors and lighting must remain neutral, "
            "even daylight. Do not alter natural terrain/material colors or "
            "subject identity"
        )
    else:
        global_context += (
            ". Pick one or two restrained natural accent colors and clear "
            "neutral daylight; do not make the set dark or dramatic"
        )
    global_values = resolve_slot_bundle(
        GLOBAL_SLOT_SPECS, GLOBAL_FALLBACKS, registry,
        theme="",
        context=global_context,
        forbidden=GLOBAL_THEME_FORBIDDEN,
        fixed=fixed,
        label="iteration globals",
    )
    theme = global_values.get("THEME_PHRASE") or GLOBAL_FALLBACKS["THEME_PHRASE"]
    theme = _strip_article(theme).rstrip(".")
    if registry.themes and "THEME_PHRASE" not in pinned:
        theme = resolve_theme(registry, {"THEME_PHRASE": theme})
    if (theme_keyword and "THEME_PHRASE" not in pinned
            and theme_keyword.lower() not in theme.lower()):
        theme = f"{theme}, {theme_keyword} shown only in sparse small accents"
    registry.remember_theme(theme)
    global_values["THEME_PHRASE"] = theme
    if style_desc and "STYLE_PHRASE" not in pinned:
        global_values["STYLE_PHRASE"] = f"{style_name}: {style_desc}"
    return global_values, theme


def plan_stems(feature_stems: list[str], unit_stems: list[str],
               feature_wanted: Iterable[str] = (),
               ) -> tuple[list[str], dict[str, Any], dict[str, str], str]:
    """Per-iteration roster + rolls.

    Returns ``(active, rolls, atmosphere_by_stem, crazy)``: the optional
    stems that survived their probability roll, the manifest ``rolls``
    block, the rolled atmosphere per mountain stem and the rolled dramatic
    extra of the second mountain variant.
    """
    wanted = set(feature_wanted)
    rolls: dict[str, Any] = {}
    active: list[str] = []
    for stem in feature_stems:
        chance = FEATURE_OPTIONAL_STEMS.get(stem)
        if chance is not None:
            if stem not in wanted and random.random() >= chance:
                rolls[stem] = "skipped (optional roll)"
                continue
        active.append(stem)
    atmosphere_by_stem: dict[str, str] = {}
    for stem in active:
        if stem.startswith("mountains_feature"):
            atmo = roll_weighted(MOUNTAIN_ATMOSPHERE) or ""
            atmosphere_by_stem[stem] = atmo
            rolls[f"{stem}_atmosphere"] = atmo or "clear face"
    crazy = random.choice(MOUNTAIN_CRAZY) if MOUNTAIN_CRAZY else ""
    if "mountains_feature_2" in active:
        rolls["mountains_feature_2_crazy"] = crazy
    active.extend(unit_stems)
    return active, rolls, atmosphere_by_stem, crazy


def resolve_stem(stem: str, atmosphere_by_stem: dict[str, str] | None = None,
                 crazy: str = "") -> dict[str, Any]:
    """Spec, twist and presentation for one feature or unit stem."""
    atmosphere_by_stem = atmosphere_by_stem or {}
    if stem in UNIT_SPECS:
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
    extra: list[str] = []
    if stem in atmosphere_by_stem:
        if atmosphere_by_stem[stem]:
            extra.append(atmosphere_by_stem[stem])
        if stem == "mountains_feature_2" and crazy:
            extra.append(crazy)
    return {
        "spec": spec_key, "twist": twist, "presentation": presentation,
        "isUnit": is_unit, "unitKey": stem[5:] if is_unit else "",
        "extra": extra,
    }


def asset_output_name(kind: str, stem: str) -> str:
    """The file name the game expects, without extension."""
    if kind == "terrain":
        return f"terrain_{stem}"
    if kind == "unit":
        return stem if stem.startswith("unit_") else f"unit_{stem}"
    return FEATURE_OUTPUT_NAMES.get(stem, stem)


def asset_negative(kind: str, stem: str) -> str:
    """The negative prompt one asset kind is rendered with."""
    if kind == "terrain":
        return NEGATIVE_TERRAIN
    if kind == "unit":
        extra = UNIT_NEGATIVE_EXTRA.get(stem)
        return NEGATIVE_UNIT + (f", {extra}" if extra else "")
    return NEGATIVE_FEATURE


def validate_request(request: dict[str, Any] | None) -> dict[str, Any]:
    """Check and default a request document. Raises SpecError on a breach."""
    req: dict[str, Any] = dict(request or {})
    version = req.get("version", SPEC_VERSION)
    if version != SPEC_VERSION:
        raise SpecError(f"request.version {version!r} != {SPEC_VERSION}")
    unknown = set(req) - {
        "version", "label", "seed", "iterations", "categories",
        "selection", "theme", "style", "unitStyle", "overrides", "noLlm",
    }
    if unknown:
        raise SpecError("request: unknown key(s): "
                        + ", ".join(sorted(map(str, unknown))))
    for key in ("label", "theme", "style", "unitStyle"):
        if key in req and req[key] is not None and not isinstance(req[key], str):
            raise SpecError(f"request.{key}: expected a string")
    for key in ("seed", "iterations"):
        if key in req and (isinstance(req[key], bool)
                           or not isinstance(req[key], int)):
            raise SpecError(f"request.{key}: expected a whole number, "
                            f"got {req[key]!r}")
    if "noLlm" in req and not isinstance(req["noLlm"], bool):
        raise SpecError(f"request.noLlm: expected true or false, "
                        f"got {req['noLlm']!r}")
    categories = req.get("categories") or ["terrain", "features", "units"]
    if not isinstance(categories, list):
        raise SpecError("request.categories: expected an array of "
                        "'terrain', 'features' and/or 'units'")
    bad = [c for c in categories if c not in ("terrain", "features", "units")]
    if bad:
        raise SpecError(f"request.categories: unknown {', '.join(map(str, bad))}")
    req["categories"] = categories

    raw_selection = req.get("selection") or {}
    if not isinstance(raw_selection, dict):
        raise SpecError("request.selection: expected an object with "
                        "'terrains', 'features' and/or 'units'")
    selection = dict(raw_selection)
    unknown_selection = set(selection) - {"terrains", "features", "units"}
    if unknown_selection:
        raise SpecError("request.selection: unknown key(s): "
                        + ", ".join(sorted(map(str, unknown_selection))))
    for list_key in ("terrains", "features", "units"):
        value = selection.get(list_key)
        if value is None:
            continue
        if not isinstance(value, list):
            raise SpecError(f"request.selection.{list_key}: expected an "
                            f"array of names, got {value!r}")
        if not all(isinstance(item, str) for item in value):
            raise SpecError(f"request.selection.{list_key}: every entry must "
                            "be a string")
    terrains = list(selection.get("terrains") or [])
    bad_terrains = [t for t in terrains if t not in TERRAINS]
    if bad_terrains:
        raise SpecError("request.selection.terrains: unknown "
                        + ", ".join(bad_terrains))
    known_features = set(FEATURE_STEM_ORDER) | {
        re.sub(r"_\d+$", "", s) for s in FEATURE_STEM_ORDER}
    for stem in selection.get("features") or []:
        if stem not in known_features and stem != "all":
            raise SpecError(f"request.selection.features: unknown {stem!r}")
    known_units = set(UNIT_STEM_ORDER) | {
        s[5:] for s in UNIT_STEM_ORDER}
    for stem in selection.get("units") or []:
        if stem not in known_units and stem != "all":
            raise SpecError(f"request.selection.units: unknown {stem!r}")

    raw_over = req.get("overrides") or {}
    if not isinstance(raw_over, dict):
        raise SpecError("request.overrides: expected an object with "
                        "'global' and/or 'slots'")
    overrides = dict(raw_over)
    unknown_over = set(overrides) - {"global", "slots"}
    if unknown_over:
        raise SpecError("request.overrides: unknown key(s): "
                        + ", ".join(sorted(unknown_over)))
    global_slots = _slot_names(GLOBAL_SLOT_SPECS)
    global_over = overrides.get("global") or {}
    if not isinstance(global_over, dict):
        raise SpecError("request.overrides.global: expected an object of "
                        "slot -> value")
    for key, value in global_over.items():
        if key not in global_slots:
            raise SpecError(f"request.overrides.global: {key!r} is not a "
                            f"global slot (known: {', '.join(sorted(global_slots))})")
        if not str(value).strip():
            raise SpecError(f"request.overrides.global.{key}: empty value")

    terrain_slots = _slot_names(TERRAIN_SLOT_SPECS)
    feature_slots = _slot_names(FEATURE_SLOT_SPECS)
    raw_slots = overrides.get("slots") or {}
    if not isinstance(raw_slots, dict):
        raise SpecError("request.overrides.slots: expected an object of "
                        "asset id -> {slot: value}")
    slots_over = dict(raw_slots)
    known_units = set(UNIT_STEM_ORDER)
    bare_units = {stem[5:] for stem in UNIT_STEM_ORDER}
    normalised_slots: dict[str, Any] = {}
    for asset_id, values in slots_over.items():
        # accept the game key ('warrior') as well as the stem ('unit_warrior')
        key = asset_id
        if (key not in TERRAINS and key not in FEATURE_STEM_ORDER
                and key not in known_units and key in bare_units):
            key = f"unit_{key}"
        if key in TERRAINS:
            allowed, where = terrain_slots, f"terrain '{key}'"
        elif key in FEATURE_STEM_ORDER or key in known_units:
            allowed, where = feature_slots, f"asset '{key}'"
        else:
            raise SpecError(
                "request.overrides.slots: unknown asset "
                f"{asset_id!r} - use a terrain, a feature stem or a unit "
                "stem such as 'unit_warrior'")
        if not isinstance(values, dict):
            raise SpecError(f"request.overrides.slots.{key}: expected "
                            f"an object of slot -> value")
        for slot_name, value in values.items():
            if slot_name not in allowed:
                raise SpecError(
                    f"request.overrides.slots.{key}: {slot_name!r} is not a "
                    f"slot of {where} (iteration-wide slots such as "
                    "THEME_PHRASE belong in overrides.global)")
            if not str(value).strip():
                raise SpecError(
                    f"request.overrides.slots.{key}.{slot_name}: empty value")
        normalised_slots[key] = values
    if normalised_slots:
        req["overrides"] = dict(overrides, slots=normalised_slots)
    req.setdefault("label", "classic")
    req.setdefault("seed", -1)
    req.setdefault("iterations", 1)
    req.setdefault("noLlm", False)
    return req


def roster(req: dict[str, Any]) -> tuple[list[str], list[str], list[str], set[str]]:
    """The terrains, feature stems and unit stems one request selects.

    Returns ``(terrains, feature_stems, unit_stems, feature_wanted)``.
    ``categories`` gates which of the three are planned at all; inside a
    selected category an absent or empty ``selection`` means *everything*,
    which is what the renderer's CLI does too.
    """
    categories = req["categories"]
    selection = req.get("selection") or {}
    terrains = (list(selection.get("terrains") or TERRAINS)
                if "terrain" in categories else [])
    feature_wanted = {str(s).lower() for s in (selection.get("features") or [])}
    unit_wanted = {str(s).lower() for s in (selection.get("units") or [])}
    feature_stems = (select_feature_stems(feature_wanted)
                     if "features" in categories else [])
    unit_stems = (select_unit_stems(unit_wanted)
                  if "units" in categories else [])
    return terrains, feature_stems, unit_stems, feature_wanted


def describe_request(req: dict[str, Any]) -> None:
    """Print what one request would generate - the whole job of ``--check``."""
    terrains, features, units, _ = roster(req)
    selection = req.get("selection") or {}

    def counted(label: str, stems: list[str], wanted: Any) -> None:
        if not stems:
            print(f"    {label:<12} none (category not selected)")
            return
        note = f" (selected: {', '.join(wanted)})" if wanted else " (all)"
        shown = ", ".join(stems[:6])
        if len(stems) > 6:
            shown += f", … ({len(stems)} total)"
        print(f"    {label:<12} {len(stems)}{note}: {shown}")

    print(f"[+] request OK - version {req['version']}, "
          f"label {req['label']!r}, {req['iterations']} iteration(s), "
          f"seed {req['seed']}")
    print(f"    categories  {', '.join(req['categories'])}")
    print(f"    direction   theme {req.get('theme') or '-'!r}  "
          f"style {req.get('style') or '-'!r}  "
          f"unit style {req.get('unitStyle') or '-'!r}")
    counted("terrains", terrains, selection.get("terrains"))
    counted("features", features, selection.get("features"))
    counted("units", units, selection.get("units"))
    overrides = req.get("overrides") or {}
    if overrides.get("global"):
        print("    pinned global: "
              + ", ".join(sorted(overrides["global"])))
    for asset_id, values in sorted((overrides.get("slots") or {}).items()):
        print(f"    pinned {asset_id}: " + ", ".join(sorted(values)))
    print("    (nothing was planned: no model was called. Plan it with "
          "--request <file> --out <bundle>)")


def generate(request: dict[str, Any] | None = None, *,
             specs_dir: Path | str | None = None) -> dict[str, Any]:
    """Plan an asset set: resolve the global slots and every selected asset.

    Pure apart from the optional Qwen calls. Returns the prompt bundle.
    """
    load_specs(specs_dir)
    req = validate_request(request)
    global LLM_ENABLED
    LLM_ENABLED = not req["noLlm"]
    if LLM_ENABLED and not ensure_llama():
        raise SpecError("llama-server is not available (drop it from the "
                        "request or pass noLlm)")

    seed = int(req["seed"])
    if seed >= 0:
        random.seed(seed)

    theme_keyword = str(req.get("theme") or "").strip()
    style_name, style_desc, style_context = "", "", ""
    if str(req.get("style") or "").strip():
        style_name, style_desc = resolve_style(req["style"])
        style_context = style_clauses(style_name, style_desc)
    unit_style_name, unit_style_desc = "", ""
    if str(req.get("unitStyle") or "").strip():
        unit_style_name, unit_style_desc = resolve_style(req["unitStyle"])

    terrains, feature_stems, unit_stems, feature_wanted = roster(req)
    overrides = req.get("overrides") or {}
    global_over: dict[str, str] = dict(overrides.get("global") or {})
    slots_over: dict[str, Any] = dict(overrides.get("slots") or {})

    registry = VariationRegistry()
    bundle: dict[str, Any] = {
        "version": SPEC_VERSION,
        "label": req["label"],
        "seed": seed,
        "iterations": req["iterations"],
        "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "style": style_name or "",
        "unitStyle": unit_style_name or "",
        "theme": theme_keyword or "",
        "global": {},
        "runs": [],
        "assets": [],
    }
    assets: list[dict[str, Any]] = []

    for i in range(1, int(req["iterations"]) + 1):
        global_values, theme = resolve_iteration_globals(
            theme_keyword, style_desc, registry, style_name,
            fixed=global_over)
        active, rolls, atmosphere, crazy = plan_stems(
            feature_stems, unit_stems, feature_wanted)
        iteration: dict[str, Any] = {
            "iteration": i, "theme": theme, "global": global_values,
            "rolls": rolls,
        }

        for terrain in terrains:
            variants = []
            for variant in range(1, TERRAIN_VARIANTS + 1):
                variant_note = TERRAIN_VARIANT_NOTES[
                    (variant - 1) % len(TERRAIN_VARIANT_NOTES)]
                prompt, keywords = build_terrain_prompt(
                    terrain, theme, global_values, registry,
                    style_desc=style_desc, variant_note=variant_note,
                    fixed=slots_over.get(terrain),
                )
                variants.append({
                    "variant": variant,
                    "suffix": "" if variant == 1 else f"_{variant - 1}",
                    "prompt": prompt, "keywords": keywords,
                })
            assets.append({
                "kind": "terrain", "id": terrain, "spec": terrain,
                "output": asset_output_name("terrain", terrain),
                "negative": asset_negative("terrain", terrain),
                "iteration": i, "variants": variants,
            })

        for stem in active:
            info = resolve_stem(stem, atmosphere, crazy)
            kind = "unit" if info["isUnit"] else "feature"
            variant_count = UNIT_VARIANTS if info["isUnit"] else 1
            variants = []
            for variant in range(1, variant_count + 1):
                prompt, keywords = build_feature_prompt(
                    stem, info["spec"], info["twist"], theme, global_values,
                    registry, extra_clauses=tuple(info["extra"]),
                    presentation=info["presentation"],
                    context_extra=THEME_ACCENT_CLAUSE,
                    style_desc=style_desc, style_context=style_context,
                    unit_style_desc=unit_style_desc,
                    fixed=slots_over.get(stem),
                )
                variants.append({
                    "variant": variant,
                    "suffix": "" if variant == 1 else f"_{variant}",
                    "prompt": prompt, "keywords": keywords,
                })
            if kind == "unit":
                svg = UNIT_SVG_FILES.get(info["unitKey"])
                source = {"kind": "svg", "file": svg} if svg else {"kind": "text"}
            elif stem in FEATURE_TEXT_ONLY_STEMS:
                source = {"kind": "text"}
            else:
                source = {"kind": "input-png", "glob": stem}
            assets.append({
                "kind": kind, "id": stem, "spec": info["spec"],
                "output": asset_output_name(kind, stem),
                "negative": asset_negative(kind, stem),
                "source": source,
                "iteration": i, "variants": variants,
            })

        iteration["assets"] = [
            {"kind": a["kind"], "id": a["id"]} for a in assets
            if a["iteration"] == i
        ]
        bundle["runs"].append(iteration)

    bundle["assets"] = assets
    bundle["global"] = (bundle["runs"][0]["global"] if bundle["runs"] else {})
    bundle["rolls"] = (bundle["runs"][0].get("rolls", {}) if bundle["runs"] else {})
    return bundle


def _stable(bundle: dict[str, Any]) -> dict[str, Any]:
    """The bundle minus the fields that change on every run (timestamps).

    Used by --selftest/--write-golden so the golden file only changes when a
    spec file changes.
    """
    data = json.loads(json.dumps(bundle))
    data.pop("generatedAt", None)
    return data


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="abstract_generator - plan image prompts from specs/*.json "
                    "(JSON in, prompt bundle out; renders nothing).",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--specs", default=str(SPECS_DIR),
                        help="directory holding assets/slots/templates/negatives .json")
    parser.add_argument("--request", default=None,
                        help="request JSON file, or - for stdin")
    parser.add_argument("--out", default="-",
                        help="bundle JSON file, or - for stdout")
    parser.add_argument("--no-llm", action="store_true",
                        help="never call Qwen; use the built-in fallback phrases")
    parser.add_argument("--check", action="store_true",
                        help="validate --request against the specs and print "
                             "what it would generate (no LLM, no bundle)")
    parser.add_argument("--write-golden", action="store_true",
                        help="write specs/golden/bundle_no_llm.json from --selftest")
    parser.add_argument("--selftest", action="store_true",
                        help="regenerate the fixed golden request and compare")
    return parser


# The fixed request --selftest compares against. Every field is pinned so the
# golden bundle only changes when a spec file changes.
GOLDEN_REQUEST: dict[str, Any] = {
    "version": SPEC_VERSION,
    "label": "golden",
    "seed": 1234,
    "iterations": 1,
    "categories": ["terrain", "features", "units"],
    "selection": {
        "terrains": ["forest", "ocean"],
        "features": ["fish1", "mountains_feature_2"],
        "units": ["warrior", "phalanx"],
    },
    "noLlm": True,
}
GOLDEN_PATH = SPECS_DIR / "golden" / "bundle_no_llm.json"


def _read_request(path: str) -> dict[str, Any]:
    text = sys.stdin.read() if path == "-" else Path(path).read_text()
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise SpecError(f"request: invalid JSON: {exc}") from exc


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        load_specs(args.specs)
        if args.check:
            request = _read_request(args.request) if args.request else {}
            if not args.request:
                print("[~] no --request given: checking the defaults "
                      "(everything selected)")
            if args.no_llm:
                request["noLlm"] = True
            describe_request(validate_request(request))
            return 0
        if args.selftest or args.write_golden:
            global LLM_ENABLED
            LLM_ENABLED = False
            # the planner's chatter is noise on a gate: capture it
            import io
            buffer = io.StringIO()
            with contextlib.redirect_stdout(buffer):
                first = generate(GOLDEN_REQUEST, specs_dir=args.specs)
                second = generate(GOLDEN_REQUEST, specs_dir=args.specs)
            if _stable(first) != _stable(second):
                print("[-] selftest: two runs of the same request differ "
                      "(the planner is not deterministic)")
                print(buffer.getvalue()[-2000:])
                return 2
            blob = json.dumps(_stable(first), indent=2, sort_keys=True,
                              ensure_ascii=False) + "\n"
            if args.write_golden:
                GOLDEN_PATH.parent.mkdir(parents=True, exist_ok=True)
                GOLDEN_PATH.write_text(blob)
                print(f"[*] golden written: {GOLDEN_PATH}")
                return 0
            if not GOLDEN_PATH.exists():
                print(f"[-] selftest: missing {GOLDEN_PATH} "
                      "(run with --write-golden once)")
                return 2
            if GOLDEN_PATH.read_text() != blob:
                print("[-] selftest: prompt bundle differs from the golden file")
                print(f"    regenerate with: {Path(__file__).name} --write-golden")
                return 2
            print("[+] selftest: specs valid, planner deterministic, "
                  "golden bundle matches")
            return 0

        request: dict[str, Any] = {}
        if args.request:
            request = _read_request(args.request)
        if args.no_llm:
            request["noLlm"] = True
        if args.out == "-":
            # the engine prints progress on stdout; keep the bundle the only
            # thing there, so a caller can pipe it straight into JSON.parse
            with contextlib.redirect_stdout(sys.stderr):
                bundle = generate(request, specs_dir=args.specs)
        else:
            bundle = generate(request, specs_dir=args.specs)
        blob = json.dumps(bundle, indent=2, sort_keys=True,
                          ensure_ascii=False) + "\n"
        if args.out == "-":
            sys.stdout.write(blob)
        else:
            Path(args.out).write_text(blob)
            print(f"[*] bundle written: {args.out} "
                  f"({len(bundle['assets'])} assets)")
        return 0
    except SpecError as exc:
        print(f"[-] {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
