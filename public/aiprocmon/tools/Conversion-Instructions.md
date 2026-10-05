# Convert ProcMon PML Locally

## Prerequisites

- Windows and PowerShell. Download `Convert-ProcMon.ps1` and these instructions together.
- Install Microsoft Sysinternals Process Monitor from https://learn.microsoft.com/sysinternals/downloads/procmon or use your organization's approved installation. Procmon is not bundled by DataSnare.
- Place `Procmon64.exe` beside the helper, or make it available on PATH. The helper also checks common Sysinternals install locations.
- Review the Microsoft license first. Running this helper passes `/AcceptEula` to Procmon.
- Preserve the original PML. Choose a new output directory with sufficient free disk space; CSV can be much larger than PML.

## Run

Review the downloaded script before execution. The helper is currently unsigned. Follow your organization's execution policy; do not disable that policy or use an execution-policy bypass. If Windows blocks a trusted downloaded file, unblock it only after review and approval:

```powershell
Unblock-File -LiteralPath '.\Convert-ProcMon.ps1'
.\Convert-ProcMon.ps1 -Path 'C:\Evidence\capture.pml' -OutputDirectory 'C:\Evidence\Converted'
```

Run from the folder containing the helper. If policy requires signed scripts, obtain an approved signed copy from your administrator. If Procmon requires elevation, stop and run it manually under your organization's approved procedure. Do not run conversions while another Procmon capture session is recording.

The helper creates `capture.csv` and refuses to replace an existing output. It does not edit the original PML or upload anything.

## Import

In AIAnalysis > Processes, set the original capture date and UTC offset, then choose the converted CSV as the evidence file and analyze it. ProcMon time-of-day values do not establish the date/timezone by themselves; do not use the conversion date instead of the capture date.

For local review or larger CSV files, open full AIProcMon, set the same capture context, and load the CSV. Export analysis JSON and import that JSON into the authorized AIAnalysis tenant. Core CSV/XML and JSON uploads are capped at 25 MiB; JSON imports also allow at most 10,000 combined events/findings.

## Troubleshooting And Privacy

- Tool not found: install approved Procmon or place `Procmon64.exe` beside the helper.
- Output exists: use a fresh output directory.
- Access denied: verify read/write permissions and whether approved elevation is required.
- Conversion error: inspect the exit code and open the PML manually in Procmon; use File > Save to export CSV if needed.
- Converted data may contain usernames, file paths, registry data and network endpoints. Review before explicitly uploading. Local conversion itself needs no Core connection, assuming the required tools are already installed.

This is a command-line helper, not yet a signed GUI installer or an AIOps agent conversion feature.