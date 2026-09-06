# -*- mode: python ; coding: utf-8 -*-

import os
import sys
from pathlib import Path

spec_root = Path(SPECPATH)
sys.path.insert(0, str(spec_root))
from backend_common import create_backend_analysis

if os.environ.get("VRCNT_BACKEND_VARIANT") != "cpu":
    raise RuntimeError("backend.spec requires VRCNT_BACKEND_VARIANT=cpu")
a = create_backend_analysis(
    Analysis, "cpu", spec_root.parent, os.environ["VRCNT_BACKEND_VENV"], ['torch']
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='VRCNT-backend-x86_64-pc-windows-msvc',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=[],
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='.',
)
