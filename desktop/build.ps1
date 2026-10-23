# Crea l'eseguibile portatile dell'app desktop.
#
#   powershell -ExecutionPolicy Bypass -File desktop\build.ps1
#
# Richiede Node.js (per copiare i moduli condivisi), Python 3.14 con
# pywebview, pythonnet, Pillow e PyInstaller.

$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

Write-Host '1/4  Copia dei moduli condivisi nella cartella desktop...' -ForegroundColor Cyan
node scripts/sync-desktop.mjs

Write-Host "2/4  Creazione dell'icona..." -ForegroundColor Cyan
python desktop/make_icon.py

Write-Host "3/4  Compilazione dell'eseguibile con PyInstaller..." -ForegroundColor Cyan
python -m PyInstaller --noconfirm --clean desktop/CartinaDiClasse.spec

Write-Host '4/4  Aggiornamento della versione HTML e della cartella docs...' -ForegroundColor Cyan
node scripts/build.mjs

Write-Host ''
Write-Host 'Pronto: dist\CartinaDiClasse.exe e docs\CartinaDiClasse.exe' -ForegroundColor Green
Write-Host 'La cartella files viene creata accanto al file .exe al primo avvio.'
