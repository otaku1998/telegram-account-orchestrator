# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller 规格：把 TAO 网页后端打成可独立运行的 Windows exe（onedir）。

产出 dist/TAO-Backend/TAO-Backend.exe，由 Electron 桌面壳随包一起分发。
只打包网页前端需要的依赖（不含 python-telegram-bot / opentele 等机器人侧可选件）。
"""
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules, collect_data_files

ROOT = Path(SPECPATH).parent
ICON = ROOT / "packaging" / "tao.ico"

hidden = (
    collect_submodules("tam")
    + collect_submodules("uvicorn")
    + collect_submodules("anyio")
    + collect_submodules("telethon")
)

datas = [
    (str(ROOT / "tam" / "web"), "tam/web"),
    (str(ROOT / "tam" / "assets"), "tam/assets"),
    (str(ROOT / ".env.example"), "."),
    (str(ROOT / "LICENSE"), "."),
    (str(ROOT / "NOTICE.GAFBot"), "."),
] + collect_data_files("telethon") + collect_data_files("qrcode")

a = Analysis(
    [str(ROOT / "packaging" / "backend_entry.py")],
    pathex=[str(ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=hidden,
    hookspath=[],
    runtime_hooks=[],
    excludes=[
        "pytest", "setuptools", "tkinter", "unittest", "pydoc_data",
        "telegram", "opentele", "aiohttp", "requests", "cbor2",
        "PyInstaller", "PIL.ImageQt", "PIL.ImageShow",
    ],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="TAO-Backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    icon=str(ICON) if ICON.exists() else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="TAO-Backend",
)
