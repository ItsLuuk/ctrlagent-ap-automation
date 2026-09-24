[CmdletBinding()]
param(
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$logPath = Join-Path $root "tauri-launch.log"

$msys2Bin = "C:\msys64\ucrt64\bin"
if (Test-Path $msys2Bin) {
  $env:Path = "$msys2Bin;$env:Path"
}

$mutex = New-Object System.Threading.Mutex($false, "Local\FoundryTauriBootstrap")
$ownsMutex = $false
try {
  $ownsMutex = $mutex.WaitOne(0)
} catch [System.Threading.AbandonedMutexException] {
  $ownsMutex = $true
}
if (-not $ownsMutex) {
  $mutex.Dispose()
  exit 0
}

try {
  Set-Location $root
  Set-Content -LiteralPath $logPath -Value "" -Encoding UTF8

function Write-BootstrapLog([string]$Message) {
  $timestamp = (Get-Date).ToString("s")
  Add-Content -LiteralPath $logPath -Value "[$timestamp] $Message" -Encoding UTF8
}

function Invoke-LoggedCommand([string]$FilePath, [string[]]$Arguments) {
  $stdoutPath = [IO.Path]::GetTempFileName()
  $stderrPath = [IO.Path]::GetTempFileName()
  try {
    $process = Start-Process `
      -FilePath $FilePath `
      -ArgumentList $Arguments `
      -WorkingDirectory $root `
      -WindowStyle Hidden `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath `
      -Wait `
      -PassThru
    foreach ($outputPath in @($stdoutPath, $stderrPath)) {
      if (Test-Path $outputPath) {
        $output = [IO.File]::ReadAllText($outputPath)
        if ($output) {
          Add-Content -LiteralPath $logPath -Value $output -Encoding UTF8
        }
      }
    }
    return $process.ExitCode
  } finally {
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
  }
}

function Require-Command([string]$Name, [string]$Guidance) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found. $Guidance"
  }
}

try {
  Write-BootstrapLog "Foundry Tauri bootstrap"
  Write-BootstrapLog "Project: $root"
  if (Test-Path $msys2Bin) {
    Write-BootstrapLog "Using MSYS2 UCRT64 tools from $msys2Bin"
  }

  Require-Command "bun" "Install Bun from https://bun.sh/ and reopen PowerShell."
  Require-Command "cargo" "Install the Rust toolchain and the Windows MSVC C++ Build Tools."

  if (-not $SkipInstall) {
    Write-BootstrapLog "Installing locked dependencies"
    $installExitCode = Invoke-LoggedCommand "bun" @("install", "--frozen-lockfile", "--no-progress")
    if ($installExitCode -ne 0) {
      throw "Dependency installation failed with exit code $installExitCode."
    }
  } else {
    Write-BootstrapLog "Skipping dependency installation (--SkipInstall)."
  }

  Write-BootstrapLog "Starting the clean Tauri development workflow"
  $tauriExitCode = Invoke-LoggedCommand "bun" @("run", "tauri:dev:clean")
  if ($tauriExitCode -ne 0) {
    Write-BootstrapLog "Tauri exited with code $tauriExitCode"
    exit $tauriExitCode
  }
} catch {
  Write-BootstrapLog "BOOTSTRAP FAILED: $($_.Exception.Message)"
  exit 1
}
} finally {
  if ($ownsMutex) {
    $mutex.ReleaseMutex()
  }
  $mutex.Dispose()
}
