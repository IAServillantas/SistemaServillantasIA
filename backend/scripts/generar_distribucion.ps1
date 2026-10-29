param([switch]$Check)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_paths.ps1')
& (Join-Path $PSScriptRoot 'generar_configuracion_browser.ps1') -Check:$Check
$packages = [ordered]@{
    'inventario' = 'dashboard_inventario_local'
    'chihuahua' = 'dashboard_servillantas_chihuahua_local'
}
foreach ($source in $packages.Keys) {
    $target = Join-Path $script:BackendRoot ('distribucion/' + $packages[$source])
    $assets = @('app.js', 'index.html', 'styles.css', 'vendor/xlsx.full.min.js', 'shared/inventory.js', 'shared/inventory-config.js', 'data.js')
    foreach ($asset in $assets) {
        $destination = Join-Path $target $asset
        if ($asset -eq 'data.js') {
            $bytes = [Text.Encoding]::UTF8.GetBytes(('window.INVENTORY_DATA = { cutoff: "", rows: [] };' + "`n"))
        } elseif ($asset -eq 'index.html') {
            $html = [IO.File]::ReadAllText((Join-Path $script:FrontendRoot "$source/index.html"))
            $html = $html.Replace('../shared/', 'shared/').Replace('../vendor/', 'vendor/')
            $bytes = [Text.Encoding]::UTF8.GetBytes($html)
        } elseif ($asset.StartsWith('shared/')) {
            $bytes = [IO.File]::ReadAllBytes((Join-Path $script:SharedRoot ($asset.Substring('shared/'.Length))))
        } elseif ($asset.StartsWith('vendor/')) {
            $bytes = [IO.File]::ReadAllBytes((Join-Path $script:FrontendRoot $asset))
        } else {
            $bytes = [IO.File]::ReadAllBytes((Join-Path $script:FrontendRoot "$source/$asset"))
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
