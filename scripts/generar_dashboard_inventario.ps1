param(
    [string]$InventoryPath = ".\Inventarios al 20 de agosto.xlsx",
    [string]$OutputPath = ".\dashboard\data.js"
)

$ErrorActionPreference = "Stop"
Set-ExecutionPolicy -Scope Process Bypass -Force
$module = Get-Module -ListAvailable ImportExcel | Sort-Object Version -Descending | Select-Object -First 1
if ($null -eq $module) {
    throw "No se encontro el modulo ImportExcel."
}
Import-Module $module.Path

function Number($value) {
    if ($null -eq $value -or $value -eq "") { return 0.0 }
    return [convert]::ToDouble($value, [Globalization.CultureInfo]::InvariantCulture)
}

function Excel-Date($value) {
    if ($null -eq $value -or $value -eq "") { return $null }
    if ($value -is [datetime]) { return [datetime]$value }
    return [datetime]::FromOADate((Number $value))
}

$cutoff = Get-Date "2026-08-20"
$rows = Import-Excel -Path $InventoryPath -WorksheetName "Consulta1"
$output = foreach ($row in $rows) {
    $sku = [string]$row.CVE_ART
    if ([string]::IsNullOrWhiteSpace($sku) -or [string]$row.CTRL_ALM -ne "PLT") { continue }
    $sat = Number $row.SAT; $ins = Number $row.INS; $cue = Number $row.CUE; $tor = Number $row.TOR
    $sumBranches = $sat + $ins + $cue + $tor
    $systemExist = Number $row.EXIST
    $exist = $sumBranches
    $reserved = [math]::Max(0, $systemExist - $sumBranches)
    $sales3 = Number $row.ACUM_VTS_3M
    $sales6 = Number $row.'ACUM_VTS_6M.SUM'
    $recentMonthly = $sales3 / 3.0
    $priorMonthly = [math]::Max(0, $sales6 - $sales3) / 3.0
    $monthlyDemand = ((2 * $recentMonthly) + $priorMonthly) / 3.0
    $dailyDemand = $monthlyDemand / 30.0
    $coverage = if ($dailyDemand -gt 0) { [math]::Round($exist / $dailyDemand, 0) } else { $null }
    $purchase = [math]::Max(0, [math]::Ceiling(($dailyDemand * 105) - $exist))
    $lastSale = Excel-Date $row.FCH_ULTVTA
    $daysWithoutSale = if ($lastSale) { ($cutoff - $lastSale.Date).Days } else { 9999 }
    $lastPurchase = Excel-Date $row.FCH_ULTCOM
    $daysSincePurchase = if ($lastPurchase) { ($cutoff - $lastPurchase.Date).Days } else { $null }
    $tier = [int](Number $row.TIER)
    $measure = [string]$row.MEDIDA
    $type = if (-not [string]::IsNullOrWhiteSpace($measure) -and $tier -ge 1 -and $tier -le 4) { "LLANTA" } else { "OTRO" }
    [ordered]@{
        sku = $sku
        description = [string]$row.DESCRIPCION
        line = [string]$row.LIN_PROD
        control = [string]$row.CTRL_ALM
        measure = $measure
        brand = [string]$row.MARCA
        tier = $tier
        type = $type
        sat = [int]$sat
        ins = [int]$ins
        cue = [int]$cue
        tor = [int]$tor
        exist = [int]$exist
        reserved = [int]$reserved
        cost = [math]::Round((Number $row.ULT_COSTO), 2)
        price = [math]::Round((Number $row.'Precio publico'), 2)
        sales3 = [math]::Round($sales3, 2)
        sales6 = [math]::Round($sales6, 2)
        monthlyDemand = [math]::Round($monthlyDemand, 2)
        coverage = $coverage
        purchase = [int]$purchase
        daysWithoutSale = $daysWithoutSale
        lastPurchase = if ($lastPurchase) { $lastPurchase.ToString("dd/MM/yyyy") } else { $null }
        daysSincePurchase = $daysSincePurchase
    }
}

$payload = [ordered]@{ cutoff = $cutoff.ToString("dd/MM/yyyy"); rows = @($output) }
$json = $payload | ConvertTo-Json -Depth 4 -Compress
[IO.File]::WriteAllText((Join-Path (Get-Location) $OutputPath.TrimStart('.\')), "window.INVENTORY_DATA = $json;", [Text.UTF8Encoding]::new($false))
Write-Output "Dashboard generado con $($output.Count) articulos."
