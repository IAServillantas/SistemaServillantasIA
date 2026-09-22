param(
    [int]$Port = 8000,
    [string]$Root = ".\dashboard"
)

$ErrorActionPreference = "Stop"
$resolvedRoot = (Resolve-Path $Root).Path
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
$listener.Start()

$mime = @{ ".html" = "text/html; charset=utf-8"; ".css" = "text/css; charset=utf-8"; ".js" = "application/javascript; charset=utf-8"; ".json" = "application/json; charset=utf-8" }
try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        $stream = $null
        $reader = $null
        try {
            $stream = $client.GetStream()
            $stream.ReadTimeout = 2000
            $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 4096, $true)
            $requestLine = $reader.ReadLine()
            while ($reader.ReadLine()) { }
            $requestPath = if ($requestLine -match '^GET\s+([^\s]+)') { $matches[1].Split('?')[0] } else { "/" }
            $relative = [Uri]::UnescapeDataString($requestPath).TrimStart('/')
            if ([string]::IsNullOrWhiteSpace($relative)) { $relative = "index.html" }
            # Shared source scripts are also available when serving a dashboard as the root.
            $assetRoot = $resolvedRoot
            if ($relative.StartsWith('shared/') -and -not (Test-Path -LiteralPath (Join-Path $resolvedRoot 'shared'))) {
                $assetRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../shared'))
                $relative = $relative.Substring('shared/'.Length)
            }
            $candidate = [IO.Path]::GetFullPath((Join-Path $assetRoot $relative))
            if (-not $candidate.StartsWith(($assetRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
                $status = "404 Not Found"
                $contentType = "text/plain; charset=utf-8"
                $bytes = [Text.Encoding]::UTF8.GetBytes("No encontrado")
            } else {
                $status = "200 OK"
                $extension = [IO.Path]::GetExtension($candidate).ToLowerInvariant()
                $contentType = if ($mime.ContainsKey($extension)) { $mime[$extension] } else { "application/octet-stream" }
                $bytes = [IO.File]::ReadAllBytes($candidate)
            }
            $header = "HTTP/1.1 $status`r`nContent-Type: $contentType`r`nContent-Length: $($bytes.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
            $headerBytes = [Text.Encoding]::ASCII.GetBytes($header)
            $stream.Write($headerBytes, 0, $headerBytes.Length)
            $stream.Write($bytes, 0, $bytes.Length)
            $stream.Flush()
        } catch [IO.IOException] {
            # Browsers may cancel speculative resource requests; keep serving.
        } finally {
            if ($reader) { $reader.Dispose() }
            if ($stream) { $stream.Dispose() }
            $client.Dispose()
        }
    }
} finally {
    $listener.Stop()
}
