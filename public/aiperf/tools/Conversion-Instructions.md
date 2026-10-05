# Convert PerfMon BLG Locally

## Prerequisites

- Windows, PowerShell and `relog.exe` (Windows Performance Monitor tooling).
- Download `Convert-PerfMon.ps1` and these instructions together. Preserve original BLG files and allow space for larger CSV outputs.
- Convert on a Windows machine with regional settings matching the capture where possible. The analyzer reads PDH timezone bias headers but expects dot-decimal numeric values.

## Run

Review the downloaded script before execution. The helper is currently unsigned. Follow your organization's execution policy; do not disable it or use an execution-policy bypass. If Windows blocks a trusted downloaded file, unblock it only after review and approval:

```powershell
Unblock-File -LiteralPath '.\Convert-PerfMon.ps1'
.\Convert-PerfMon.ps1 -Path 'C:\Evidence\capture.blg' -OutputDirectory 'C:\Evidence\Converted'
```

Run from the folder containing the helper. For all BLG files directly in a directory:

```powershell
.\Convert-PerfMon.ps1 -Path 'C:\Evidence' -OutputDirectory 'C:\Evidence\Converted'
```

If policy requires signed scripts, obtain an approved signed copy from your administrator. No automatic elevation is attempted. The helper uses Windows `relog.exe`, creates CSV output with unique names, leaves the originals unchanged, and never uploads files.

## Import

In AIAnalysis > Performance, choose the converted CSV as the evidence file and analyze it. Confirm that timestamps, timezone bias and numeric values match the capture.

For local review or larger CSV files, open full AIPerf and load the CSV. Export events JSON and import that JSON into the authorized AIAnalysis tenant. Core CSV/XML and JSON uploads are capped at 25 MiB; JSON imports also allow at most 10,000 combined events/findings.

## Troubleshooting And Privacy

- `relog.exe` not found: use Windows with Performance Monitor tooling; check `Get-Command relog.exe`.
- Access denied: verify input-read and output-write permissions.
- No BLG files: verify the selected path and extension. Directory mode is not recursive.
- Conversion error: inspect relog's exit code and check that the BLG can be opened by Windows Performance Monitor.
- Incorrect numbers/timestamps: check regional settings and the PDH header before ingestion.
- Performance counters can expose host names and application details. Review before explicitly uploading. Conversion needs no Core connection when Windows tooling is installed.

This is a command-line helper, not yet a signed GUI installer or an AIOps agent conversion feature.