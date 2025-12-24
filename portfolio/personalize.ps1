# Script de Personalización del Portfolio
# Reemplaza placeholders con información real

param(
    [Parameter(Mandatory=$true)]
    [string]$NombreCompleto,
    
    [Parameter(Mandatory=$true)]
    [string]$Email,
    
    [Parameter(Mandatory=$false)]
    [string]$LinkedIn = "",
    
    [Parameter(Mandatory=$false)]
    [string]$GitHub = "",
    
    [Parameter(Mandatory=$false)]
    [string]$WhatsApp = ""
)

Write-Host "🚀 Personalizando Portfolio..." -ForegroundColor Cyan
Write-Host ""

# Archivos a procesar
$archivos = @(
    "README.md",
    "EXECUTIVE_SUMMARY.md",
    "LICENSE"
)

$replacements = @{
    "Mundo Helados Development Team" = $NombreCompleto
    "\[Actualizar con tu email\]" = $Email
}

# Agregar LinkedIn si se proporcionó
if ($LinkedIn) {
    $replacements["\[Actualizar con tu perfil\].*LinkedIn"] = $LinkedIn
}

# Agregar GitHub si se proporcionó
if ($GitHub) {
    $replacements["\[Actualizar con tu perfil\].*GitHub"] = $GitHub
}

# Agregar WhatsApp si se proporcionó
if ($WhatsApp) {
    $replacements["\[Opcional - Actualizar\]"] = $WhatsApp
}

# Procesar cada archivo
foreach ($archivo in $archivos) {
    $rutaCompleta = Join-Path $PSScriptRoot $archivo
    
    if (Test-Path $rutaCompleta) {
        Write-Host "📝 Procesando: $archivo" -ForegroundColor Yellow
        
        $contenido = Get-Content $rutaCompleta -Raw
        $cambios = 0
        
        foreach ($buscar in $replacements.Keys) {
            $reemplazar = $replacements[$buscar]
            $matches = [regex]::Matches($contenido, $buscar)
            
            if ($matches.Count -gt 0) {
                $contenido = $contenido -replace $buscar, $reemplazar
                $cambios += $matches.Count
                Write-Host "   ✅ Reemplazados $($matches.Count) ocurrencias de '$buscar'" -ForegroundColor Green
            }
        }
        
        if ($cambios -gt 0) {
            Set-Content -Path $rutaCompleta -Value $contenido -NoNewline
            Write-Host "   💾 Guardado con $cambios cambios" -ForegroundColor Green
        } else {
            Write-Host "   ⚠️  No se encontraron placeholders" -ForegroundColor DarkYellow
        }
        
        Write-Host ""
    } else {
        Write-Host "⚠️  Archivo no encontrado: $archivo" -ForegroundColor Red
    }
}

Write-Host "✨ ¡Personalización completada!" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Resumen:" -ForegroundColor Cyan
Write-Host "   Nombre: $NombreCompleto"
Write-Host "   Email: $Email"
if ($LinkedIn) { Write-Host "   LinkedIn: $LinkedIn" }
if ($GitHub) { Write-Host "   GitHub: $GitHub" }
if ($WhatsApp) { Write-Host "   WhatsApp: $WhatsApp" }
Write-Host ""
Write-Host "🎯 Siguiente paso:" -ForegroundColor Yellow
Write-Host "   1. Revisa los cambios: git diff"
Write-Host "   2. Agrega screenshots a docs/screenshots/"
Write-Host "   3. Ejecuta: git add . && git commit -m '✨ Portfolio personalizado'"
Write-Host ""

# Ejemplo de uso en comentarios
<#
.SYNOPSIS
    Personaliza el portfolio con información real del desarrollador

.DESCRIPTION
    Este script reemplaza todos los placeholders en los archivos de documentación
    con información real proporcionada como parámetros.

.EXAMPLE
    .\personalize.ps1 -NombreCompleto "Juan Pérez" -Email "juan@ejemplo.com"
    
.EXAMPLE
    .\personalize.ps1 `
        -NombreCompleto "Juan Pérez" `
        -Email "juan@ejemplo.com" `
        -LinkedIn "https://linkedin.com/in/juanperez" `
        -GitHub "https://github.com/juanperez"

.NOTES
    Ejecutar desde la carpeta portfolio/
#>
