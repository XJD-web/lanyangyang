# -*- coding: utf-8 -*-
"""
修复图标在 Windows 快捷方式显示空白的问题。
根因：原 icon.ico 所有尺寸都用 PNG 编码，而 Explorer 对 16/32/48 只认 BMP/DIB。
做法：以现有 ico 的 256 尺寸（含 alpha）为源，重生成一版 —— 小尺寸强制 BMP。
"""
from PIL import Image
from pathlib import Path

BUILD = Path(__file__).resolve().parent.parent / "build"
ICO = BUILD / "icon.ico"

# 打开现有 ico，取最大帧（256，带透明通道）作为源
src = Image.open(ICO).convert("RGBA")
print("源图尺寸:", src.size)

# 若最大帧不是 256，放大到 256 保证质量
if max(src.size) < 256:
    src = src.resize((256, 256), Image.LANCZOS)

sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]

# Pillow 的 ICO 写入器支持 bitmap_format 参数：
#   'bmp' -> 所有尺寸写成 BMP/DIB（Explorer 全兼容；256 会稍大但没问题）
#   'png' -> 所有尺寸写成 PNG（就是原来的坑）
src.save(ICO, format="ICO", sizes=sizes, bitmap_format="bmp")
print("已重生成:", ICO, ICO.stat().st_size, "bytes")
