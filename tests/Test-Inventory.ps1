param([switch]$Contract)
$ErrorActionPreference = 'Stop'
Import-Module ImportExcel
$repo = Split-Path $PSScriptRoot -Parent
$work = Join-Path ([IO.Path]::GetTempPath()) ('inventory-tests-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
if (-not $Contract) {
    # Reproduce the pre-phase behavior without checking out or modifying the workspace.
    $baselineRoot = Join-Path $work 'baseline'
    New-Item -ItemType Directory -Path (Join-Path $baselineRoot 'scripts') | Out-Null
    foreach ($name in @('generar_dashboard_inventario','generar_dashboard_servillantas_chihuahua','generar_reporte_inventario')) {
        $content = git -C $repo show "b83e6f3:scripts/$name.ps1"
        if ($LASTEXITCODE -ne 0) { throw 'No se pudo leer la referencia de caracterizacion b83e6f3.' }
        [IO.File]::WriteAllText((Join-Path $baselineRoot "scripts/$name.ps1"), ($content -join "`n"), [Text.UTF8Encoding]::new($false))
    }
    $repo = $baselineRoot
}
function Assert-Equal($actual, $expected, $name) {
    if ($actual -ne $expected) { throw "$name : expected $expected, got $actual" }
    Write-Output "PASS $name"
}
$inventory = foreach ($case in @(@('EQUAL',18), @('RESERVED',25), @('NEGATIVE',12))) {
    [pscustomobject]@{ CVE_ART=$case[0]; DESCRIPCION='Sintetico'; CTRL_ALM='PLT'; MEDIDA='205/55R16'; MARCA='TEST'; TIER=4; SAT=10; INS=8; CUE=0; TOR=0; FCO=1; PIS=2; JUV=3; CAMP=4; PAR=8; EXIST=$case[1]; ULT_COSTO=100; FCH_ULTCOM=[datetime]'2026-03-23'; FCH_ULTVTA=[datetime]'2026-08-20'; ACUM_VTS_3M=60; 'ACUM_VTS_6M.SUM'=90; ACUM_VTS_PAR=15 }
}
$sales = foreach ($sku in @('EQUAL','RESERVED','NEGATIVE')) {
    foreach ($days in @(0,30,60,90,120,150)) {
        [pscustomobject]@{ CVE_ART=$sku; DESCR='Sintetico'; MEDIDA='205/55R16'; MARCA='TEST'; SUCURSAL='SAT'; FECHA_DOCU=([datetime]'2026-08-20').AddDays(-$days); SUM=30; COSTO_TOT=3000; TOTAL_VENTA=4500 }
    }
}
$ip = Join-Path $work 'inventory.xlsx'
$sp = Join-Path $work 'sales.xlsx'
$inventory | Export-Excel -Path $ip -WorksheetName Consulta1
$sales | Export-Excel -Path $sp -WorksheetName PRODUCTOS
# Use a temporary working directory: no generated data or reports in the repository.
Push-Location $work
try {
    & (Join-Path $repo 'scripts/generar_dashboard_inventario.ps1') -InventoryPath $ip -OutputPath 'general.js' | Out-Null
    & (Join-Path $repo 'scripts/generar_dashboard_servillantas_chihuahua.ps1') -InventoryPath $ip -OutputPath 'chihuahua.js' | Out-Null
    foreach ($name in @('general','chihuahua')) {
        $json = (Get-Content "$name.js" -Raw -Encoding UTF8) -replace '^window.INVENTORY_DATA = ', '' -replace ';\s*$', ''
        $data = $json | ConvertFrom-Json
        Assert-Equal $data.rows.Count 3 "$name retains all stock differences"
        Assert-Equal $data.rows[1].exist 18 "$name available alias"
        Assert-Equal $data.rows[1].reserved 7 "$name reserved alias"
        if ($name -eq 'general') {
            Assert-Equal $data.rows[0].monthlyDemand 16.67 'General weighted demand'
            Assert-Equal $data.rows[0].purchase 32 'General purchase'
        } else {
            Assert-Equal $data.rows[0].chih 10 'CHIH sum'
            Assert-Equal $data.rows[0].par 8 'PAR stock'
            Assert-Equal $data.rows[0].sales3Chih 45 'CHIH sales'
            Assert-Equal $data.rows[0].sales3Par 15 'PAR sales'
        }
        if ($Contract) {
            Assert-Equal $data.rows[1].systemStock 25 "$name contract system"
            Assert-Equal $data.rows[1].availableStock 18 "$name contract available"
            Assert-Equal $data.rows[1].reservedStock 7 "$name contract reserved"
            Assert-Equal $data.rows[2].stockDiagnostics[0] 'SYSTEM_STOCK_BELOW_AVAILABLE' "$name negative diagnostic"
        }
    }
    $report = & (Join-Path $repo 'scripts/generar_reporte_inventario.ps1') -InventarioPath $ip -VentasPath $sp -OutputDirectory (Join-Path $work 'output')
    $summary = @(Import-Excel -Path $report -WorksheetName Resumen)
    $expectedCount = if ($Contract) { 3 } else { 1 }
    Assert-Equal ($summary | Where-Object Indicador -eq 'SKU de llantas analizados').Valor $expectedCount 'Report included rows (intentional EXIST change)'
    $purchases = @(Import-Excel -Path $report -WorksheetName Compra_sugerida)
    Assert-Equal ($purchases | Where-Object SKU -eq 'EQUAL').DemandaMensualPonderada 30 'Report six weighted buckets unchanged'
    Assert-Equal ($purchases | Where-Object SKU -eq 'EQUAL').CompraSugerida 87 'Report 105-day target unchanged'
    $expectedColumns = 'SKU,Descripcion,Medida,Marca,Tier,SAT,INS,CUE,TOR,InventarioTotal,DemandaMensualPonderada,DiasCobertura,UltimaVenta,DiasSinVenta,UltimoCosto,PrecioPublico,MargenEstimado,CompraSugerida,InversionSugerida,AdvertenciaDemanda'
    Assert-Equal (($purchases[0].PSObject.Properties.Name) -join ',') $expectedColumns 'Report export columns unchanged'
    if ($Contract) {
        $quality = @(Import-Excel -Path $report -WorksheetName Calidad_datos)
        Assert-Equal ($quality | Where-Object Validacion -eq 'Inventario apartado/no disponible').Resultado 1 'Positive difference counted as reserved'
        Assert-Equal ($quality | Where-Object Validacion -eq 'Inventario apartado/no disponible').Estado 'Informativo' 'Positive difference is not an error'
        Assert-Equal ($quality | Where-Object Validacion -eq 'EXIST menor que suma de almacenes').Resultado 1 'Negative difference diagnostic'
        Assert-Equal ($purchases | Where-Object SKU -eq 'RESERVED').CompraSugerida 87 'Reserved stock not subtracted twice'
        Assert-Equal ($purchases | Where-Object SKU -eq 'NEGATIVE').CompraSugerida 87 'Negative difference remains in report'
        Import-Module (Join-Path $repo 'scripts/Inventory.Common.psm1') -Force
        $fixtures = Get-Content (Join-Path $PSScriptRoot 'fixtures/inventory-cases.json') -Raw | ConvertFrom-Json
        foreach ($case in $fixtures.stock) {
            $result = Get-InventoryStock -SystemStock $case.systemStock -Warehouses $case.warehouses
            Assert-Equal $result.availableStock $case.availableStock "$($case.name) contract available"
            Assert-Equal $result.reservedStock $case.reservedStock "$($case.name) contract reserved"
            Assert-Equal ($result.stockDiagnostics -join ',') ($case.diagnostics -join ',') "$($case.name) contract diagnostics"
        }
    }
} finally { Pop-Location }
Write-Output "Synthetic artifacts: $work"
