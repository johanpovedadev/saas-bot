param(
    [string]$AuthDir = "$PSScriptRoot\..\bot-wasap\auth_info_baileys",
    [switch]$Perform
)

try {
    $resolved = Resolve-Path -Path $AuthDir -ErrorAction Stop
    $authDir = $resolved.ProviderPath
} catch {
    Write-Error "No se encuentra el directorio especificado: $AuthDir"
    exit 1
}

$parent = Split-Path $authDir -Parent
$backupDir = Join-Path $parent ("auth_info_baileys_backup_" + (Get-Date -Format "yyyyMMdd_HHmmss"))

Write-Output "Auth directory: $authDir"
Write-Output "Backup directory: $backupDir"

# Create backup (full copy) - this is the safe step before any deletion
try {
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    Copy-Item -Path (Join-Path $authDir '*') -Destination $backupDir -Recurse -Force
    Write-Output "Backup created successfully."
} catch {
    Write-Error "Error creating backup: $_"
    exit 2
}

$pattern = 'app-state-sync-key-*.json'
$files = Get-ChildItem -Path $authDir -Filter $pattern -File -ErrorAction SilentlyContinue

if (-not $files -or $files.Count -eq 0) {
    Write-Output "No se encontraron archivos que coincidan con '$pattern' en $authDir. Nada que limpiar."
    Write-Output "Se mantuvo el backup en: $backupDir"
    exit 0
}

Write-Output "Archivos detectados que coinciden con '$pattern':"
$files | ForEach-Object { Write-Output " - $($_.FullName)" }

if (-not $Perform) {
    Write-Output "\nModo PREVIEW: no se eliminará nada. Para ejecutar la limpieza, vuelve a ejecutar este script con el parámetro -Perform."
    Write-Output "Ejemplo (desde la raíz del repo en PowerShell):"
    Write-Output "    .\scripts\clean_appstate.ps1 -Perform"
    Write-Output "Backup disponible en: $backupDir"
    exit 0
}

# Perform deletion
Write-Output "\nEjecutando borrado de archivos..."
foreach ($f in $files) {
    try {
        Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop
        Write-Output "Eliminado: $($f.FullName)"
    } catch {
        Write-Warning "No se pudo eliminar $($f.FullName): $_"
    }
}

Write-Output "Limpieza finalizada. Conserva el backup en: $backupDir"
Write-Output "Si necesitas restaurar, copia los archivos del backup nuevamente a: $authDir"
