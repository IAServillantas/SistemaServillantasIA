# Raices del monorepo. Dot-source desde cualquier script en backend/scripts.
$script:RepoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$script:BackendRoot = Join-Path $script:RepoRoot 'backend'
$script:FrontendRoot = Join-Path $script:RepoRoot 'frontend'
$script:ConfigPath = Join-Path $script:BackendRoot 'config/inventory-rules.json'
$script:SharedRoot = Join-Path $script:FrontendRoot 'shared'
