#!/usr/bin/env python3
"""Generate seamless terrain tiles in the classic illustration styles.

A focused tile-set generator for the ten hand-picked illustration styles:

  1. Line Art            - clean black outlines, little or no shading, simple
                           and graphic (icons, editorial, coloring books).
  2. Flat Vector Illustration - solid colours, minimal shading, geometric
                           shapes, crisp edges (UI, infographics, corporate).
  3. Isometric Illustration - 3D-like scenes at a fixed angle, no perspective
                           distortion (tech diagrams, maps, onboarding).
  4. Watercolor Illustration - soft washes, translucent layering, visible
                           paper texture, organic edges (hand-painted).
  5. Ink Wash / Sumi-e   - monochrome brush-and-ink, varied line weight and
                           bleeding washes (East Asian ink painting).
  6. Pixel Art           - visible square pixels, retro game / limited-colour
                           digital graphics.
  7. Low Poly            - flat polygonal facets, stylized game-like look.
  8. Comic Book / Graphic Novel Style - bold outlines, dramatic shading,
                           halftone dots or hatching, dynamic compositions.
  9. Art Nouveau         - flowing organic lines, floral motifs, decorative
                           borders, elegant figures.
 10. Paper Cut / Collage Illustration - layered paper shapes, torn edges,
                           mixed textures, assembled compositions.

Every style runs through the very same abstract prompt engine of the general
varied tile generator (``generate_variated_tile_sets.py``): the ``#KEYWORD#``
slot templates, the identity guards, the fallbacks, the prompt registry.  Only
the art direction - the "Style & Art Direction" line - is swapped for the
selected illustration style, so the subject identities (terrain, surface,
material) stay intact while the technique, linework and medium change completely.

Usage:
  python3 tools/tile-generator/generate_illustration_styles.py --style line_art

  python3 tools/tile-generator/generate_illustration_styles.py \
      --style watercolor --iterations 1 --terrains forest,ocean

  python3 tools/tile-generator/generate_illustration_styles.py --style all \
      --iterations 2

  python3 tools/tile-generator/generate_illustration_styles.py \
      --style "flat vector" --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import shutil
import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import generate_variated_tile_sets as gen

# ===========================================================================
# THE TEN ILLUSTRATION STYLES
# ===========================================================================

ILLUSTRATION_STYLES: dict[str, dict[str, Any]] = {
    "line_art": {
        "name": "Line Art",
        "descriptor": (
            "clean black ink line art: confident even ink outlines, minimal "
            "shading or no shading at all, flat graphic shapes, crisp high "
            "contrast, simple graphic illustration"
        ),
        "blurb": "Clean black outlines with little or no shading; simple, "
                 "graphic, editorial and coloring-book friendly.",
    },
    "flat_vector": {
        "name": "Flat Vector Illustration",
        "descriptor": (
            "flat vector illustration: solid colours, minimal shading, "
            "geometric shapes, crisp hard edges, no gradients and no texture, "
            "clean flat graphic design"
        ),
        "blurb": "Solid colours, minimal shading, geometric shapes and crisp "
                 "edges; common in UI design, infographics and corporate visuals.",
    },
    "isometric": {
        "name": "Isometric Illustration",
        "descriptor": (
            "isometric illustration: pseudo-3D scenes drawn at a fixed "
            "isometric angle with no perspective distortion, soft facet "
            "shading on the geometric shapes"
        ),
        "blurb": "3D-like scenes drawn at a fixed angle with no perspective "
                 "distortion; popular for tech diagrams, maps and onboarding "
                 "screens.",
    },
    "watercolor": {
        "name": "Watercolor Illustration",
        "descriptor": (
            "watercolour illustration: soft translucent washes, layered "
            "washes, visible paper texture, organic bleeding edges, loose "
            "hand-painted feel"
        ),
        "blurb": "Soft washes, translucent layering, visible paper texture and "
                 "organic edges; feels hand-painted and expressive.",
    },
    "ink_wash": {
        "name": "Ink Wash / Sumi-e",
        "descriptor": (
            "ink wash / sumi-e: monochrome black brush-and-ink work, varied "
            "expressive line weight, bleeding ink washes, East Asian ink "
            "painting atmosphere"
        ),
        "blurb": "Monochrome brush-and-ink with varied line weight and "
                 "bleeding washes; inspired by East Asian ink painting.",
    },
    "pixel_art": {
        "name": "Pixel Art",
        "descriptor": (
            "pixel art: visible square pixels, retro limited colour palette, "
            "hard square edges, dithered shading, chunky readable retro game "
            "graphics"
        ),
        "blurb": "Images built from visible square pixels; retro video game "
                 "and limited-colour digital graphics feel.",
    },
    "low_poly": {
        "name": "Low Poly",
        "descriptor": (
            "low poly: flat polygonal facets, faceted geometric shading, "
            "stylised game-like look"
        ),
        "blurb": "Flat polygonal facets giving a stylized, geometric, "
                 "game-like look.",
    },
    "comic_book": {
        "name": "Comic Book / Graphic Novel Style",
        "descriptor": (
            "comic book / graphic novel style: bold black outlines, dramatic "
            "shading, halftone dots or hatching, dynamic composition"
        ),
        "blurb": "Bold outlines, dramatic shading, halftone dots or hatching "
                 "and dynamic compositions; from superhero to indie comic "
                 "aesthetics.",
    },
    "art_nouveau": {
        "name": "Art Nouveau",
        "descriptor": (
            "Art Nouveau: flowing organic lines, floral motifs, decorative "
            "borders and elegant figures"
        ),
        "blurb": "Flowing organic lines, floral motifs, decorative borders and "
                 "elegant figures; inspired by late 19th-century poster design.",
    },
    "paper_cut": {
        "name": "Paper Cut / Collage Illustration",
        "descriptor": (
            "paper cut / collage illustration: layered paper shapes, torn "
            "edges, mixed paper textures, assembled compositions"
        ),
        "blurb": "Layered paper shapes, torn edges, mixed textures and assembled "
                 "compositions; handcrafted or digitally simulated.",
    },
}

ILLUSTRATION_ORDER = list(ILLUSTRATION_STYLES)


def resolve_style_input(text: str) -> dict[str, Any]:
    """Resolve one style request to ``{"key", "name", "descriptor", "freeform"}``."""
    key = re.sub(r"[^a-z0-9]+", "_", text.strip().lower()).strip("_") or "freeform"
    style = ILLUSTRATION_STYLES.get(key)
    if style is None:
        return {
            "key": key,
            "name": text.strip(),
            "descriptor": text.strip(),
            "freeform": True,
        }
    return {
        "key": key,
        "name": style["name"],
        "descriptor": style["descriptor"],
        "freeform": False,
    }


def resolve_style_requests(raw_style: str | None) -> list[dict[str, Any]]:
    """Turn a raw CLI style string into a de-duplicated list of style dicts."""
    text = (raw_style or "all").strip()
    if text.lower() == "all":
        keys: list[str] = list(ILLUSTRATION_ORDER)
    else:
        keys = [p.strip() for p in text.split(",") if p.strip()]
    styles: list[dict[str, Any]] = []
    for key in keys:
        style = resolve_style_input(key)
        if style not in styles:
            styles.append(style)
    return styles


# ===========================================================================
# CLI
# ===========================================================================

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Generate seamless terrain tiles in one of the classic "
            "illustration styles (line art, flat vector, isometric, "
            "watercolor, ink wash, pixel art, low poly, comic book, art "
            "nouveau, paper cut)."
        ),
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--iterations", type=int,
                        default=int(os.environ.get("ITERATIONS", "1")),
                        help="number of tile sets to generate per style")
    parser.add_argument("--output-root",
                        default=os.environ.get("OUTPUT_ROOT", str(gen.TILE_GEN / "tile_sets")),
                        help="base output directory")
    parser.add_argument("--steps", type=int, default=int(os.environ.get("STEPS", "4")),
                        help="sampling steps")
    parser.add_argument("--cfg", type=float, default=float(os.environ.get("CFG", "1.0")),
                        help="classifier-free guidance scale")
    parser.add_argument("--size", type=int, default=int(os.environ.get("SIZE", "512")),
                        help="terrain tile size in pixels")
    parser.add_argument("--seed", type=int, default=int(os.environ.get("SEED", "-1")),
                        help="base seed for reproducible runs (-1 = random)")
    parser.add_argument("--retries", type=int,
                        default=int(os.environ.get("RETRIES", "3")),
                        help="render attempts per image before the fallback is used")
    parser.add_argument("--bg-level", type=int, default=int(os.environ.get("BG_LEVEL", str(gen.BG_LEVEL))),
                        help="background removal level: the black point 0-255, higher "
                             "removes more (default: %(default)s)")
    parser.add_argument("--bg-softness", type=int,
                        default=int(os.environ.get("BG_SOFTNESS", str(gen.BG_SOFTNESS))),
                        help="background removal edge softness 0-255: the width of "
                             "the anti-aliasing ramp 0-255 (default: %(default)s)")
    parser.add_argument("--terrains", default=os.environ.get("TERRAINS", ""),
                        help="comma separated list of terrains (default: all)")
    parser.add_argument("--style", default=None,
                        help=(
                            "art style for this whole run: one of the "
                            "illustration keys (line_art, flat_vector, "
                            "isometric, watercolor, ink_wash, pixel_art, "
                            "low_poly, comic_book, art_nouveau, paper_cut), a "
                            "comma separated list, 'all' for all ten, or any "
                            "freeform style phrase (e.g. 'flat vector')"
                        ))
    parser.add_argument("--dry-run", action="store_true",
                        help="only resolve the prompts with the local model, render nothing")
    parser.add_argument("--keep-servers", action="store_true",
                        help="do not stop servers that this run started")
    parser.add_argument("--write-batch",
                        default=os.environ.get("WRITE_BATCH", ""),
                        help="writes a bash script that runs one illustration-style "
                             "tile-set job after another (one per style key) and exits "
                             "- start it in the background and check the logs later")
    parser.add_argument("--sd-server", default=str(gen.SD_SERVER_BIN))
    parser.add_argument("--diffusion", default=str(gen.SD_DIFFUSION))
    parser.add_argument("--vae", default=str(gen.SD_VAE))
    parser.add_argument("--llm", default=str(gen.SD_LLM))
    parser.add_argument("--llama-server", default=str(gen.LLAMA_SERVER_BIN))
    parser.add_argument("--qwen-model", default=str(gen.QWEN_MODEL))
    return parser


# ===========================================================================
# batch script writer
# ===========================================================================

def write_style_batch(styles: list[str], iterations: int, terrains: str) -> Path:
    """Write a bash script that runs one illustration-style tile-set job after
    another (one job per style key).  Start it in the background and check the
    logs later."""
    jobs: list[tuple[str, list[str]]] = []
    used: set[str] = set()
    for key in styles:
        label = re.sub(r"[^a-z0-9]+", "_", key.strip().lower()).strip("_") or "run"
        base = label
        n = 2
        while label in used:
            label = f"{base}_{n}"
            n += 1
        used.add(label)
        cmd = [
            "python3", "tools/tile-generator/generate_illustration_styles.py",
            "--style", key,
            "--iterations", str(iterations),
        ]
        if terrains.strip():
            cmd += ["--terrains", terrains.strip()]
        jobs.append((label, cmd))

    script = gen.TILE_GEN / f"run_batch_{int(time.time())}.sh"
    n = 2
    while script.exists():
        script = gen.TILE_GEN / f"run_batch_{int(time.time())}_{n}.sh"
        n += 1
    lines = [
        "#!/usr/bin/env bash",
        "# Auto-generated by tools/tile-generator/generate_illustration_styles.py.",
        "# Runs one illustration-style tile-set job after another, each with its",
        "# own log under tools/tile-generator/run_logs/.",
        "# Start it in the background:",
        f"#   nohup bash {script.name} > batch.out 2>&1 &",
        "set -u",
        f'cd "{gen.ROOT}"',
        "",
        "fail=0",
        "",
        "run_job() {",
        '  local label="$1"; shift',
        '  local log="tools/tile-generator/run_logs/$label.log"',
        '  echo "=== job: $label ($(date -Is)) ==="',
        '  if python3 -u tools/tile-generator/generate_illustration_styles.py "$@" '
        ">>$log 2>&1; then",
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
        lines.append(f"run_job {shlex.quote(label)} {quoted}".rstrip())
    lines += [
        "",
        'echo "=== batch done ($(date -Is)): $fail job(s) failed ==="',
        'echo "logs: tools/tile-generator/run_logs"',
        'exit "$fail"',
        "",
    ]
    script.write_text("\n".join(lines))
    script.chmod(0o755)
    return script


# ===========================================================================
# main
# ===========================================================================

def main() -> int:
    args = build_parser().parse_args()

    # ---- resolve the requested style(s) ------------------------------------
    styles: list[dict[str, Any]] = resolve_style_requests(args.style)
    if not styles:
        print("[-] no art style requested")
        return 2

    if args.write_batch:
        script = write_style_batch(
            [s["key"] for s in styles],
            args.iterations,
            args.terrains,
        )
        print(f"[*] style batch script written: {script}")
        print('    start it in the background with:')
        print(f'    nohup bash "{script.name}" > "batch.out" 2>&1 &')
        return 0

    terrains = [t.strip() for t in args.terrains.split(",") if t.strip()] or list(gen.TERRAINS)
    unknown = [t for t in terrains if t not in gen.TERRAINS]
    if unknown:
        print(f"[-] unknown terrain(s): {', '.join(unknown)}")
        return 2

    output_root = Path(args.output_root)
    output_root.mkdir(parents=True, exist_ok=True)

    servers = gen.ServerManager(args)
    started = time.time()
    try:
        if not args.dry_run:
            if not servers.start_sd():
                return 1
            if not servers.start_llama():
                servers.shutdown()
                return 1

        def render(prompt: str, out_path: Path, width: int, height: int,
                   seed: int | None = None) -> bool:
            """Render one tile, restarting the sd-server when it dies."""
            for attempt in range(1, args.retries + 1):
                try:
                    data = gen.txt2img(prompt, gen.NEGATIVE_TERRAIN, args.steps,
                                       args.cfg, width, height, seed)
                    out_path.write_bytes(data)
                    return True
                except Exception as exc:
                    print(f"    x {out_path.name} attempt {attempt}: {exc}")
                    if not args.dry_run:
                        servers.restart_sd()
                    time.sleep(2)
            return False

        for style in styles:
            style_key = style["key"]
            print(f"\n########## art style {style_key}: {style['name']} "
                  f"({'freeform' if style['freeform'] else 'illustration'}) ##########")
            registry = gen.VariationRegistry()
            gen.LLAMA_RESTART_HOOK = servers.restart_llama
            for i in range(1, args.iterations + 1):
                run_dir = output_root / f"{style_key}_{int(time.time())}_{i:02d}"
                iter_dir = run_dir / f"iteration_{i:02d}"
                tiles_dir = iter_dir / "tiles"
                tiles_dir.mkdir(parents=True, exist_ok=True)
                print(f"\n=== style {style_key} - iteration {i}/{args.iterations} "
                      f"-> {run_dir} ===")
                iter_started = time.time()
                iter_manifest: dict[str, Any] = {
                    "iteration": i,
                    "style": style_key,
                    "style_name": style["name"],
                    "freeform": style["freeform"],
                    "descriptor": style["descriptor"],
                    "tiles": {},
                }

                # ---- 1. iteration-wide global slots --------------------------
                global_context = (
                    "These values are shared by every tile of one asset set, so "
                    "they must work for all terrains at once. Describe mood, "
                    "colour and light only - never a place, a story, an event, a "
                    "battle or an object"
                )
                global_values = gen.resolve_slot_bundle(
                    gen.GLOBAL_SLOT_SPECS, gen.GLOBAL_FALLBACKS, registry,
                    theme="",
                    context=global_context,
                    forbidden=gen.GLOBAL_THEME_FORBIDDEN,
                    label="iteration globals",
                )
                theme = global_values.get("THEME_PHRASE") or gen.GLOBAL_FALLBACKS["THEME_PHRASE"]
                theme = gen._strip_article(theme).rstrip(".")
                if registry.themes:
                    theme = gen.resolve_theme(registry, {"THEME_PHRASE": theme})
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

                # ---- 2. terrain tiles in the selected style -----------------
                for tindex, terrain in enumerate(terrains):
                    prompt, keywords = gen.build_terrain_prompt(
                        terrain, theme, global_values, registry,
                        style_desc=style["descriptor"],
                    )
                    (iter_dir / f"prompt_{terrain}.txt").write_text(
                        prompt + "\n\nNegative prompt: " + gen.NEGATIVE_TERRAIN + "\n"
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
                    seed = None if args.seed < 0 else args.seed + i * 100 + tindex
                    t0 = time.time()
                    ok = render(prompt, out_path, args.size, args.size, seed=seed)
                    if ok:
                        gen.clean_terrain_tile(out_path)
                        if not gen.tile_is_usable(out_path):
                            print(f"    ! tile {terrain}: unusable output")
                            ok = False
                    if ok:
                        print(f"    + tile {terrain} ({gen.human(time.time() - t0)})")
                        iter_manifest["tiles"][terrain]["output"] = str(
                            out_path.relative_to(output_root))
                    else:
                        fallback = gen.PUBLIC_TILES / f"terrain_{terrain}.png"
                        if not fallback.exists():
                            fallback = gen.PUBLIC_TILES / f"terrain_{terrain}_1.png"
                        if fallback.exists():
                            shutil.copy(fallback, out_path)
                            iter_manifest["tiles"][terrain]["output"] = str(
                                out_path.relative_to(output_root))
                            iter_manifest["tiles"][terrain]["fallback"] = True
                        print(f"    ! tile {terrain}: fallback to the original tile")

                iter_manifest["seconds"] = round(time.time() - iter_started, 1)
                (iter_dir / "manifest.json").write_text(
                    json.dumps(iter_manifest, indent=2) + "\n"
                )
                print(f"    -> {iter_dir}  ({gen.human(iter_manifest['seconds'])})")

    finally:
        if not args.keep_servers:
            servers.shutdown()

    print(f"\nDone in {gen.human(time.time() - started)}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
