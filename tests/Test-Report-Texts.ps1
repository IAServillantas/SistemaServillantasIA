# Integration regression: change configuration only inside an isolated temporary copy.
$ErrorActionPreference = 'Stop'
Import-Module ImportExcel
$repo = Split-Path $PSScriptRoot -Parent
$configPath = Join-Path $repo 'config/inventory-rules.json'
$originalHash = (Get-FileHash $configPath).Hash
$work = Join-Path ([IO.Path]::GetTempPath()) ('report-text-tests-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path "$work/scripts","$work/config" -Force | Out-Null
foreach ($name in @('generar_reporte_inventario.ps1','Inventory.Common.psm1')) {
    Copy-Item -LiteralPath (Join-Path $repo "scripts/$name") -Destination "$work/scripts/$name"
}
$rules = Get-Content $configPath -Raw | ConvertFrom-Json
$rules.inventory.targetCoverageDays = 72
$rules.report.bufferDays = 11
$rules.inventory.excessDays = 143
$rules.inventory.noMovementDays = 47
$rules.report.lostDemandWarningDays = 22
$rules.report.seasonFactorMin = 0.8
$rules.report.seasonFactorMax = 1.2
$rules | ConvertTo-Json -Depth 10 | Set-Content "$work/config/inventory-rules.json" -Encoding UTF8
function Assert-Equal($actual, $expected, $name) {
    if ($actual -cne $expected) { throw "$name : expected '$expected', got '$actual'" }
    Write-Output "PASS $name"
}
$inventory = @(
    [pscustomobject]@{ CVE_ART='OLD'; DESCRIPCION='Synthetic'; MEDIDA='205/55R16'; TIER=4; SAT=0; INS=0; CUE=0; TOR=0; EXIST=0; ULT_COSTO=100 },
    [pscustomobject]@{ CVE_ART='TRANSFER'; DESCRIPCION='Synthetic'; MEDIDA='215/55R16'; TIER=4; SAT=100; INS=0; CUE=0; TOR=0; EXIST=100; ULT_COSTO=100 }
)
$sales = @(
    [pscustomobject]@{ CVE_ART='OLD'; FECHA_DOCU=[datetime]'2026-07-21'; SUM=30; SUCURSAL='SAT' },
    [pscustomobject]@{ CVE_ART='TRANSFER'; FECHA_DOCU=[datetime]'2026-08-20'; SUM=30; SUCURSAL='INS' }
)
$inventory | Export-Excel "$work/inventory.xlsx" -WorksheetName Consulta1
$sales | Export-Excel "$work/sales.xlsx" -WorksheetName PRODUCTOS
try {
    foreach ($case in @(
        @{ Name='JSON'; Parameters=@{}; Target=72; Buffer=11; Total=83 },
        @{ Name='Parameters'; Parameters=@{ DiasCoberturaObjetivo=81; DiasColchon=7 }; Target=81; Buffer=7; Total=88 }
    )) {
        $parameters = $case.Parameters
        $report = & "$work/scripts/generar_reporte_inventario.ps1" -InventarioPath "$work/inventory.xlsx" -VentasPath "$work/sales.xlsx" -OutputDirectory "$work/output" @parameters
        $summary = @(Import-Excel $report -WorksheetName Resumen)
        $methodology = @(Import-Excel $report -WorksheetName Metodologia)
        $purchases = @(Import-Excel $report -WorksheetName Compra_sugerida)
        $transfers = @(Import-Excel $report -WorksheetName Transferencias)
        $coverage = "$($case.Total) dias ($($case.Target) dias de cobertura + $($case.Buffer) dias de colchon)"
        Assert-Equal ($summary | Where-Object Indicador -eq 'SKU con compra sugerida').Interpretacion "Objetivo de $coverage ajustado por temporada" "$($case.Name) effective coverage and buffer"
        Assert-Equal ($methodology | Where-Object Tema -eq 'Compra sugerida').Regla "Demanda diaria ponderada por $coverage, ajustada por temporada, menos inventario compartido." "$($case.Name) purchase methodology"
        Assert-Equal ($summary | Where-Object Indicador -eq 'SKU con exceso').Interpretacion 'Mas de 143 dias de cobertura' "$($case.Name) excess summary"
        Assert-Equal ($methodology | Where-Object Tema -eq 'Exceso').Regla 'Inventario superior a 143 dias de demanda estimada.' "$($case.Name) excess methodology"
        Assert-Equal ($summary | Where-Object Indicador -eq 'SKU sin movimiento').Interpretacion 'Con inventario y 47 dias o mas sin venta' "$($case.Name) inactivity summary"
        Assert-Equal ($methodology | Where-Object Tema -eq 'Sin movimiento').Regla 'Inventario positivo y 47 dias o mas sin venta registrada.' "$($case.Name) inactivity methodology"
        Assert-Equal ($purchases | Where-Object SKU -eq 'OLD').AdvertenciaDemanda 'Posiblemente subestimada: agotado o sin venta por 22 dias o mas' "$($case.Name) lost-demand warning"
        Assert-Equal @($methodology | Where-Object Tema -eq 'Agotados por 22 dias').Count 1 "$($case.Name) lost-demand heading"
        Assert-Equal ($methodology | Where-Object Tema -eq 'Estacionalidad').Regla 'Indice mensual calculado con meses completos de ventas; limitado entre 0.8 y 1.2 para evitar distorsiones.' "$($case.Name) season limits"
        Assert-Equal ($transfers | Where-Object SKU -eq 'TRANSFER').Evidencia 'Destino sin inventario y con ventas en los ultimos 90 dias' "$($case.Name) actual sales window stays independent of coverage"
    }
} finally {
    Assert-Equal (Get-FileHash $configPath).Hash $originalHash 'Repository configuration unchanged'
}
Write-Output "Synthetic artifacts: $work"
