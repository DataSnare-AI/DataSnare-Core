from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from typing import Any


INVESTIGATION_SCHEMA = "datasnare-rootcause/investigation-v1"
MAX_EVENTS = 10_000
REPORT_FIELDS = {
    "problemStatement": "Problem statement",
    "hypothesis": "Hypothesis",
    "rootCause": "Root cause",
    "actions": "Actions",
}


def _text(value: Any, limit: int = 320) -> str:
    if isinstance(value, str):
        return value.strip()[:limit]
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)[:limit]
    return ""


def _timestamp(value: Any) -> str | None:
    try:
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            if not math.isfinite(value):
                return None
            seconds = value / 1000 if value > 1_000_000_000_000 else value
            parsed = datetime.fromtimestamp(seconds, tz=timezone.utc)
        elif isinstance(value, str) and value.strip():
            parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
            if parsed.utcoffset() is None:
                return None
            parsed = parsed.astimezone(timezone.utc)
        else:
            return None
    except (OverflowError, OSError, TypeError, ValueError):
        return None
    return parsed.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _severity(value: Any) -> str:
    normalized = _text(value, 32).lower()
    return {
        "fatal": "critical",
        "critical": "critical",
        "error": "error",
        "warn": "warning",
        "warning": "warning",
        "info": "info",
    }.get(normalized, "info")


def _flat_detail(value: Any) -> Any:
    if isinstance(value, str):
        return value[:1000]
    if not isinstance(value, dict):
        return None
    detail = {}
    for key, item in list(value.items())[:20]:
        name = _text(key, 80)
        if isinstance(item, str):
            detail[name] = item[:500]
        elif isinstance(item, (int, float, bool)) or item is None:
            detail[name] = item
    return detail or None


def analyze_rootcause_investigation(content: bytes, artifact_name: str) -> dict[str, Any]:
    try:
        document = json.loads(content.decode("utf-8-sig"))
    except (RecursionError, UnicodeError, ValueError) as error:
        raise ValueError("AIRootCause import must be a valid UTF-8 JSON investigation export") from error
    if not isinstance(document, dict) or document.get("schema") != INVESTIGATION_SCHEMA:
        raise ValueError(f"AIRootCause import requires schema {INVESTIGATION_SCHEMA}")

    source_rows = document.get("sources") or []
    event_rows = document.get("events")
    if not isinstance(source_rows, list) or not isinstance(event_rows, list):
        raise ValueError("AIRootCause export must contain sources and events arrays")
    if len(event_rows) > MAX_EVENTS:
        raise ValueError(f"AIRootCause exports are limited to {MAX_EVENTS} events")

    sources = {
        _text(source.get("id"), 128): _text(source.get("name"), 240)
        for source in source_rows
        if isinstance(source, dict) and _text(source.get("id"), 128)
    }
    events = []
    for row in event_rows:
        if not isinstance(row, dict):
            raise ValueError("AIRootCause events must be JSON objects")
        source_id = _text(row.get("sourceId"), 128)
        source_name = sources.get(source_id) or _text(row.get("source"), 240) or artifact_name[:240]
        summary = _text(row.get("summary")) or _text(row.get("category")) or "AIRootCause event"
        source_evidence = row.get("evidence") if isinstance(row.get("evidence"), dict) else {}
        evidence = {"sourceFile": source_name}
        source_line = source_evidence.get("sourceLine")
        if isinstance(source_line, int) and not isinstance(source_line, bool) and source_line >= 0:
            evidence["sourceLine"] = source_line
        packet_number = source_evidence.get("packetNumber", source_evidence.get("frame"))
        if isinstance(packet_number, int) and not isinstance(packet_number, bool) and packet_number >= 0:
            evidence["packetNumber"] = packet_number
        events.append({
            "timestamp": _timestamp(row.get("timestamp")),
            "severity": _severity(row.get("severity")),
            "category": _text(row.get("category"), 120) or "rootcause.event",
            "host": _text(row.get("host"), 120) or None,
            "process": _text(row.get("process"), 120) or None,
            "summary": summary,
            "detail": _flat_detail(row.get("detail")),
            "evidence": evidence,
        })

    report = document.get("report") or {}
    if not isinstance(report, dict):
        raise ValueError("AIRootCause report must be a JSON object")
    findings = [
        {"title": title, "detail": _text(report.get(field), 4000), "category": field}
        for field, title in REPORT_FIELDS.items()
        if _text(report.get(field), 4000)
    ]
    return {
        "schema": INVESTIGATION_SCHEMA,
        "parser": "airca-investigation-json-v1",
        "event_count": len(events),
        "events": events,
        "findings": findings,
        "source_count": len(sources),
        "investigation_name": _text(document.get("name"), 200),
    }