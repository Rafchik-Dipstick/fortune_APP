#!/usr/bin/env python3
"""Create deterministic, crop-reviewed 2:3 card-art bundle candidates."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

try:
    from PIL import Image
except ImportError as error:  # pragma: no cover - local dependency guidance
    raise SystemExit(
        "Card normalization requires Pillow. Install it with `python -m pip install pillow`."
    ) from error


TOOLS_DIRECTORY = Path(__file__).resolve().parent
REPOSITORY_ROOT = TOOLS_DIRECTORY.parent.parent
MANIFEST_PATH = TOOLS_DIRECTORY / "manifest.json"
PLAN_PATH = TOOLS_DIRECTORY / "crop-plan.v1.json"
PROMPT_CATALOG_PATH = TOOLS_DIRECTORY / "prompts" / "full-deck-v1.json"
NORMALIZED_DIRECTORY = TOOLS_DIRECTORY / "normalized"
SIDES = ("left", "top", "right", "bottom")
GROUP_PREFIXES = {
    "major": "major-",
    "wands": "wands-",
    "cups": "cups-",
    "swords": "swords-",
    "pentacles": "pentacles-",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Crop and normalize manifest-bound card art one canonical card at a time."
    )
    parser.add_argument(
        "--group",
        choices=("all", *GROUP_PREFIXES),
        default="all",
        help="Canonical deck group to normalize; defaults to all 78 cards.",
    )
    return parser.parse_args()


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def line_pixels(image: Image.Image, side: str, offset: int) -> bytes:
    width, height = image.size
    if side == "left":
        line = image.crop((offset, 0, offset + 1, height))
    elif side == "right":
        line = image.crop((width - 1 - offset, 0, width - offset, height))
    elif side == "top":
        line = image.crop((0, offset, width, offset + 1))
    else:
        line = image.crop((0, height - 1 - offset, width, height - offset))
    return line.tobytes()


def classified_fraction(pixel_bytes: bytes, classification: str) -> float:
    matches = 0
    pixel_count = len(pixel_bytes) // 3
    for index in range(0, len(pixel_bytes), 3):
        red, green, blue = pixel_bytes[index : index + 3]
        if classification == "light":
            is_match = min(red, green, blue) >= 235 and max(red, green, blue) - min(
                red, green, blue
            ) <= 28
        else:
            is_match = max(red, green, blue) <= 38
        matches += int(is_match)
    return matches / pixel_count


def edge_band_depths(image: Image.Image, classification: str) -> dict[str, int]:
    depths: dict[str, int] = {}
    for side in SIDES:
        depth = 0
        for offset in range(64):
            if classified_fraction(line_pixels(image, side, offset), classification) < 0.9:
                break
            depth += 1
        depths[side] = depth
    return depths


def validate_plan(plan: dict, canonical_order: list[str]) -> None:
    if plan.get("schemaVersion") != 1:
        raise ValueError("Crop plan schemaVersion must be 1.")
    if plan.get("cropOrder") != list(SIDES):
        raise ValueError("Crop plan order must remain left, top, right, bottom.")
    if list(plan.get("cards", {})) != canonical_order:
        raise ValueError("Crop plan must contain all 78 cards in canonical order.")
    if plan.get("outputWidth") * 3 != plan.get("outputHeight") * 2:
        raise ValueError("Normalized dimensions must use an exact 2:3 ratio.")

    allowed_treatments = {"NONE", "LIGHT_GUTTER", "DARK_GUTTER", "MIXED_GUTTER"}
    for key, entry in plan["cards"].items():
        crop = entry.get("crop")
        if (
            not isinstance(crop, list)
            or len(crop) != 4
            or any(not isinstance(value, int) or value < 0 for value in crop)
        ):
            raise ValueError(f"{key} needs four nonnegative integer crop margins.")
        if entry.get("edgeTreatment") not in allowed_treatments:
            raise ValueError(f"{key} has an invalid edgeTreatment.")
        retained_dark_edges = entry.get("retainedDarkEdges", [])
        if (
            not isinstance(retained_dark_edges, list)
            or len(set(retained_dark_edges)) != len(retained_dark_edges)
            or any(side not in SIDES for side in retained_dark_edges)
        ):
            raise ValueError(f"{key} has invalid retainedDarkEdges.")


def normalize_card(card: dict, plan: dict) -> dict:
    key = card["key"]
    plan_entry = plan["cards"][key]
    left, top, right, bottom = plan_entry["crop"]
    source_path = REPOSITORY_ROOT / card["sourceOutputPath"]
    expected_source_checksum = card["sha256"]
    actual_source_checksum = sha256(source_path)
    if actual_source_checksum != expected_source_checksum:
        raise ValueError(f"{key} source checksum changed before normalization.")

    with Image.open(source_path) as source:
        source = source.convert("RGB")
        width, height = source.size
        if left + right >= width or top + bottom >= height:
            raise ValueError(f"{key} crop removes the complete source canvas.")
        cropped = source.crop((left, top, width - right, height - bottom))
        normalized = cropped.resize(
            (plan["outputWidth"], plan["outputHeight"]), Image.Resampling.LANCZOS
        )

    NORMALIZED_DIRECTORY.mkdir(parents=True, exist_ok=True)
    output_path = NORMALIZED_DIRECTORY / f"{key}.png"
    temporary_path = output_path.with_suffix(".png.tmp")
    normalized.save(temporary_path, format="PNG", optimize=True, compress_level=9)
    os.replace(temporary_path, output_path)

    relative_output_path = output_path.relative_to(REPOSITORY_ROOT).as_posix()
    file_size = output_path.stat().st_size
    normalization = {
        "version": plan["normalizationVersion"],
        "sourceSha256": expected_source_checksum,
        "crop": dict(zip(SIDES, plan_entry["crop"], strict=True)),
        "edgeTreatment": plan_entry["edgeTreatment"],
        "outputPath": relative_output_path,
        "width": plan["outputWidth"],
        "height": plan["outputHeight"],
        "colorMode": "RGB",
        "bytes": file_size,
        "sha256": sha256(output_path),
        "edgeBands": {
            "light": edge_band_depths(normalized, "light"),
            "dark": edge_band_depths(normalized, "dark"),
        },
    }
    card["bundledPath"] = relative_output_path
    card["normalization"] = normalization
    return normalization


def main() -> int:
    args = parse_args()
    manifest = read_json(MANIFEST_PATH)
    plan = read_json(PLAN_PATH)
    prompt_catalog = read_json(PROMPT_CATALOG_PATH)
    canonical_order = prompt_catalog["cardOrder"]
    validate_plan(plan, canonical_order)

    cards_by_key = {card["key"]: card for card in manifest["cards"]}
    if list(cards_by_key) != canonical_order:
        raise ValueError("Manifest must contain all 78 cards in canonical order before normalization.")

    prefix = GROUP_PREFIXES.get(args.group)
    selected_keys = [
        key for key in canonical_order if prefix is None or key.startswith(prefix)
    ]
    for index, key in enumerate(selected_keys, start=1):
        normalization = normalize_card(cards_by_key[key], plan)
        crop = normalization["crop"]
        print(
            f"[{index:02d}/{len(selected_keys):02d}] {key}: "
            f"crop {crop['left']},{crop['top']},{crop['right']},{crop['bottom']} "
            f"-> {normalization['width']}x{normalization['height']}"
        )

    manifest["normalizationVersion"] = plan["normalizationVersion"]
    MANIFEST_PATH.write_text(
        f"{json.dumps(manifest, indent=2, ensure_ascii=False)}\n", encoding="utf-8"
    )
    print(f"Normalized {len(selected_keys)} {args.group} card assets sequentially.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError) as error:
        raise SystemExit(str(error)) from error
