# Launch Fruispect with the repository virtual environment.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$fruispectPython = Join-Path $PSScriptRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $fruispectPython)) {
    throw 'Create .venv and install requirements first; see README.md.'
}
& $fruispectPython main.py
