$script:InventoryRules = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../config/inventory-rules.json') -Raw -Encoding UTF8 | ConvertFrom-Json
function Get-InventoryRules {
    $script:InventoryRules
}
function Import-InventoryExcel {
    $module = Get-Module -ListAvailable ImportExcel | Sort-Object Version -Descending | Select-Object -First 1
    if ($null -eq $module) { throw 'Se requiere ImportExcel. Instale el modulo en una ruta de PSModulePath.' }
    Import-Module $module.Path -Global
}
function Get-InventoryStock {
    param([double]$SystemStock, [double[]]$Warehouses)
    $available = 0.0
    foreach ($value in $Warehouses) { $available += $value }
    $difference = $SystemStock - $available
    $diagnostics = @()
    if ($difference -lt -(Get-InventoryRules).inventory.stockDifferenceTolerance) {
        $diagnostics = @('SYSTEM_STOCK_BELOW_AVAILABLE')
    }
    [pscustomobject]@{
        systemStock = $SystemStock
        availableStock = $available
        reservedStock = [math]::Max(0, $difference)
        stockDifference = $difference
        stockDiagnostics = $diagnostics
    }
}
Export-ModuleMember -Function Get-InventoryRules,Import-InventoryExcel,Get-InventoryStock
