[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0)]
    [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
    [string] $Path,

    [Parameter(Mandatory, Position = 1)]
    [string] $OutputDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Find-Procmon64 {
    $command = Get-Command 'Procmon64.exe' -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $candidates = @(
        (Join-Path $PSScriptRoot 'Procmon64.exe'),
        (Join-Path (Split-Path $PSScriptRoot -Parent) 'Procmon64.exe'),
        (Join-Path $env:ProgramFiles 'SysinternalsSuite\Procmon64.exe'),
        (Join-Path $env:ProgramFiles 'Sysinternals\Procmon64.exe'),
        (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\Microsoft.Sysinternals.ProcessMonitor_Microsoft.Winget.Source_8wekyb3d8bbwe\Procmon64.exe')
    )

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    $wingetRoot = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    if (Test-Path -LiteralPath $wingetRoot -PathType Container) {
        $found = Get-ChildItem -LiteralPath $wingetRoot -Filter 'Procmon64.exe' -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) {
            return $found.FullName
        }
    }

    throw 'Procmon64.exe was not found. Install Microsoft Sysinternals Process Monitor or add Procmon64.exe to PATH.'
}

$inputFile = (Resolve-Path -LiteralPath $Path).Path
if ([IO.Path]::GetExtension($inputFile) -ine '.pml') {
    throw "Input must be a native ProcMon .pml file: $inputFile"
}

$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
[IO.Directory]::CreateDirectory($outputRoot) | Out-Null
$outputFile = Join-Path $outputRoot (([IO.Path]::GetFileNameWithoutExtension($inputFile)) + '.csv')
if (Test-Path -LiteralPath $outputFile) {
    throw "Output already exists. Choose a new output directory: $outputFile"
}
$procmon = Find-Procmon64

Write-Verbose "Using ProcMon: $procmon"
Write-Host "Converting '$inputFile' to '$outputFile'..."
$process = Start-Process -FilePath $procmon -ArgumentList @(
    '/AcceptEula',
    '/Quiet',
    '/OpenLog', ('"{0}"' -f $inputFile),
    '/SaveAs', ('"{0}"' -f $outputFile)
) -Wait -PassThru -NoNewWindow

if ($process.ExitCode -ne 0) {
    throw "Procmon64.exe exited with code $($process.ExitCode)."
}
if (-not (Test-Path -LiteralPath $outputFile -PathType Leaf)) {
    throw "ProcMon completed without creating the expected CSV: $outputFile"
}

$item = Get-Item -LiteralPath $outputFile
Write-Host "Created $($item.FullName) ($([Math]::Round($item.Length / 1MB, 1)) MB)."
$item.FullName
