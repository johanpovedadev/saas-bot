param(
    [string]$BusinessKey = '',
    [switch]$All,
    [switch]$Perform
)

$basePath = Resolve-Path -Path "$PSScriptRoot\..\bot-wasap\auth"
if (-not $basePath) {
    Write-Error "No se encuentra el directorio base: bot-wasap\auth"
    exit 1
}

if ($All) {
    $targets = Get-ChildItem -Path $basePath -Directory
} elseif ($BusinessKey) {
    $targets = @(Get-Item -Path (Join-Path $basePath $BusinessKey) -ErrorAction SilentlyContinue)
    if (-not $targets) {
        Write-Error "No existe el directorio de sesion para el negocio: $BusinessKey"
        exit 1
    }
} else {
    Write-Error "Especifica -BusinessKey (ej: mascotas) o -All para limpiar todas las sesiones"
    exit 1
}

foreach ($t in $targets) {
    $sessionDir = Join-Path $t.FullName 'session'
    if (-not (Test-Path $sessionDir)) { Write-Warning "Saltando $($t.Name): no tiene directorio session/"; continue }

    Write-Output "`n========== $($t.Name) =========="
    Write-Output "Directorio: $sessionDir"

    $backupDir = Join-Path $basePath ("$($t.Name)_backup_" + (Get-Date -Format "yyyyMMdd_HHmmss"))
    Write-Output "Backup: $backupDir"

    # Backup full session
    try {
        New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
        Copy-Item -Path (Join-Path $sessionDir '*') -Destination $backupDir -Recurse -Force
        Write-Output "✅ Backup creado."
    } catch {
        Write-Error "Error creando backup: $_"
        continue
    }

    if (-not $Perform) {
        Write-Output "Modo PREVIEW: no se eliminara nada. Usa -Perform para limpiar."
        Write-Output "Para restaurar: Remove-Item -Recurse $sessionDir; Copy-Item -Recurse $backupDir $sessionDir"
        continue
    }

    try {
        # Stop bot first via PM2
        $pm2 = "C:\Program Files\nodejs\node.exe C:\Users\Administrador\AppData\Roaming\npm\node_modules\pm2\bin\pm2"
        $botName = "bot-$($t.Name)"
        & cmd /c "$pm2 stop $botName 2>nul"

        # Wait for Chrome to release locks
        Start-Sleep -Seconds 3

        # Kill any Chrome process using this session
        Get-CimInstance Win32_Process -Filter "name='chrome.exe'" | Where-Object { $_.CommandLine -match [regex]::Escape($sessionDir) } | ForEach-Object {
            Stop-Process -Id $_.ProcessId -Force
            Write-Output "   Chrome PID $($_.ProcessId) terminado."
        }
        Start-Sleep -Seconds 2

        # Remove session directory
        Remove-Item -LiteralPath $sessionDir -Recurse -Force -ErrorAction Stop
        Write-Output "✅ Sesion eliminada: $sessionDir"
    } catch {
        Write-Error "Error durante limpieza: $_"
    }
}

Write-Output "`nProceso completado."
Write-Output "Para reiniciar el bot: pm2 start bot-<businessKey>"
