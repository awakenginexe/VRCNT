@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build_backend.ps1 -Variant cpu -OutputPath src-tauri\bin %*
exit /b %ERRORLEVEL%
