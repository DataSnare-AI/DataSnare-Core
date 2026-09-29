from __future__ import annotations

import csv
import io
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


MAX_PREVIEW = 200
COUNTER_RULES = (
    (re.compile(r"\\processor(?: information)?\(_total\)\\% processor (?:time|utility)$", re.I), "cpu", 80.0, 95.0, "%"),
    (re.compile(r"\\memory\\% committed bytes in use$", re.I), "memory", 80.0, 90.0, "%"),
    (re.compile(r"\\memory\\available mbytes$", re.I), "memory.available", 500.0, 200.0, "MB"),
    (re.compile(r"\\physicaldisk\([^)]*\)\\avg\. disk sec/(?:read|write)$", re.I), "disk.latency", .02, .05, "s"),
    (re.compile(r"\\memory\\pages/sec$", re.I), "memory.paging", 20.0, 100.0, "/s"),
)


@dataclass(frozen=True)
class PerformanceAnalysis:
    schema: str
    parser: str
    status: str
    records: int
    bytes: int
    source_encoding: str
    events: list[dict[str, Any]]
    message: str


class PerformanceParser:
    async def analyze(self, data: bytes, artifact_name: str) -> PerformanceAnalysis:
        extension = artifact_name.lower().rsplit(".", 1)[-1]
        if extension == "xml":
            events = _diagnostics_xml(data)
            parser = "aiperf-diagnostics-xml-v1"
            records = len(events)
            encoding = "xml"
        elif extension == "csv":
            text, encoding = _decode(data)
            events, records = _performance_csv(text, artifact_name)
            parser = "aiperf-perfmon-csv-v1"
        else:
            raise ValueError("AIPerf web parsing accepts converted CSV or System Diagnostics XML; native BLG requires Windows relog conversion")
        return PerformanceAnalysis("datasnare-aiperf/events-v1", parser, "completed", records, len(data), encoding, events[:MAX_PREVIEW], f"Parsed {records} records; returning up to {MAX_PREVIEW} events.")


def _decode(data: bytes) -> tuple[str, str]:
    for encoding in ("utf-8-sig", "utf-16", "utf-16-le", "utf-16-be"):
        try:
            return data.decode(encoding), encoding
        except UnicodeDecodeError:
            pass
    return data.decode("utf-8", errors="replace"), "utf-8-replaced"


def _parse_time(value: str, bias: int | None) -> str | None:
    text = value.strip().strip('"')
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        for fmt in ("%m/%d/%Y %H:%M:%S.%f", "%m/%d/%Y %H:%M:%S", "%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S"):
            try:
                parsed = datetime.strptime(text, fmt)
                if bias is not None:
                    parsed = parsed.replace(tzinfo=timezone.utc).timestamp()
                    return datetime.fromtimestamp(parsed + bias * 60, timezone.utc).isoformat().replace("+00:00", "Z")
                parsed = parsed.astimezone()
                return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
            except ValueError:
                continue
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
        if bias is not None:
            parsed = datetime.fromtimestamp(parsed.timestamp() + bias * 60, timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _performance_csv(text: str, source_name: str) -> tuple[list[dict], int]:
    rows = list(csv.reader(io.StringIO(text)))
    if len(rows) < 2:
        raise ValueError("PerfMon CSV must contain headers and sample rows")
    first = rows[0][0] if rows[0] else ""
    pdh_match = re.match(r"^\(PDH-CSV[^)]*\)\s*(?:\(([^)]*(?:Time|UTC)[^)]*)\))?\s*(?:\((-?\d+)\))?", first.strip(), re.I)
    bias = int(pdh_match.group(2)) if pdh_match and pdh_match.group(2) else None
    header_index = 1 if pdh_match and len(rows[0]) == 1 else 0
    headers = [item.strip().lstrip("\ufeff") for item in rows[header_index]]
    time_index = 0 if header_index == 1 or (headers and re.search(r"timestamp|date|time", headers[0], re.I)) else -1
    if time_index < 0:
        raise ValueError("PerfMon CSV has no recognizable time column")
    events = []
    valid_rows = 0
    for line_number, row in enumerate(rows[header_index + 1:], header_index + 2):
        if not row or not any(value.strip() for value in row):
            continue
        timestamp = _parse_time(row[time_index] if time_index < len(row) else "", bias)
        valid_rows += 1
        if timestamp is None:
            continue
        for index, counter in enumerate(headers):
            if index == time_index or index >= len(row):
                continue
            rule = next((entry for entry in COUNTER_RULES if entry[0].search(counter)), None)
            if not rule:
                continue
            try:
                value = float(row[index].strip().replace(",", "."))
            except ValueError:
                continue
            _, category, warning, critical, unit = rule
            if category == "memory.available":
                severity = "critical" if value < critical else "warning" if value < warning else "info"
            else:
                severity = "critical" if value >= critical else "warning" if value >= warning else "info"
            if severity != "info":
                events.append(_event(timestamp, severity, category, f"{counter} observed {value:g}{unit}", {"counter": counter, "value": value, "warningThreshold": warning, "criticalThreshold": critical, "sourceLine": line_number, "sourceFile": source_name}))
    return events, valid_rows


def _diagnostics_xml(data: bytes) -> list[dict]:
    try:
        root = ET.fromstring(data)
    except ET.ParseError as error:
        raise ValueError("System Diagnostics XML is malformed") from error
    events = []
    seen_advice: set[str] = set()
    for element in root.iter():
        label = element.tag.rsplit("}", 1)[-1].lower()
        if label not in {"advice", "recommendation", "issue", "warning", "error", "diagnosis", "diagnostic", "result", "item"}:
            continue
        text = " ".join(" ".join(element.itertext()).split())
        if not text or text in seen_advice:
            continue
        seen_advice.add(text)
        severity = "critical" if re.search(r"critical|fatal", text, re.I) else "error" if re.search(r"error|failed|failure", text, re.I) else "warning" if re.search(r"warning|degraded|problem", text, re.I) else "info"
        events.append(_event(None, severity, "diagnostics", text[:320], {"xmlElement": label, "detail": text[:5000]}))
    loss = re.findall(r"(?:loss|lost events?)[^\d]{0,40}(\d+(?:\.\d+)?)\s*%", " ".join(root.itertext()), re.I)
    for raw in loss:
        value = float(raw)
        severity = "critical" if value > 20 else "error" if value > 5 else "warning" if value > 0 else "info"
        events.append(_event(None, severity, "data-quality", f"ETW event loss measured at {value:g}%", {"metric": "etwLossPercent", "value": value}))
    return events


def _event(timestamp: str | None, severity: str, category: str, summary: str, evidence: dict) -> dict:
    return {"timestamp": timestamp, "source": "DataSnare-AIPerf", "category": category, "severity": severity, "host": "", "process": "", "summary": summary, "detail": summary, "evidence": evidence}
