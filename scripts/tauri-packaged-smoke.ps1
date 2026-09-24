param(
  [Parameter(Mandatory = $true)]
  [string]$ExecutablePath,
  [int]$StartupSeconds = 8
)

$resolvedPath = (Resolve-Path -LiteralPath $ExecutablePath).Path
Write-Host "Launching packaged Tauri app: $resolvedPath"
$process = Start-Process -FilePath $resolvedPath -PassThru

try {
  Start-Sleep -Seconds $StartupSeconds
  $process.Refresh()
  if ($process.HasExited) {
    throw "Packaged Tauri app exited during startup with code $($process.ExitCode)."
  }
  Write-Host "Packaged Tauri app stayed alive for $StartupSeconds seconds (PID $($process.Id))."
}
finally {
  $process.Refresh()
  if (-not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
  }
}
