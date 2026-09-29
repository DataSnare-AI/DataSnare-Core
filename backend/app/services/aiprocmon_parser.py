from __future__ import annotations

import csv
import io
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


MAX_EVENTS = 200
FAILURE_RESULTS = {"ACCESS DENIED", "SHARING VIOLATION", "NAME NOT FOUND", "PATH NOT FOUND"}


@dataclass(frozen=True)
class ProcMonAnalysis:
    schema: str
    parser: str
    status: str
    events: int
    bytes: int
    findings: list[dict[str, Any]]
    preview: list[dict[str, Any]]
    message: str


class ProcMonParser:
    async def analyze(self, data: bytes, artifact_name: str, capture_date: str | None = None, timezone_offset: str | None = None) -> ProcMonAnalysis:
        suffix = artifact_name.lower().rsplit(".", 1)[-1]
        if suffix == "pml":
            raise ValueError("Native PML requires Windows Procmon64 conversion; upload its CSV export for web analysis")
        if suffix == "xml":
            records = _xml_records(data)
            parser = "aiprocmon-xml-v1"
        elif suffix == "csv":
            if not capture_date or not timezone_offset:
                raise ValueError("ProcMon CSV requires the capture date and UTC offset because Time of Day has no date or timezone")
            records = _csv_records(data, capture_date, timezone_offset)
            parser = "aiprocmon-csv-v1"
        else:
            raise ValueError("AIProcMon web parser accepts CSV or XML; native PML requires Windows conversion")
        findings = _findings(records)
        preview = [record["event"] for record in records[:MAX_EVENTS]]
        return ProcMonAnalysis("datasnare-aiprocmon/events-v1", parser, "completed", len(records), len(data), findings, preview, f"Parsed {len(records)} ProcMon records; showing up to {MAX_EVENTS} events.")


def _csv_records(data: bytes, capture_date: str, timezone_offset: str) -> list[dict]:
    offset_match = re.fullmatch(r"([+-])(\d{2}):(\d{2})", timezone_offset)
    if not offset_match or int(offset_match.group(2)) > 14 or int(offset_match.group(3)) > 59:
        raise ValueError("UTC offset must use +HH:MM or -HH:MM format")
    sign = 1 if offset_match.group(1) == "+" else -1
    offset_minutes = sign * (int(offset_match.group(2)) * 60 + int(offset_match.group(3)))
    text = _decode(data)
    reader = csv.DictReader(io.StringIO(text))
    records = []
    for line_number, row in enumerate(reader, 2):
        normalized = {str(key or "").strip().lstrip("\ufeff"): str(value or "").strip() for key, value in row.items()}
        tod = normalized.get("Time of Day", "")
        timestamp = _procmon_time(tod, capture_date, offset_minutes)
        process = normalized.get("Process Name", "")
        operation = normalized.get("Operation", "")
        path = normalized.get("Path", "")
        result = normalized.get("Result", "")
        detail = normalized.get("Detail", "")
        duration_raw = normalized.get("Duration", "")
        if not duration_raw:
            match = re.search(r"(?:^|,\s*)Duration:\s*([\d.]+)", detail, re.I)
            duration_raw = match.group(1) if match else ""
        try:
            duration_ms = float(duration_raw) * 1000 if duration_raw else None
        except ValueError:
            duration_ms = None
        event = {"timestamp": timestamp, "source": "DataSnare-AIProcMon", "category": _category(operation), "severity": _severity(result, duration_ms), "host": "", "process": process, "summary": f"{process} · {operation} · {result}".strip(" ·"), "detail": {"operation": operation, "path": path, "result": result, "detail": detail, "pid": normalized.get("PID", ""), "durationMs": duration_ms}, "evidence": {"sourceFile": "", "sourceLine": line_number}}
        records.append({"event": event, "row": normalized})
    return records


def _xml_records(data: bytes) -> list[dict]:
    try:
        root = ET.fromstring(data)
    except ET.ParseError as error:
        raise ValueError("ProcMon XML is malformed") from error
    records = []
    for line_number, node in enumerate(root.iter(), 1):
        if node.tag.rsplit("}", 1)[-1].lower() != "event":
            continue
        values = {child.tag.rsplit("}", 1)[-1]: " ".join(" ".join(child.itertext()).split()) for child in node}
        process = values.get("Process_Name") or values.get("ProcessName") or values.get("Process", "")
        operation = values.get("Operation", "")
        result = values.get("Result", "")
        path = values.get("Path", "")
        detail = values.get("Detail", "")
        timestamp = _iso_timestamp(values.get("Time_of_Day") or values.get("Timestamp") or values.get("Time", ""))
        event = {"timestamp": timestamp, "source": "DataSnare-AIProcMon", "category": _category(operation), "severity": _severity(result, None), "host": values.get("Computer", ""), "process": process, "summary": f"{process} · {operation} · {result}".strip(" ·"), "detail": {"operation": operation, "path": path, "result": result, "detail": detail, "pid": values.get("PID", "")}, "evidence": {"sourceLine": line_number}}
        records.append({"event": event, "row": values})
    if not records:
        raise ValueError("ProcMon XML contained no event elements")
    return records


def _procmon_time(value: str, capture_date: str, offset_minutes: int) -> str | None:
    match = re.fullmatch(r"(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?\s*(AM|PM)?", value, re.I)
    if not match:
        return _iso_timestamp(value)
    hour = int(match.group(1))
    if match.group(5):
        hour %= 12
        if match.group(5).upper() == "PM":
            hour += 12
    if hour > 23 or int(match.group(2)) > 59 or int(match.group(3)) > 59:
        return None
    fraction = (match.group(4) or "")[:6].ljust(6, "0")
    try:
        local = datetime.fromisoformat(f"{capture_date}T{hour:02}:{match.group(2)}:{match.group(3)}.{fraction}")
        utc = local.replace(tzinfo=timezone.utc).timestamp() - offset_minutes * 60
        return datetime.fromtimestamp(utc, timezone.utc).isoformat().replace("+00:00", "Z")
    except ValueError:
        return None


def _iso_timestamp(value: str) -> str | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except ValueError:
        return None


def _category(operation: str) -> str:
    upper = operation.upper()
    if upper.startswith(("TCP", "UDP")):
        return "network"
    if "REG" in upper or "KEY" in upper:
        return "registry"
    if "FILE" in upper or "DIRECTORY" in upper:
        return "file"
    if "PROCESS" in upper:
        return "process.lifecycle"
    return "process.operation"


def _severity(result: str, duration_ms: float | None) -> str:
    normalized = result.strip().upper()
    if normalized == "ACCESS DENIED" or normalized == "SHARING VIOLATION":
        return "error"
    if normalized in {"NAME NOT FOUND", "PATH NOT FOUND"}:
        return "warning"
    if duration_ms is not None and duration_ms >= 1000:
        return "warning"
    return "info"


def _findings(records: list[dict]) -> list[dict]:
    failures: dict[str, list[dict]] = {}
    for record in records:
        event = record["event"]
        result = str(event["detail"].get("result", "")).upper()
        if result in FAILURE_RESULTS:
            failures.setdefault(result, []).append(event)
    return [{"id": f"procmon-{result.lower().replace(' ', '-')}", "severity": "error" if result in {"ACCESS DENIED", "SHARING VIOLATION"} else "warning", "title": result.title(), "detail": f"{len(events)} ProcMon operations returned {result}.", "count": len(events), "evidence": [event["evidence"] for event in events[:12]]} for result, events in failures.items()]


def _decode(data: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-16", "utf-16-le", "utf-16-be"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")
