# アイコン生成（python3 tools/make-icons.py）。デザインを変えるときはここを編集する。
from PIL import Image, ImageDraw

BG = (111, 102, 214)
FG = (255, 255, 255)

def draw(size, pad_ratio=0.0, rounded=False):
    S = size * 4  # 高解像度で描いて縮小（なめらかにする）
    img = Image.new('RGBA', (S, S), BG + (255,) if not rounded else (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=BG)
    p = S * (0.22 + pad_ratio)
    w = S - 2 * p
    top = p + w * 0.08
    lw = max(4, int(S * 0.035))
    d.rounded_rectangle([p, top, S - p, S - p], radius=int(w * 0.14), outline=FG, width=lw)
    d.rectangle([p, top, S - p, top + w * 0.22], fill=FG)
    for x in (p + w * 0.28, p + w * 0.72):
        d.rounded_rectangle([x - lw / 2, p - w * 0.04, x + lw / 2, top + w * 0.1], radius=lw / 2, fill=FG)
    # 日付のマス（3×2）
    cell = w * 0.13
    for r in range(2):
        for c in range(3):
            cx = p + w * (0.25 + c * 0.25)
            cy = top + w * (0.42 + r * 0.24)
            fill = FG if not (r == 0 and c == 1) else (255, 214, 102)
            d.rounded_rectangle([cx - cell / 2, cy - cell / 2, cx + cell / 2, cy + cell / 2], radius=cell * 0.25, fill=fill)
    return img.resize((size, size), Image.LANCZOS)

draw(180).convert('RGB').save('icons/apple-touch-icon.png')
draw(192, rounded=True).save('icons/icon-192.png')
draw(512, rounded=True).save('icons/icon-512.png')
draw(512, pad_ratio=0.06).convert('RGB').save('icons/icon-maskable-512.png')
print('ok')
