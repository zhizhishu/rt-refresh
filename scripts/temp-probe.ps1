param(
  [string]$Base = $env:RT_REFRESH_BASE,
  [string]$BasicAuth = $env:RT_REFRESH_BASIC_AUTH,
  [switch]$Raw,
  [string]$ProxyTarget = $env:RT_REFRESH_PROXY_TARGET,
  [string]$Ref = "main",
  [string]$Repo = "https://raw.githubusercontent.com/zhizhishu/rt-refresh"
)

$ErrorActionPreference = "Stop"

if (-not $Base) {
  throw "Missing -Base, e.g. -Base http://SERVER:8787"
}

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("rt-refresh-probe-" + [Guid]::NewGuid().ToString("N"))

function Download-FileStrict {
  param([string]$Url, [string]$OutFile)
  Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $OutFile
}

function Get-NodeExecutable {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) {
    try {
      $major = (& $cmd.Source -p "process.versions.node.split('.')[0]") -as [int]
      if ($major -ge 18) { return $cmd.Source }
    } catch {}
  }

  $index = Invoke-RestMethod -Uri "https://nodejs.org/dist/index.json"
  $version = ($index | Where-Object { $_.version -like "v24.*" } | Select-Object -First 1).version
  if (-not $version) {
    $version = ($index | Where-Object { $_.lts } | Select-Object -First 1).version
  }
  if (-not $version) { throw "Cannot resolve a portable Node.js version" }

  $arch = if ($env:PROCESSOR_ARCHITECTURE -match "ARM64|AARCH64") { "arm64" } else { "x64" }
  $zip = "node-$version-win-$arch.zip"
  $url = "https://nodejs.org/dist/$version/$zip"
  $zipPath = Join-Path $tempRoot $zip
  Download-FileStrict $url $zipPath
  Expand-Archive -Path $zipPath -DestinationPath $tempRoot -Force
  return (Join-Path $tempRoot "node-$version-win-$arch\node.exe")
}

New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

try {
  $scriptBase = "$Repo/$Ref/scripts"
  $quickProbe = Join-Path $tempRoot "quick-probe.mjs"
  $companion = Join-Path $tempRoot "cli-companion.mjs"
  Download-FileStrict "$scriptBase/quick-probe.mjs" $quickProbe
  Download-FileStrict "$scriptBase/cli-companion.mjs" $companion

  $node = Get-NodeExecutable
  $args = @($quickProbe, "--base", $Base)
  if ($BasicAuth) { $args += @("--basic-auth", $BasicAuth) }
  if ($Raw) { $args += "--raw" }
  if ($ProxyTarget) { $args += @("--proxy-target", $ProxyTarget) }

  & $node @args
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
