"""Build the game's card images from the judged winners.

For every category, reads the judged choices (../choices/<category>*.json, each a map of scene number to
{"pick": "a" or "b", "fit": 0-2}) and the candidate images (../raw/<category>/NNNN_a.png and _b.png), then writes
  cards/small/card_<id>.jpg   hand thumbnails
  cards/medium/card_<id>.jpg  table and zoom
  cards/categories.json       the categories (with their card ids) that the lobby offers

Card ids are category number * 10000 + scene number (see ../categories.py). Re-running is safe: a card is only
re-encoded if its chosen image changed.

Usage (from the game folder):
  ..\\.venv\\Scripts\\python.exe tools\\optimise_cards.py
  ..\\.venv\\Scripts\\python.exe tools\\optimise_cards.py --unjudged a   # preview: use candidate A where nothing is judged yet
  ..\\.venv\\Scripts\\python.exe tools\\optimise_cards.py --min-fit 1    # leave out cards whose best candidate still missed the prompt
"""
import argparse
import json
import sys
from pathlib import Path

from PIL import Image

game = Path(__file__).resolve().parent.parent
dixit = game.parent
sys.path.insert(0, str(dixit))
from categories import CATEGORIES, card_id  # noqa: E402

SIZES = {"small": (320, 468), "medium": (640, 936)}

parser = argparse.ArgumentParser()
parser.add_argument("--unjudged", choices=["a", "b"], default=None, help="use this candidate for scenes with no judgement yet")
parser.add_argument("--min-fit", type=int, default=0, help="skip judged cards with a fit score below this")
parser.add_argument("--only", default=None, help="comma-separated category keys")
args = parser.parse_args()

cards_dir = game / "cards"
for size in SIZES:
    (cards_dir / size).mkdir(parents=True, exist_ok=True)
sources_path = cards_dir / "sources.json"
sources = json.loads(sources_path.read_text(encoding="utf-8")) if sources_path.exists() else {}

only = set(args.only.split(",")) if args.only else None
categories_out = []
encoded = 0

for key, _number, label, description in CATEGORIES:
    if only and key not in only:
        continue
    raw = dixit / "raw" / key
    choices = {}
    for part in sorted((dixit / "choices").glob(f"{key}*.json")):
        choices.update(json.loads(part.read_text(encoding="utf-8")))

    ids = []
    for scene in range(1, 257):
        choice = choices.get(str(scene))
        if choice is None:
            if args.unjudged is None:
                continue
            choice = {"pick": args.unjudged, "fit": 1}
        if choice.get("fit", 2) < args.min_fit:
            continue
        source = raw / f"{scene:04d}_{choice['pick']}.png"
        if not source.exists():
            continue
        cid = card_id(key, scene)
        outputs = {size: cards_dir / size / f"card_{cid}.jpg" for size in SIZES}
        tag = f"{key}/{source.name}"
        if sources.get(str(cid)) != tag or not all(path.exists() for path in outputs.values()):
            try:
                image = Image.open(source).convert("RGB")
                image.load()
            except Exception as error:  # an image may still be mid-write by the generator
                print("skipping", source.name, error)
                continue
            for size, dimensions in SIZES.items():
                # "medium" is written last: the server treats its presence as "card is ready".
                image.resize(dimensions, Image.LANCZOS).save(outputs[size], quality=86, optimize=True, progressive=True)
            sources[str(cid)] = tag
            encoded += 1
        ids.append(cid)

    if ids:
        categories_out.append({"key": key, "label": label, "description": description, "ids": ids})
        print(f"{label}: {len(ids)} cards")

(cards_dir / "categories.json").write_text(json.dumps({"categories": categories_out}, indent=1), encoding="utf-8")
sources_path.write_text(json.dumps(sources), encoding="utf-8")
print(f"encoded {encoded} new or changed cards; {sum(len(c['ids']) for c in categories_out)} cards in {len(categories_out)} categories")
