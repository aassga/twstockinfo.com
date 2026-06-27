param(
  [string]$Root = (Get-Location).Path,
  [int]$Port = 8000
)

$resolvedRoot = [IO.Path]::GetFullPath($Root)
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
$listener.Start()

function Send-StaticResponse {
  param(
    $Stream,
    [int]$Status,
    [string]$Type,
    [byte[]]$Bytes,
    [bool]$HeadOnly = $false
  )

  $reason = switch ($Status) {
    200 { 'OK' }
    403 { 'Forbidden' }
    404 { 'Not Found' }
    default { 'Error' }
  }

  $head = "HTTP/1.1 $Status $reason`r`nContent-Type: $Type`r`nContent-Length: $($Bytes.Length)`r`nConnection: close`r`n`r`n"
  $headerBytes = [Text.Encoding]::ASCII.GetBytes($head)
  $Stream.Write($headerBytes, 0, $headerBytes.Length)
  if (-not $HeadOnly) {
    $Stream.Write($Bytes, 0, $Bytes.Length)
  }
}

function Get-ContentType {
  param([string]$Path)

  switch ([IO.Path]::GetExtension($Path).ToLowerInvariant()) {
    '.html' { 'text/html; charset=utf-8' }
    '.js' { 'text/javascript; charset=utf-8' }
    '.css' { 'text/css; charset=utf-8' }
    '.json' { 'application/json; charset=utf-8' }
    '.svg' { 'image/svg+xml' }
    '.png' { 'image/png' }
    '.jpg' { 'image/jpeg' }
    '.jpeg' { 'image/jpeg' }
    '.ico' { 'image/x-icon' }
    default { 'application/octet-stream' }
  }
}

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $stream = $client.GetStream()
    $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
    $line = $reader.ReadLine()

    while ($reader.Peek() -ge 0) {
      $header = $reader.ReadLine()
      if ($header -eq '') { break }
    }

    $isGet = $line -and $line.StartsWith('GET ')
    $isHead = $line -and $line.StartsWith('HEAD ')
    if (-not $isGet -and -not $isHead) {
      $bytes = [Text.Encoding]::UTF8.GetBytes('Only GET and HEAD are supported')
      Send-StaticResponse $stream 500 'text/plain; charset=utf-8' $bytes
      continue
    }

    $parts = $line.Split(' ')
    $pathOnly = $parts[1].Split('?')[0]
    $urlPath = [Uri]::UnescapeDataString($pathOnly)
    if ($urlPath -eq '/') { $urlPath = '/index.html' }

    $relativePath = $urlPath.TrimStart('/')
    $fullPath = [IO.Path]::GetFullPath([IO.Path]::Combine($resolvedRoot, $relativePath))

    if (-not $fullPath.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) {
      $bytes = [Text.Encoding]::UTF8.GetBytes('Forbidden')
      Send-StaticResponse $stream 403 'text/plain; charset=utf-8' $bytes $isHead
      continue
    }

    if (-not [IO.File]::Exists($fullPath)) {
      $bytes = [Text.Encoding]::UTF8.GetBytes('Not found')
      Send-StaticResponse $stream 404 'text/plain; charset=utf-8' $bytes $isHead
      continue
    }

    $bytes = [IO.File]::ReadAllBytes($fullPath)
    Send-StaticResponse $stream 200 (Get-ContentType $fullPath) $bytes $isHead
  } catch {
    try {
      $bytes = [Text.Encoding]::UTF8.GetBytes($_.Exception.Message)
      Send-StaticResponse $stream 500 'text/plain; charset=utf-8' $bytes
    } catch {}
  } finally {
    $client.Close()
  }
}
