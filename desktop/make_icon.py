"""Genera l'icona dell'applicazione (desktop/icona.ico)."""

from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 256
DARK = (10, 17, 29, 255)
PANEL = (20, 32, 58, 255)
ACCENT = (255, 213, 74, 255)
DESK = (248, 250, 252, 255)
EMPTY = (111, 138, 178, 255)


def build() -> Image.Image:
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((6, 6, SIZE - 6, SIZE - 6), radius=44, fill=DARK, outline=(60, 84, 124, 255), width=6)
    draw.rounded_rectangle((24, 24, SIZE - 24, 96), radius=18, fill=PANEL)
    draw.rounded_rectangle((40, 46, 216, 74), radius=8, fill=ACCENT)

    layout = [[3, 3, 3], [3, 3, 3], [2, 3, 2]]
    top = 116
    row_h = 36
    gap = 10
    left = 30
    right = SIZE - 30
    for r, row in enumerate(layout):
        total = sum(row)
        cell_w = (right - left - gap * (len(row) - 1)) / total
        x = left
        y = top + r * (row_h + gap)
        for count in row:
            for _ in range(count):
                fill = DESK if (r + count) % 2 == 0 else EMPTY
                draw.rounded_rectangle((x, y, x + cell_w - 4, y + row_h - 6), radius=5, fill=fill)
                x += cell_w
            x += gap
    return image


def main() -> None:
    target = Path(__file__).resolve().parent / "icona.ico"
    image = build()
    image.save(
        target,
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    png = target.with_suffix(".png")
    image.save(png)
    print("Icona creata:", target)


if __name__ == "__main__":
    main()
