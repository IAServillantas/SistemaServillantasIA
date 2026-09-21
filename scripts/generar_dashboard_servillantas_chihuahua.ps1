param(
    [Parameter(Mandatory = $true)]
    [string]$InventoryPath,
    [string]$OutputPath = ".\dashboard_servillantas_chihuahua\data.js"
)

$ErrorActionPreference = "Stop"
Set-ExecutionPolicy -Scope Process Bypass -Force
$module = Get-Module -ListAvailable ImportExcel | Sort-Object Version -Descending | Select-Object -First 1
if ($null -eq $module) {
    $fallback = "C:\Users\Luis T. Acosta\OneDrive\Documentos\WindowsPowerShell\Modules\ImportExcel\7.8.10\ImportExcel.psd1"
    if (-not (Test-Path -LiteralPath $fallback)) { throw "No se encontro el modulo ImportExcel." }
    Import-Module $fallback
} else {
    Import-Module $module.Path
}

function Number($value) {
    if ($null -eq $value -or $value -eq "") { return 0.0 }
    return [convert]::ToDouble($value, [Globalization.CultureInfo]::InvariantCulture)
}

function Excel-Date($value) {
    if ($null -eq $value -or $value -eq "") { return $null }
    if ($value -is [datetime]) { return [datetime]$value }
    return [datetime]::FromOADate((Number $value))
}

$sourceRows = @(Import-Excel -Path $InventoryPath -WorksheetName "Consulta1")
$pltRows = @($sourceRows | Where-Object { ([string]$_.CTRL_ALM).Trim().ToUpper() -in @("PLT", "CVT") })
if (-not $pltRows.Count) { throw "No se encontraron articulos con CTRL_ALM = PLT o CVT." }

$dates = foreach ($row in $pltRows) {
    $purchaseDate = Excel-Date $row.FCH_ULTCOM
    $saleDate = Excel-Date $row.FCH_ULTVTA
    if ($purchaseDate) { $purchaseDate }
    if ($saleDate) { $saleDate }
}
$cutoff = if ($dates) { $dates | Sort-Object -Descending | Select-Object -First 1 } else { (Get-Item -LiteralPath $InventoryPath).LastWriteTime.Date }

$output = foreach ($row in $pltRows) {
    $sku = ([string]$row.CVE_ART).Trim()
    if ([string]::IsNullOrWhiteSpace($sku)) { continue }
    $fco = Number $row.FCO
    $pis = Number $row.PIS
    $juv = Number $row.JUV
    $par = Number $row.PAR
    $camp = Number $row.CAMP
    $chih = $fco + $pis + $juv + $camp
    $exist = $chih + $par
    $sales3 = Number $row.ACUM_VTS_3M
    $sales3Par = [math]::Max(0, (Number $row.ACUM_VTS_PAR))
    $sales3Chih = [math]::Max(0, $sales3 - $sales3Par)
    $lastPurchase = Excel-Date $row.FCH_ULTCOM
    $lastSale = Excel-Date $row.FCH_ULTVTA
    [ordered]@{
        sku = $sku
        description = [string]$row.DESCRIPCION
        line = [string]$row.LIN_PROD
        control = ([string]$row.CTRL_ALM).Trim().ToUpper()
        measure = [string]$row.MEDIDA
        brand = [string]$row.MARCA
        tier = [int](Number $row.TIER)
        type = ([string]$row.CTRL_ALM).Trim().ToUpper()
        fco = [int]$fco
        pis = [int]$pis
        juv = [int]$juv
        par = [int]$par
        camp = [int]$camp
        chih = [int]$chih
        exist = [int]$exist
        reserved = [int][math]::Max(0, (Number $row.EXIST) - $exist)
        cost = [math]::Round((Number $row.ULT_COSTO), 2)
        price = [math]::Round((Number $row.'Precio público'), 2)
        sales3 = [math]::Round($sales3, 2)
        sales3Chih = [math]::Round($sales3Chih, 2)
        sales3Par = [math]::Round($sales3Par, 2)
        daysWithoutSale = if ($lastSale) { [math]::Max(0, ($cutoff.Date - $lastSale.Date).Days) } else { 9999 }
        lastPurchase = if ($lastPurchase) { $lastPurchase.ToString("dd/MM/yyyy") } else { $null }
        daysSincePurchase = if ($lastPurchase) { [math]::Max(0, ($cutoff.Date - $lastPurchase.Date).Days) } else { $null }
    }
}

$payload = [ordered]@{
    dataVersion = "servillantas-plt-cvt-v1"
    cutoff = $cutoff.ToString("dd/MM/yyyy")
    fileName = [IO.Path]::GetFileName($InventoryPath)
    generatedAt = (Get-Date).ToString("o")
    rows = @($output)
}
$json = $payload | ConvertTo-Json -Depth 5 -Compress
[IO.File]::WriteAllText((Join-Path (Get-Location) $OutputPath), "window.INVENTORY_DATA = $json;", [Text.UTF8Encoding]::new($false))
Write-Output "Dashboard de Servillantas generado con $(@($output).Count) articulos PLT/CVT."
