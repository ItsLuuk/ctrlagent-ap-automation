param(
  [Parameter(Mandatory = $true)]
  [string]$PayloadDirectory,

  [Parameter(Mandatory = $true)]
  [string]$InstallDirectory
)

$ErrorActionPreference = "Stop"
$payloadRoot = (Resolve-Path -LiteralPath $PayloadDirectory).Path
$manifestPath = Join-Path $payloadRoot "manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "Foundry AI payload manifest is missing: $manifestPath"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$modelsDirectory = Join-Path $InstallDirectory "models"
$runtimeDirectory = Join-Path $InstallDirectory "runtime"
New-Item -ItemType Directory -Force -Path $modelsDirectory | Out-Null
New-Item -ItemType Directory -Force -Path $runtimeDirectory | Out-Null

function Resolve-PayloadPath([string]$relativePath) {
  $fullPath = [IO.Path]::GetFullPath((Join-Path $payloadRoot $relativePath))
  $root = $payloadRoot.TrimEnd('\') + '\'
  if (-not $fullPath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Payload path escapes the payload directory: $relativePath"
  }
  return $fullPath
}

function Join-Chunks([string]$destination, [object[]]$chunks) {
  $temporaryPath = "$destination.partial"
  Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
  $output = [IO.File]::Open($temporaryPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    foreach ($chunk in $chunks) {
      $chunkPath = Resolve-PayloadPath ([string]$chunk)
      if (-not (Test-Path -LiteralPath $chunkPath)) {
        throw "Foundry AI payload chunk is missing: $chunkPath"
      }
      $input = [IO.File]::OpenRead($chunkPath)
      try {
        $input.CopyTo($output)
      } finally {
        $input.Dispose()
      }
    }
  } finally {
    $output.Dispose()
  }
  Move-Item -LiteralPath $temporaryPath -Destination $destination -Force
}

foreach ($file in $manifest.files) {
  $relativePath = ([string]$file.path).Replace('/', '\')
  if ([IO.Path]::IsPathRooted($relativePath)) {
    throw "Payload file path must be relative: $($file.path)"
  }
  $destinationRoot = if ($relativePath.StartsWith("runtime\", [StringComparison]::OrdinalIgnoreCase)) {
    $runtimeDirectory
  } elseif ($relativePath.StartsWith("models\", [StringComparison]::OrdinalIgnoreCase)) {
    $modelsDirectory
  } else {
    throw "Payload file path must start with runtime\\ or models\\: $($file.path)"
  }
  $destination = [IO.Path]::GetFullPath((Join-Path $InstallDirectory $relativePath))
  $destinationRoot = $destinationRoot.TrimEnd('\') + '\'
  if (-not $destination.StartsWith($destinationRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Payload file path escapes its resource directory: $($file.path)"
  }

  $parent = Split-Path -Parent $destination
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  Join-Chunks $destination @($file.chunks)

  $actualHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne ([string]$file.sha256).ToLowerInvariant()) {
    Remove-Item -LiteralPath $destination -Force -ErrorAction SilentlyContinue
    throw "Foundry AI payload checksum mismatch: $($file.path)"
  }
  if ((Get-Item -LiteralPath $destination).Length -ne [Int64]$file.size) {
    Remove-Item -LiteralPath $destination -Force -ErrorAction SilentlyContinue
    throw "Foundry AI payload size mismatch: $($file.path)"
  }
}

Write-Host "Foundry AI payload installed and verified: $modelsDirectory"
