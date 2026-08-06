#!/usr/bin/env python3
"""Encode review-master card art into the optimized assets the app ships.

The normalized PNGs stay the lossless editorial masters; this stage produces
the JPEG the iOS bundle actually carries. Shipping 78 lossless PNGs costs
about 201 MiB, which exceeds Apple's cellular-download threshold on its own
(spec section 12: "Full deck increases app size/memory -> optimized shipping
assets, bounded decode sizes, bundle-size gate").

Encoding is deterministic and checksummed in both directions: the master's
sha256 is verified before encoding and recorded next to the shipping asset's
own sha256, so a drifted master can never be shipped unnoticed.
"""

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
        "Shipping encode requires Pillow. Install it with `python -m pip install pillow`."
    ) from error


TOOLS_DIRECTORY = Path(__file__).resolve().parent
REPOSITORY_ROOT = TOOLS_DIRECTORY.parent.parent
MANIFEST_PATH = TOOLS_DIRECTORY / "manifest.json"
SHIPPING_DIRECTORY = TOOLS_DIRECTORY / "shipping"

ENCODING_VERSION = "jpeg-q88-progressive-v1"
QUALITY = 88
# 4:2:0 chroma. 4:4:4 costs about 20% more bytes for no visible gain on this
# palette at the sizes a card is actually presented.
SUBSAMPLING = 2


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Encode the shipping card-art assets from normalized masters."
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-encode even when the recorded master checksum is unchanged.",
    )
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def encode_card(card: dict, force: bool) -> tuple[dict, bool]:
    key = card["key"]
    normalization = card.get("normalization")
    if not normalization:
        raise ValueError(f"{key} has no normalized master to encode.")

    master_path = REPOSITORY_ROOT / normalization["outputPath"]
    master_checksum = sha256(master_path)
    if master_checksum != normalization["sha256"]:
        raise ValueError(f"{key} normalized master checksum changed; re-run normalization.")

    existing = card.get("shipping")
    output_path = SHIPPING_DIRECTORY / f"{key}.jpg"
    if (
        not force
        and existing
        and existing.get("encodingVersion") == ENCODING_VERSION
        and existing.get("masterSha256") == master_checksum
        and output_path.exists()
        and sha256(output_path) == existing.get("sha256")
    ):
        return existing, False

    SHIPPING_DIRECTORY.mkdir(parents=True, exist_ok=True)
    with Image.open(master_path) as master:
        image = master.convert("RGB")
        temporary_path = output_path.with_suffix(".jpg.tmp")
        image.save(
            temporary_path,
            format="JPEG",
            quality=QUALITY,
            optimize=True,
            progressive=True,
            subsampling=SUBSAMPLING,
        )
    os.replace(temporary_path, output_path)

    shipping = {
        "encodingVersion": ENCODING_VERSION,
        "format": "JPEG",
        "quality": QUALITY,
        "progressive": True,
        "chromaSubsampling": "4:2:0",
        "path": output_path.relative_to(REPOSITORY_ROOT).as_posix(),
        "width": normalization["width"],
        "height": normalization["height"],
        "bytes": output_path.stat().st_size,
        "sha256": sha256(output_path),
        "masterSha256": master_checksum,
    }
    card["shipping"] = shipping
    card["bundledPath"] = shipping["path"]
    return shipping, True


def main() -> int:
    args = parse_args()
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))

    encoded = 0
    total_bytes = 0
    for index, card in enumerate(manifest["cards"], start=1):
        shipping, changed = encode_card(card, args.force)
        card["shipping"] = shipping
        card["bundledPath"] = shipping["path"]
        encoded += int(changed)
        total_bytes += shipping["bytes"]
        print(
            f"[{index:02d}/{len(manifest['cards']):02d}] {card['key']}: "
            f"{shipping['bytes'] / 1024:.0f} KiB {'encoded' if changed else 'unchanged'}"
        )

    manifest["shippingEncodingVersion"] = ENCODING_VERSION
    MANIFEST_PATH.write_text(
        f"{json.dumps(manifest, indent=2, ensure_ascii=False)}\n", encoding="utf-8"
    )
    print(
        f"Shipping payload: {total_bytes / 1_048_576:.1f} MiB across "
        f"{len(manifest['cards'])} cards ({encoded} re-encoded)."
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError) as error:
        raise SystemExit(str(error)) from error
