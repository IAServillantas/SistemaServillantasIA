$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$probe.Start()
$port = $probe.LocalEndpoint.Port
$probe.Stop()
$serverScript = Join-Path $root 'backend/scripts/servidor_dashboard.ps1'
$frontendRoot = Join-Path $root 'frontend'
$server = Start-Process powershell -WindowStyle Hidden -PassThru -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File', ('"' + $serverScript + '"'), '-Root', ('"' + $frontendRoot + '"'), '-Port', $port)
try {
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        try {
            $page = Invoke-WebRequest "http://127.0.0.1:$port/index.html" -UseBasicParsing -TimeoutSec 2
            $ready = $true
            break
        } catch { Start-Sleep -Milliseconds 200 }
    }
    if (-not $ready) { throw 'Servidor no disponible' }
    foreach ($asset in @('shared/inventory.js','shared/inventory-config.js','inventario/app.js','inventario/styles.css','vendor/xlsx.full.min.js')) {
        $response = Invoke-WebRequest "http://127.0.0.1:$port/$asset" -UseBasicParsing -TimeoutSec 5
        $origin = Join-Path $frontendRoot $asset
        if ($response.Content -cne [IO.File]::ReadAllText($origin)) { throw "Contenido distinto: $asset" }
        Write-Output "PASS HTTP $asset"
    }
} finally {
    if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force }
}
