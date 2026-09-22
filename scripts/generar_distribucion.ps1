param([switch]$Check)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
& (Join-Path $PSScriptRoot 'generar_configuracion_browser.ps1') -Check:$Check
$packages = @{
    dashboard = 'dashboard_inventario_local'
    dashboard_servillantas_chihuahua = 'dashboard_servillantas_chihuahua_local'
}
foreach ($source in $packages.Keys) {
    $target = Join-Path $root ('distribucion/' + $packages[$source])
    $assets = @('app.js', 'index.html', 'styles.css', 'vendor/xlsx.full.min.js', 'shared/inventory.js', 'shared/inventory-config.js', 'data.js')
    foreach ($asset in $assets) {
        $destination = Join-Path $target $asset
        if ($asset -eq 'data.js') {
            $bytes = [Text.Encoding]::UTF8.GetBytes(('window.INVENTORY_DATA = { cutoff: "", rows: [] };' + "`n"))
        } elseif ($asset -eq 'index.html') {
            $html = [IO.File]::ReadAllText((Join-Path $root "$source/index.html")).Replace('../shared/', 'shared/')
            $bytes = [Text.Encoding]::UTF8.GetBytes($html)
        } else {
            $origin = if ($asset.StartsWith('shared/')) { Join-Path $root $asset } else { Join-Path $root "$source/$asset" }
            $bytes = [IO.File]::ReadAllBytes($origin)
        }
        if ($Check) {
            if (-not (Test-Path -LiteralPath $destination) -or [Convert]::ToBase64String([IO.File]::ReadAllBytes($destination)) -cne [Convert]::ToBase64String($bytes)) {
                throw "Distribucion desactualizada: $destination"
            }
        } else {
            New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
            [IO.File]::WriteAllBytes($destination, $bytes)
        }
    }
}
Write-Output 'Distribucion verificada/generada desde fuentes. Lanzadores e instrucciones existentes conservados.'
