# -*- coding: utf-8 -*-
"""
用用户提供的「懒羊羊」卡通图生成 Windows 应用图标。
- 自动识别背景色并裁掉多余留白（保留角色本体）
- 生成圆角方形底 + 角色居中，输出多尺寸 ICO（16/32/48/64/128/256）
用法：python scripts/gen_icon_from_image.py <源图路径>
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

SRC = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\xjd\.workbuddy\clipboard-images\clipboard-2026-10-22T08-03-35-659Z-5d65661a.png"
OUT_DIR = Path(__file__).resolve().parent.parent / "build"
OUT_DIR.mkdir(parents=True, exist_ok=True)

CANVAS = 1024          # 主画布尺寸（4 倍超采样，缩放后边缘更干净）
RADIUS_RATIO = 0.22    # 圆角半径占边长比例
CONTENT_RATIO = 0.88   # 角色占画布比例（留出边距）

img = Image.open(SRC).convert("RGBA")
w, h = img.size

# ---- 0. 先裁掉截图可能带的外边框（深色 1~2px 描边会干扰背景判断）----
inset = max(3, int(min(w, h) * 0.012))
img = img.crop((inset, inset, w - inset, h - inset))
w, h = img.size
print("裁边后尺寸:", img.size)

# ---- 1. 背景色取「内圈边缘」的众数颜色（比四角平均更稳）----
from collections import Counter
samples = Counter()
step = max(1, min(w, h) // 120)
for x in range(0, w, step):
    for y in (0, 1, h - 2, h - 1):
        samples[img.getpixel((x, y))[:3]] += 1
for y in range(0, h, step):
    for x in (0, 1, w - 2, w - 1):
        samples[img.getpixel((x, y))[:3]] += 1
bg = samples.most_common(1)[0][0] + (255,)
print("背景色:", bg)

# ---- 2. 计算角色外接框（与背景色差异明显的像素）----
px = img.load()
minx, miny, maxx, maxy = w, h, 0, 0
TH = 26  # 颜色差异阈值
for y in range(0, h, 2):
    for x in range(0, w, 2):
        r, g, b, a = px[x, y]
        if a > 10 and (abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2])) > TH:
            if x < minx: minx = x
            if x > maxx: maxx = x
            if y < miny: miny = y
            if y > maxy: maxy = y
print("角色外接框:", (minx, miny, maxx, maxy))
pad = 6
minx, miny = max(0, minx - pad), max(0, miny - pad)
maxx, maxy = min(w, maxx + pad), min(h, maxy + pad)
body = img.crop((minx, miny, maxx + 1, maxy + 1))

# ---- 3. 圆角方形底（4 倍超采样后缩小，抗锯齿）----
big = CANVAS * 4
canvas = Image.new("RGBA", (big, big), (0, 0, 0, 0))
draw = ImageDraw.Draw(canvas)
r = int(big * RADIUS_RATIO)
draw.rounded_rectangle([0, 0, big - 1, big - 1], radius=r, fill=bg)

# ---- 4. 角色等比缩放并居中 ----
target = int(big * CONTENT_RATIO)
scale = min(target / body.width, target / body.height)
body_big = body.resize((max(1, int(body.width * scale)), max(1, int(body.height * scale))), Image.LANCZOS)
canvas.alpha_composite(body_big, ((big - body_big.width) // 2, (big - body_big.height) // 2))

# ---- 5. 生成多尺寸 ICO ----
# 注意：必须用 bitmap_format="bmp"。
# Pillow 默认可能把各尺寸存成 PNG，而 Windows Explorer 对 16/32/48 等小尺寸
# 只认 BMP/DIB 格式，PNG 会导致快捷方式/任务栏图标显示为空白。
sizes = [256, 128, 64, 48, 32, 16]
frames = [canvas.resize((s, s), Image.LANCZOS) for s in sizes]
ico_path = OUT_DIR / "icon.ico"
frames[0].save(
    ico_path,
    format="ICO",
    sizes=[(s, s) for s in sizes],
    append_images=frames[1:],
    bitmap_format="bmp",
)
print("已生成:", ico_path, ico_path.stat().st_size, "bytes")

# ---- 6. 预览图（白底，便于肉眼确认）----
preview = Image.new("RGBA", (512, 512), (255, 255, 255, 255))
preview.alpha_composite(frames[0].resize((512, 512), Image.LANCZOS))
preview_path = OUT_DIR / "icon_preview.png"
preview.convert("RGB").save(preview_path)
print("预览图:", preview_path)
