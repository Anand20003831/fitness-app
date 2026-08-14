# Local development server. There is no build step and never will be, but ES
# modules will not load over file://, so the browser needs a real http origin.
#
#   powershell -ExecutionPolicy Bypass -File serve.ps1
#   then open http://localhost:8080
#
# Nothing to install. Ctrl+C to stop.

param([int]$Port = 8080)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.webmanifest' = 'application/manifest+json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.ico'  = 'image/x-icon'
  '.txt'  = 'text/plain; charset=utf-8'
  '.md'   = 'text/plain; charset=utf-8'
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()
Write-Host "Serving $root"
Write-Host "  http://localhost:$Port    (Ctrl+C to stop)"

function Send-Response {
  param($Stream, [int]$Status, [string]$Reason, [string]$Type, [byte[]]$Body)
  $head = "HTTP/1.1 $Status $Reason`r`n" +
          "Content-Type: $Type`r`n" +
          "Content-Length: $($Body.Length)`r`n" +
          "Cache-Control: no-store`r`n" +
          "Connection: close`r`n`r`n"
  $headBytes = [Text.Encoding]::ASCII.GetBytes($head)
  $Stream.Write($headBytes, 0, $headBytes.Length)
  if ($Body.Length) { $Stream.Write($Body, 0, $Body.Length) }
  $Stream.Flush()
}

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      # Chrome opens speculative connections and sends nothing on them. Without
      # a read timeout the loop blocks on one of those for ever and the rest of
      # the page never loads.
      $client.ReceiveTimeout = 1000
      $stream = $client.GetStream()
      $reader = [System.IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
      $requestLine = $reader.ReadLine()
      if (-not $requestLine) { continue }
      while ($true) { $h = $reader.ReadLine(); if ([string]::IsNullOrEmpty($h)) { break } }

      $parts = $requestLine -split ' '
      $path = if ($parts.Count -ge 2) { $parts[1] } else { '/' }
      $path = ($path -split '\?')[0]
      $path = [Uri]::UnescapeDataString($path)
      if ($path -eq '/' -or $path.EndsWith('/')) { $path += 'index.html' }

      $relative = $path.TrimStart('/') -replace '/', '\'
      $full = Join-Path $root $relative
      $resolvedRoot = [IO.Path]::GetFullPath($root)
      $resolved = [IO.Path]::GetFullPath($full)

      if (-not $resolved.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) {
        Send-Response $stream 403 'Forbidden' 'text/plain' ([Text.Encoding]::UTF8.GetBytes('Forbidden'))
      }
      elseif (Test-Path -LiteralPath $resolved -PathType Leaf) {
        $ext = [IO.Path]::GetExtension($resolved).ToLowerInvariant()
        $type = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
        $bytes = [IO.File]::ReadAllBytes($resolved)
        Send-Response $stream 200 'OK' $type $bytes
        Write-Host "200 $path"
      }
      else {
        Send-Response $stream 404 'Not Found' 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes("Not found: $path"))
        Write-Host "404 $path"
      }
      $reader.Dispose()
    }
    catch {
      # A timed-out speculative connection is normal, not worth printing.
      if ($_.Exception.InnerException -isnot [System.Net.Sockets.SocketException]) {
        Write-Host "error: $($_.Exception.Message)"
      }
    }
    finally { $client.Close() }
  }
}
finally { $listener.Stop() }
