param(
    [string]$InventarioPath = ".\Inventarios al 20 de agosto.xlsx",
    [string]$VentasPath = ".\Ventas por articulo al 2026.xlsx",
    [string]$OutputDirectory = ".\resultados",
    [int]$DiasCoberturaObjetivo = 90,
    [int]$DiasColchon = 15
)

$ErrorActionPreference = "Stop"
Set-ExecutionPolicy -Scope Process Bypass -Force

$module = Get-Module -ListAvailable ImportExcel | Sort-Object Version -Descending | Select-Object -First 1
if ($null -eq $module) {
    throw "No se encontro el modulo ImportExcel."
}
Import-Module $module.Path

function Get-Number($value) {
    if ($null -eq $value -or $value -eq "") { return 0.0 }
    return [convert]::ToDouble($value, [Globalization.CultureInfo]::InvariantCulture)
}

function Get-ExcelDate($value) {
    if ($null -eq $value -or $value -eq "") { return $null }
    if ($value -is [datetime]) { return [datetime]$value }
    return [datetime]::FromOADate((Get-Number $value))
}

function Get-SeasonFactor($date, $factors) {
    $key = [int]$date.Month
    if ($factors.ContainsKey($key)) { return [double]$factors[$key] }
    return 1.0
}

function Get-ForecastSeasonFactor($startDate, $days, $factors) {
    $sum = 0.0
    for ($i = 1; $i -le $days; $i++) {
        $sum += Get-SeasonFactor ($startDate.AddDays($i)) $factors
    }
    return $sum / $days
}

function Export-ReportSheet($data, $path, $sheet, $table, [switch]$First) {
    $rows = @($data)
    if ($rows.Count -eq 0) {
        $rows = @([pscustomobject]@{ Mensaje = "Sin registros para los criterios definidos" })
    }
    $params = @{
        Path = $path
        WorksheetName = $sheet
        TableName = $table
        AutoSize = $true
        AutoFilter = $true
        FreezeTopRow = $true
        BoldTopRow = $true
    }
    if (-not $First) { $params.Append = $true }
    $rows | Export-Excel @params
}

$inventory = @(Import-Excel -Path $InventarioPath -WorksheetName "Consulta1")
$sales = @(Import-Excel -Path $VentasPath -WorksheetName "PRODUCTOS")

$salesClean = foreach ($row in $sales) {
    $date = Get-ExcelDate $row.FECHA_DOCU
    if (-not [string]::IsNullOrWhiteSpace([string]$row.CVE_ART) -and $date) {
        [pscustomobject]@{
            SKU = [string]$row.CVE_ART
            Descripcion = [string]$row.DESCR
            Medida = [string]$row.MEDIDA
            Marca = [string]$row.MARCA
            Sucursal = [string]$row.SUCURSAL
            Fecha = $date
            Unidades = Get-Number $row.SUM
            CostoTotal = Get-Number $row.COSTO_TOT
            VentaTotal = Get-Number $row.TOTAL_VENTA
            Utilidad = Get-Number $row.'UTIL. B. COSTO PROM.'
        }
    }
}

if ($salesClean.Count -eq 0) { throw "No se encontraron ventas validas." }
$referenceDate = ($salesClean | Measure-Object Fecha -Maximum).Maximum.Date
$start180 = $referenceDate.AddDays(-179)
$start90 = $referenceDate.AddDays(-89)

# Indices estacionales simples y auditables, calculados con meses completos.
$monthTotals = $salesClean |
    Where-Object { $_.Fecha -lt (Get-Date -Year $referenceDate.Year -Month $referenceDate.Month -Day 1) } |
    Group-Object { "{0:yyyy-MM}" -f $_.Fecha } |
    ForEach-Object {
        [pscustomobject]@{
            Periodo = $_.Name
            Mes = [int]$_.Name.Substring(5, 2)
            Unidades = ($_.Group | Measure-Object Unidades -Sum).Sum
        }
    }
$overallMonthAverage = ($monthTotals | Measure-Object Unidades -Average).Average
$seasonFactors = @{}
foreach ($monthGroup in ($monthTotals | Group-Object Mes)) {
    $factor = if ($overallMonthAverage -gt 0) {
        (($monthGroup.Group | Measure-Object Unidades -Average).Average / $overallMonthAverage)
    } else { 1.0 }
    $seasonFactors[[int]$monthGroup.Name] = [math]::Min(1.25, [math]::Max(0.75, $factor))
}
$forecastDays = $DiasCoberturaObjetivo + $DiasColchon
$forecastSeasonFactor = Get-ForecastSeasonFactor $referenceDate $forecastDays $seasonFactors

$salesBySku = @{}
foreach ($group in ($salesClean | Group-Object SKU)) { $salesBySku[$group.Name] = @($group.Group) }

$analysis = [Collections.Generic.List[object]]::new()
foreach ($item in $inventory) {
    $sku = [string]$item.CVE_ART
    if ([string]::IsNullOrWhiteSpace($sku)) { continue }
    $tier = Get-Number $item.TIER
    $measure = [string]$item.MEDIDA
    if ([string]::IsNullOrWhiteSpace($measure) -or $tier -lt 1 -or $tier -gt 4) { continue }

    $branchStockTotal = (Get-Number $item.SAT) + (Get-Number $item.INS) + (Get-Number $item.CUE) + (Get-Number $item.TOR)
    if ([math]::Abs($branchStockTotal - (Get-Number $item.EXIST)) -gt 0.01) { continue }

    $skuSales = if ($salesBySku.ContainsKey($sku)) { @($salesBySku[$sku]) } else { @() }
    $recentSales = @($skuSales | Where-Object { $_.Fecha -ge $start180 -and $_.Fecha -le $referenceDate })
    $weightedTotal = 0.0
    for ($bucket = 0; $bucket -lt 6; $bucket++) {
        $bucketEnd = $referenceDate.AddDays(-30 * $bucket)
        $bucketStart = $bucketEnd.AddDays(-29)
        $qty = ($recentSales | Where-Object { $_.Fecha -ge $bucketStart -and $_.Fecha -le $bucketEnd } | Measure-Object Unidades -Sum).Sum
        $weightedTotal += (Get-Number $qty) * (6 - $bucket)
    }
    $monthlyDemand = $weightedTotal / 21.0
    $dailyDemand = $monthlyDemand / 30.0
    $stockSat = Get-Number $item.SAT
    $stockIns = Get-Number $item.INS
    $stockCue = Get-Number $item.CUE
    $stockTor = Get-Number $item.TOR
    $stock = $stockSat + $stockIns + $stockCue + $stockTor
    $target = $dailyDemand * $forecastDays * $forecastSeasonFactor
    $purchase = [math]::Max(0, [math]::Ceiling($target - $stock))
    $coverage = if ($dailyDemand -gt 0) { $stock / $dailyDemand } elseif ($stock -gt 0) { 9999 } else { 0 }
    $lastSale = if ($skuSales.Count -gt 0) { ($skuSales | Measure-Object Fecha -Maximum).Maximum } else { $null }
    $daysWithoutSale = if ($lastSale) { ($referenceDate - $lastSale.Date).Days } else { 9999 }
    $price = Get-Number $item.'Precio publico'
    if ($price -eq 0) { $price = Get-Number $item.'Precio público' }
    $cost = Get-Number $item.ULT_COSTO
    $margin = if ($price -gt 0) { ($price - $cost) / $price } else { 0 }

    $analysis.Add([pscustomobject]@{
        SKU = $sku
        Descripcion = [string]$item.DESCRIPCION
        Medida = $measure
        Marca = [string]$item.MARCA
        Tier = [int]$tier
        SAT = [int]$stockSat
        INS = [int]$stockIns
        CUE = [int]$stockCue
        TOR = [int]$stockTor
        InventarioTotal = [int]$stock
        DemandaMensualPonderada = [math]::Round($monthlyDemand, 2)
        DiasCobertura = if ($coverage -eq 9999) { "Sin demanda" } else { [math]::Round($coverage, 0) }
        UltimaVenta = $lastSale
        DiasSinVenta = $daysWithoutSale
        UltimoCosto = [math]::Round($cost, 2)
        PrecioPublico = [math]::Round($price, 2)
        MargenEstimado = [math]::Round($margin, 4)
        CompraSugerida = [int]$purchase
        InversionSugerida = [math]::Round($purchase * $cost, 2)
        AdvertenciaDemanda = if ($stock -le 0 -and $daysWithoutSale -ge 60) { "Posiblemente subestimada: agotado o sin venta por 60 dias o mas" } else { "Sin alerta" }
    })
}

$purchases = @($analysis | Where-Object { $_.CompraSugerida -gt 0 } | Sort-Object InversionSugerida -Descending)
$noMovement = @($analysis | Where-Object { $_.InventarioTotal -gt 0 -and $_.DiasSinVenta -ge 90 } | Sort-Object InventarioTotal -Descending)
$excess = @($analysis | Where-Object { $_.InventarioTotal -gt 0 -and (($_.DiasCobertura -is [double]) -or ($_.DiasCobertura -is [int])) -and [double]$_.DiasCobertura -gt 120 } | Sort-Object {[double]$_.DiasCobertura} -Descending)
$stockouts = @($analysis | Where-Object { $_.InventarioTotal -le 0 -and $_.DemandaMensualPonderada -gt 0 } | Sort-Object DemandaMensualPonderada -Descending)

$branchCodes = @("SAT", "INS", "CUE", "TOR")
$branchCapacity = @{ SAT = 1000; INS = $null; CUE = 300; TOR = 300 }
$branchSummary = foreach ($branch in $branchCodes) {
    $stock = ($analysis | Measure-Object -Property $branch -Sum).Sum
    $limit = $branchCapacity[$branch]
    [pscustomobject]@{
        Sucursal = $branch
        InventarioLlantas = [int]$stock
        Limite = if ($null -eq $limit) { "Sin limite" } else { $limit }
        DiferenciaContraLimite = if ($null -eq $limit) { "No aplica" } else { [int]($limit - $stock) }
        Estado = if ($null -eq $limit) { "Sin limite definido" } elseif ($stock -gt $limit) { "Sobre limite" } else { "Dentro del limite" }
    }
}

$transfers = [Collections.Generic.List[object]]::new()
foreach ($row in $analysis) {
    $skuRecent = if ($salesBySku.ContainsKey($row.SKU)) { @($salesBySku[$row.SKU] | Where-Object { $_.Fecha -ge $start90 }) } else { @() }
    $branchDemand = @{}
    foreach ($branch in $branchCodes) {
        $branchDemand[$branch] = Get-Number (($skuRecent | Where-Object Sucursal -eq $branch | Measure-Object Unidades -Sum).Sum)
    }
    foreach ($destination in $branchCodes) {
        if ((Get-Number $row.$destination) -gt 0 -or $branchDemand[$destination] -le 0) { continue }
        $originCandidates = foreach ($origin in $branchCodes) {
            if ($origin -eq $destination) { continue }
            $originStock = Get-Number $row.$origin
            $originReserve = [math]::Ceiling($branchDemand[$origin] / 3.0)
            [pscustomobject]@{ Origin = $origin; Surplus = [math]::Max(0, $originStock - $originReserve) }
        }
        $best = $originCandidates | Sort-Object Surplus -Descending | Select-Object -First 1
        if ($best -and $best.Surplus -gt 0) {
            $quantity = [math]::Min([math]::Ceiling($branchDemand[$destination] / 3.0), $best.Surplus)
            if ($quantity -gt 0) {
                $transfers.Add([pscustomobject]@{
                    SKU = $row.SKU
                    Descripcion = $row.Descripcion
                    Medida = $row.Medida
                    Tier = $row.Tier
                    Origen = $best.Origin
                    Destino = $destination
                    TransferenciaSugerida = [int]$quantity
                    Evidencia = "Destino sin inventario y con ventas en los ultimos 90 dias"
                    Confianza = "Media; validar pedidos en transito y costo de traslado"
                })
            }
        }
    }
}

$inventoryExistMismatch = @($inventory | Where-Object {
    [math]::Abs(((Get-Number $_.SAT) + (Get-Number $_.INS) + (Get-Number $_.CUE) + (Get-Number $_.TOR)) - (Get-Number $_.EXIST)) -gt 0.01
}).Count
$quality = @(
    [pscustomobject]@{ Validacion = "Filas de inventario"; Resultado = $inventory.Count; Estado = "Informativo"; Accion = "Ninguna" }
    [pscustomobject]@{ Validacion = "Ventas de producto validas"; Resultado = $salesClean.Count; Estado = "Informativo"; Accion = "Ninguna" }
    [pscustomobject]@{ Validacion = "SKU vacio en inventario"; Resultado = @($inventory | Where-Object { [string]::IsNullOrWhiteSpace([string]$_.CVE_ART) }).Count; Estado = "Revisar si es mayor que cero"; Accion = "Corregir catalogo" }
    [pscustomobject]@{ Validacion = "Existencia total distinta a suma de sucursales"; Resultado = $inventoryExistMismatch; Estado = "Revisar si es mayor que cero"; Accion = "Conciliar con ERP" }
    [pscustomobject]@{ Validacion = "Llanta sin medida"; Resultado = @($inventory | Where-Object { $_.CTRL_ALM -eq "PLT" -and [string]::IsNullOrWhiteSpace([string]$_.MEDIDA) }).Count; Estado = "Revisar si es mayor que cero"; Accion = "Completar catalogo" }
    [pscustomobject]@{ Validacion = "Llanta sin tier valido"; Resultado = @($inventory | Where-Object { $_.CTRL_ALM -eq "PLT" -and ((Get-Number $_.TIER) -lt 1 -or (Get-Number $_.TIER) -gt 4) }).Count; Estado = "Revisar si es mayor que cero"; Accion = "Completar catalogo" }
)

$summary = @(
    [pscustomobject]@{ Indicador = "Fecha de corte detectada"; Valor = $referenceDate.ToString("dd/MM/yyyy"); Interpretacion = "Fecha maxima en ventas por articulo" }
    [pscustomobject]@{ Indicador = "SKU de llantas analizados"; Valor = $analysis.Count; Interpretacion = "Catalogo con medida y tier valido" }
    [pscustomobject]@{ Indicador = "SKU con compra sugerida"; Valor = $purchases.Count; Interpretacion = "Objetivo de $forecastDays dias ajustado por temporada" }
    [pscustomobject]@{ Indicador = "Inversion total sugerida"; Valor = "{0:C0}" -f (($purchases | Measure-Object InversionSugerida -Sum).Sum); Interpretacion = "Validar disponibilidad y tiempo de entrega" }
    [pscustomobject]@{ Indicador = "SKU sin movimiento"; Valor = $noMovement.Count; Interpretacion = "Con inventario y 90 dias o mas sin venta" }
    [pscustomobject]@{ Indicador = "SKU con exceso"; Valor = $excess.Count; Interpretacion = "Mas de 120 dias de cobertura" }
    [pscustomobject]@{ Indicador = "SKU en quiebre"; Valor = $stockouts.Count; Interpretacion = "Sin inventario compartido y con demanda estimada" }
    [pscustomobject]@{ Indicador = "Transferencias candidatas"; Valor = $transfers.Count; Interpretacion = "Requieren validacion operativa" }
)

$methodology = @(
    [pscustomobject]@{ Tema = "Demanda"; Regla = "Promedio mensual ponderado de seis bloques de 30 dias; pesos 1 a 6, con mayor peso al periodo reciente." }
    [pscustomobject]@{ Tema = "Estacionalidad"; Regla = "Indice mensual calculado con meses completos de ventas; limitado entre 0.75 y 1.25 para evitar distorsiones." }
    [pscustomobject]@{ Tema = "Compra sugerida"; Regla = "Demanda diaria ponderada por 90 dias, ajustada por temporada, menos inventario compartido." }
    [pscustomobject]@{ Tema = "Exceso"; Regla = "Inventario superior a 120 dias de demanda estimada." }
    [pscustomobject]@{ Tema = "Sin movimiento"; Regla = "Inventario positivo y 90 dias o mas sin venta registrada." }
    [pscustomobject]@{ Tema = "Quiebre"; Regla = "Inventario compartido igual a cero y demanda ponderada mayor que cero." }
    [pscustomobject]@{ Tema = "Limitacion"; Regla = "No se recibieron pedidos en transito, historial diario de existencias, tiempos de entrega por SKU ni costos de traslado; validar antes de ejecutar compras o transferencias." }
    [pscustomobject]@{ Tema = "Agotados por 60 dias"; Regla = "Sin historial diario de existencias no es posible reconstruir la demanda perdida; estos casos se marcan como posiblemente subestimados." }
    [pscustomobject]@{ Tema = "Privacidad"; Regla = "No se utilizaron ni exportaron nombres de clientes." }
)

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$baseName = "reporte_compras_inventario_{0}.xlsx" -f $referenceDate.ToString("dd-MM-yyyy")
$outputPath = Join-Path $OutputDirectory $baseName
$counter = 2
while (Test-Path -LiteralPath $outputPath) {
    $outputPath = Join-Path $OutputDirectory ("reporte_compras_inventario_{0}_v{1}.xlsx" -f $referenceDate.ToString("dd-MM-yyyy"), $counter)
    $counter++
}

Export-ReportSheet $summary $outputPath "Resumen" "ResumenKPI" -First
Export-ReportSheet $branchSummary $outputPath "Capacidad_sucursales" "CapacidadSuc"
Export-ReportSheet $purchases $outputPath "Compra_sugerida" "CompraSug"
Export-ReportSheet $transfers $outputPath "Transferencias" "Transferencias"
Export-ReportSheet $stockouts $outputPath "Quiebres" "Quiebres"
Export-ReportSheet $excess $outputPath "Exceso_120d" "Exceso120"
Export-ReportSheet $noMovement $outputPath "Sin_movimiento" "SinMovimiento"
Export-ReportSheet $quality $outputPath "Calidad_datos" "CalidadDatos"
Export-ReportSheet $methodology $outputPath "Metodologia" "Metodologia"

$package = Open-ExcelPackage -Path $outputPath
foreach ($worksheet in $package.Workbook.Worksheets) {
    $worksheet.View.ShowGridLines = $false
    $worksheet.Cells.Style.Font.Name = "Aptos"
    $worksheet.Cells.Style.Font.Size = 10
    if ($worksheet.Dimension) {
        $worksheet.Row(1).Height = 24
        $worksheet.Cells[1, 1, 1, $worksheet.Dimension.End.Column].Style.Fill.PatternType = "Solid"
        $worksheet.Cells[1, 1, 1, $worksheet.Dimension.End.Column].Style.Fill.BackgroundColor.SetColor([Drawing.Color]::FromArgb(31, 78, 121))
        $worksheet.Cells[1, 1, 1, $worksheet.Dimension.End.Column].Style.Font.Color.SetColor([Drawing.Color]::White)
        for ($column = 1; $column -le $worksheet.Dimension.End.Column; $column++) {
            $header = [string]$worksheet.Cells[1, $column].Value
            if ($header -in @("UltimoCosto", "PrecioPublico", "InversionSugerida")) {
                $worksheet.Column($column).Style.Numberformat.Format = '$#,##0'
            }
            if ($header -eq "MargenEstimado") {
                $worksheet.Column($column).Style.Numberformat.Format = '0.0%'
            }
            if ($header -eq "UltimaVenta") {
                $worksheet.Column($column).Style.Numberformat.Format = 'dd/mm/yyyy'
            }
        }
    }
}
$capacitySheet = $package.Workbook.Worksheets["Capacidad_sucursales"]
if ($capacitySheet -and $capacitySheet.Dimension.End.Row -ge 2) {
    $chart = $capacitySheet.Drawings.AddChart("InventarioPorSucursal", [OfficeOpenXml.Drawing.Chart.eChartType]::ColumnClustered)
    $capacityEndRow = $capacitySheet.Dimension.End.Row
    $seriesRange = $capacitySheet.Cells[2, 2, $capacityEndRow, 2]
    $labelRange = $capacitySheet.Cells[2, 1, $capacityEndRow, 1]
    $null = $chart.Series.Add($seriesRange, $labelRange)
    $chart.Title.Text = "Inventario de llantas por sucursal"
    $chart.SetPosition(1, 0, 6, 0)
    $chart.SetSize(720, 360)
}
Close-ExcelPackage $package

Write-Output $outputPath
