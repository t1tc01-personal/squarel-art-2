# Opens Windows Sandbox with launcher\dist mapped read-only at C:\SquarelDist (docs/release.md).
# Build first: pnpm --dir launcher dist
$ErrorActionPreference = 'Stop'
$dist = Join-Path $PSScriptRoot '..\..\dist'
if (-not (Test-Path (Join-Path $dist '*.exe'))) {
  Write-Error 'launcher\dist has no installer yet. Run: pnpm --dir launcher dist'
}
$dist = (Resolve-Path $dist).Path
$template = Get-Content (Join-Path $PSScriptRoot 'squarel.wsb') -Raw
$wsb = Join-Path $env:TEMP 'squarel-sandbox.wsb'
$template.Replace('__LAUNCHER_DIST__', $dist) | Set-Content -Encoding utf8 $wsb
Start-Process $wsb
