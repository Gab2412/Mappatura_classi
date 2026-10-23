# -*- mode: python ; coding: utf-8 -*-
"""Specifica PyInstaller per Cartina di Classe (versione desktop).

Costruisce un singolo eseguibile portatile:

    pyinstaller --noconfirm --clean desktop/CartinaDiClasse.spec

L'eseguibile non richiede installazione: i dati delle classi vengono
salvati nella cartella ``files`` accanto al file .exe.
"""

from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules

HERE = Path(SPECPATH).resolve()
block_cipher = None

hiddenimports = [
    "webview.platforms.edgechromium",
    "webview.platforms.winforms",
    "webview.http",
    "clr_loader",
    "pythonnet",
    "clr",
]
hiddenimports += collect_submodules("clr_loader")

a = Analysis(
    [str(HERE / "app.py")],
    pathex=[str(HERE)],
    binaries=[],
    datas=[(str(HERE / "web"), "web")],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "unittest", "pydoc", "doctest"],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="CartinaDiClasse",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(HERE / "icona.ico"),
)
