"""Generate StudyMate's Android launcher and splash artwork from the supplied logo."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "android/app/src/main/res"
PAPER = "#f5f8ff"
LOGO = Image.open(ROOT / "assets/brand/smart_studymate_logo_transparent.png").convert("RGBA")


def brand_art(size, background=True, circle=False, inset=.87):
    """Fit the full supplied mark and wordmark inside a safe icon area."""
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if background:
        if circle:
            d.ellipse((0, 0, size - 1, size - 1), fill=PAPER)
        else:
            d.rounded_rectangle((0, 0, size - 1, size - 1), radius=int(size * .22), fill=PAPER)
    art = LOGO.copy()
    art.thumbnail((int(size * inset), int(size * inset)), Image.Resampling.LANCZOS)
    im.alpha_composite(art, ((size - art.width) // 2, (size - art.height) // 2))
    return im


def save_icon(directory, name, size, background=True, circle=False):
    directory.mkdir(parents=True, exist_ok=True)
    brand_art(size, background, circle, .86 if background else .58).save(directory / name)


for density, legacy, foreground in (
    ("mdpi", 48, 108), ("hdpi", 72, 162), ("xhdpi", 96, 216),
    ("xxhdpi", 144, 324), ("xxxhdpi", 192, 432),
):
    folder = RES / f"mipmap-{density}"
    save_icon(folder, "ic_launcher.png", legacy)
    save_icon(folder, "ic_launcher_round.png", legacy, circle=True)
    save_icon(folder, "ic_launcher_foreground.png", foreground, background=False)

for size in (192, 512):
    save_icon(ROOT / "www/icons", f"icon-{size}.png", size)


def make_splash(width, height):
    im = Image.new("RGBA", (width, height), PAPER)
    art = LOGO.copy()
    art.thumbnail((int(width * .82), int(height * .62)), Image.Resampling.LANCZOS)
    im.alpha_composite(art, ((width - art.width) // 2, (height - art.height) // 2))
    return im


for folder in RES.glob("drawable*"):
    target = folder / "splash.png"
    if target.exists():
        with Image.open(target) as old:
            w, h = old.size
        make_splash(w, h).save(target)

