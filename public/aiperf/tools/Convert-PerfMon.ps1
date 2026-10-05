[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0, ValueFromPipeline, ValueFromPipelineByPropertyName)]
    [Alias('FullName')]
    [string[]]$Path,

    [Parameter(Mandatory)]
    [string]$OutputDirectory
)

begin {
    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $relog = Get-Command -Name 'relog.exe' -CommandType Application -ErrorAction SilentlyContinue
    if (-not $relog) {
        throw 'relog.exe was not found. Run this script on Windows with Performance Monitor tools installed.'
    }

    $resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
    [System.IO.Directory]::CreateDirectory($resolvedOutput) | Out-Null
    $inputs = [System.Collections.Generic.List[string]]::new()
}

process {
    foreach ($inputPath in $Path) {
        if ([string]::IsNullOrWhiteSpace($inputPath)) { continue }

        $items = Get-Item -LiteralPath $inputPath -ErrorAction Stop
        foreach ($item in $items) {
            if ($item.PSIsContainer) {
                Get-ChildItem -LiteralPath $item.FullName -Filter '*.blg' -File | ForEach-Object {
                    $inputs.Add($_.FullName)
                }
            }
            elseif ($item.Extension -ieq '.blg') {
                $inputs.Add($item.FullName)
            }
            else {
                Write-Warning "Skipping non-BLG input: $($item.FullName)"
            }
        }
    }
}

end {
    $uniqueInputs = $inputs | Sort-Object -Unique
    if (-not $uniqueInputs) {
        throw 'No BLG files were found in -Path.'
    }

    $usedNames = @{}
    foreach ($inputFile in $uniqueInputs) {
        $baseName = [System.IO.Path]::GetFileNameWithoutExtension($inputFile)
        $candidate = "$baseName.csv"
        $suffix = 2
        while ($usedNames.ContainsKey($candidate) -or (Test-Path -LiteralPath (Join-Path $resolvedOutput $candidate))) {
            $candidate = "$baseName-$suffix.csv"
            $suffix++
        }
        $usedNames[$candidate] = $true
        $outputFile = Join-Path $resolvedOutput $candidate

        Write-Host "Converting '$inputFile' -> '$outputFile'"
        & $relog.Source $inputFile '-f' 'CSV' '-o' $outputFile
        if ($LASTEXITCODE -ne 0) {
            throw "relog.exe failed with exit code $LASTEXITCODE for '$inputFile'."
        }
        if (-not (Test-Path -LiteralPath $outputFile)) {
            throw "relog.exe reported success but did not create '$outputFile'."
        }

        Get-Item -LiteralPath $outputFile
    }

    Write-Warning 'PDH CSV headers and decimal formatting are locale-sensitive. Convert and analyze on a machine with the same regional settings when possible. DataSnare-AIPerf reads the PDH timezone bias header but expects relog CSV numeric values to use a dot decimal separator.'
}
