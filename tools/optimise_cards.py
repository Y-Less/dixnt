"""Make web-sized copies of the generated cards for the game.

Reads ../cards/card_NNNN.png and writes cards/small/ (hand thumbnails) and cards/medium/ (table and
zoom) as JPEGs. Existing outputs are skipped, so it is safe to re-run while generation is still going.

Usage (from the game folder): ..\\.venv\\Scripts\\python.exe tools\\optimise_cards.py
"""
from pathlib import Path

from PIL import Image

game = Path(__file__).resolve().parent.parent
src = game.parent / "cards"
sizes = {"small": (320, 468), "medium": (640, 936)}

for name in sizes:
    (game / "cards" / name).mkdir(parents=True, exist_ok=True)

made = 0
for png in sorted(src.glob("card_*.png")):
    outputs = {name: game / "cards" / name / f"{png.stem}.jpg" for name in sizes}
    if all(path.exists() for path in outputs.values()):
        continue
    try:
        image = Image.open(png).convert("RGB")
        image.load()
    except Exception as error:  # a card may still be mid-write by the generator
        print("skipping", png.name, error)
        continue
    for name, size in sizes.items():
        # "medium" is written last, because the server treats its presence as "card is ready".
        image.resize(size, Image.LANCZOS).save(outputs[name], quality=86, optimize=True, progressive=True)
    made += 1
print(f"optimised {made} new cards")
