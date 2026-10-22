#!/usr/bin/env python3
# Lanyangyang 品牌图标生成脚本
# 冷色（靛蓝->蓝）渐变圆角方底 + 极简白色羊头（呼应“懒羊羊”）
# 输出：build/icon.ico（多尺寸，含 256x256，满足 electron-builder 要求）
import math
from PIL import Image, ImageDraw

S = 1024  # 超采样分辨率，最后缩放保证边缘平滑
OUT = "build/icon.ico"
PREVIEW = "build/icon_preview.png"

# 1) 渐变圆角方底
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
px = img.load()
top = (110, 139, 255)   # #6E8BFF
bot = (61, 91, 254)     # #3D5AFE
for y in range(S):
    t = y / (S - 1)
    r = int(top[0] + (bot[0] - top[0]) * t)
    g = int(top[1] + (bot[1] - top[1]) * t)
    b = int(top[2] + (bot[2] - top[2]) * t)
    for x in range(S):
        px[x, y] = (r, g, b, 255)

mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=220, fill=255)
img.putalpha(mask)

d = ImageDraw.Draw(img)
cx, cy = 512, 522

# 2) 耳朵（先画，压在羊毛下方）
ear_col = (222, 227, 240, 255)
for sx in (-1, 1):
    ex, ey = cx + sx * 232, cy + 40
    d.ellipse([ex - 78, ey - 46, ex + 78, ey + 46], fill=ear_col)

# 3) 蓬松羊毛（一团白色圆+周围凸起，形成云朵感）
wool = (255, 255, 255, 255)
for ang in range(0, 360, 24):
    a = math.radians(ang)
    x = cx + 162 * math.cos(a)
    y = cy + 162 * math.sin(a)
    d.ellipse([x - 104, y - 104, x + 104, y + 104], fill=wool)
d.ellipse([cx - 150, cy - 150, cx + 150, cy + 150], fill=wool)

# 4) 眼睛
eye = (60, 64, 82, 255)
for sx in (-1, 1):
    ex = cx + sx * 72
    d.ellipse([ex - 28, cy - 52, ex + 28, cy - 52 + 56], fill=eye)

# 5) 微笑
d.arc([cx - 58, cy + 36, cx + 58, cy + 128], start=20, end=160,
      fill=(70, 74, 92, 255), width=13)

# 6) 缩放出各尺寸 ICO（高分辨率 LANCZOS 下采样，边缘平滑）
sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
icons = [img.resize(s, Image.LANCZOS) for s in sizes]
img.resize((512, 512), Image.LANCZOS).save(PREVIEW)
icons[0].save(OUT, sizes=sizes)
print("icon written:", OUT, "sizes:", sizes)
