# Pruebas y operacion de Fase 1

Requisitos de desarrollo: Git con el commit de referencia b83e6f3, PowerShell 5.1, ImportExcel (probado con 7.8.10) y Node.js 22 o superior. Node solo se necesita para pruebas, no para abrir los dashboards.

## Caracterizacion

Antes de modificar produccion pasaron 32 pruebas JavaScript y 15 comprobaciones PowerShell. No existia una suite anterior.

- `node tests/Test-Dashboards.cjs`: 36 pruebas sobre las funciones reales en un DOM simulado. Incluye quiebre, cobertura insuficiente, exceso, compra reciente, sin movimiento, fecha desconocida, diferencias positivas/negativas de EXIST, agregacion medida-tier, demanda general, CHIH/PAR y comparacion de exportaciones/proveedores con b83e6f3.
- `powershell -NoProfile -ExecutionPolicy Bypass -File tests/Test-Characterization.ps1`: 16 comprobaciones del comportamiento anterior. Extrae los scripts de b83e6f3 a una carpeta temporal, sin cambiar el checkout. Confirma que el reporte anterior excluia diferencias de EXIST.

## Contrato y regresion actual

- `node tests/Test-Inventory-Contract.cjs`: 14 pruebas del nuevo contrato, caches antiguos y configuracion generada.
- `powershell -NoProfile -ExecutionPolicy Bypass -File tests/Test-Inventory.ps1 -Contract`: 38 comprobaciones del contrato y de los generadores/reporte con archivos Excel sinteticos reales. Valida que las diferencias de EXIST no excluyen filas y que se conservan demanda, compra y columnas exportadas.
- `powershell -NoProfile -ExecutionPolicy Bypass -File tests/Test-Report-Texts.ps1`: 21 comprobaciones de textos del Excel con umbrales modificados en una copia temporal del JSON y parametros explicitos de cobertura/colchon; no modifica la configuracion del repositorio.
- `powershell -NoProfile -ExecutionPolicy Bypass -File tests/Test-Server.ps1`: cinco recursos HTTP, incluido shared, con servidor temporal. Cierra exclusivamente el proceso que crea.

Los Excel sinteticos y resultados se crean en una carpeta temporal unica que se informa al terminar. No se usan datos operativos. El harness JavaScript no es una prueba visual de navegador.

## Configuracion y distribucion

Editar solo `config/inventory-rules.json`. No mantener valores manualmente en los JS generados.

- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/generar_configuracion_browser.ps1`: genera `shared/inventory-config.js` de manera determinista.
- El mismo comando con `-Check` falla si el artefacto esta desactualizado.
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/generar_distribucion.ps1`: regenera primero la configuracion y despues ambos paquetes desde fuentes; adapta referencias a shared y genera datos vacios. Conserva lanzadores e instrucciones existentes. No copiar datos operativos a estos paquetes.
- El mismo comando con `-Check` verifica los artefactos sin escribir.
- `node tests/Test-Packaging.cjs`: comprueba referencias de scripts, arranque de los paquetes y ausencia de cambios estructurales en las pantallas.

Los scripts descubren ImportExcel en PSModulePath, sin fallback personal. Las dependencias internas se resuelven desde PSScriptRoot. Las rutas de entrada/salida y los parametros explicitos del reporte conservan su comportamiento anterior; los valores predeterminados de los umbrales vienen exclusivamente del JSON.

## Diferencias intencionales y supuestos

El reporte anterior excluia dos de tres filas sinteticas: EXIST 25 o 12 frente a 18 disponibles. El nuevo conserva las tres. EXIST 25 significa 7 apartadas, no un error. EXIST 12 conserva 18 disponibles y registra diagnostico, sin exclusion. No se restan los apartados dos veces.

El contrato agrega `systemStock`, `availableStock`, `reservedStock`, `stockDifference` y `stockDiagnostics`. Los aliases `exist`/`reserved` conservan sus conversiones anteriores. Los campos explicitos conservan la precision de origen; no se ha unificado el redondeo entre JavaScript y PowerShell. El reporte usa el contrato internamente, sin agregar columnas de exportacion.

Una diferencia negativa superior a 0.01 unidades genera `SYSTEM_STOCK_BELOW_AVAILABLE`; se conserva toda diferencia en `stockDifference`. La tolerancia coincide con el diagnostico anterior y esta en el JSON. Los apartados son globales y no se asignan a CHIH o PAR.

Un cache antiguo no conserva EXIST original, especialmente cuando la diferencia era negativa: `systemStock` y `stockDifference` quedan en null y se agrega `LEGACY_SYSTEM_STOCK_UNKNOWN`, sin inventar valores. `availableStock`/`reservedStock` se recuperan de los aliases. Una nueva carga Excel recupera el contrato completo.

Se conservan las tres estrategias de demanda: ponderacion trimestral general, ventas trimestrales por CHIH/PAR y seis bloques ponderados con estacionalidad y colchon en el reporte. Se conserva la etiqueta historica `Inventario anterior a 2023` cuando falta fecha; caracterizarla no valida esa inferencia. La fecha fija del generador general, los textos visibles de los dashboards y los nombres de exportacion se mantienen por alcance de fase. Los textos generados del reporte PowerShell reflejan los umbrales configurados y los parametros efectivos de cobertura y colchon; la ventana historica de transferencias se describe a partir de las fechas efectivamente utilizadas.

Las variaciones del contenido del reporte incluyen los textos de configuracion efectiva y la inclusion de filas antes descartadas y sus efectos en totales/compras/transferencias, junto con el diagnostico de apartados/diferencia negativa. Se mantienen nombres de hojas y columnas.
