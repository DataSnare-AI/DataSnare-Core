from __future__ import annotations

import json
import math
from datetime import datetime, timezone


EXPORT_SCHEMAS = {"aiprocmon": "datasnare-aiprocmon/events-v1", "aiperf": "datasnare-aiperf/events-v1"}


def _text(value, maximum=320):
    return value.strip()[:maximum] if isinstance(value, str) else ""


def _time(value):
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        try:
            if not math.isfinite(value):
                return None
            seconds = value / 1000 if value > 1_000_000_000_000 else value
            return datetime.fromtimestamp(seconds, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        except (ValueError, OverflowError, OSError):
            return None
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.utcoffset() is None:
            return None
        return parsed.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    except ValueError:
        return None


def _severity(value):
    return {"high": "error", "medium": "warning", "low": "info", "fatal": "critical", "warn": "warning"}.get(
        value, value if value in {"critical", "error", "warning", "info"} else "info"
    ) if isinstance(value, str) else "info"


def analyze_native_export(content, artifact_name, tool_id):
    try:
        document = json.loads(content.decode("utf-8-sig"))
    except (UnicodeError, ValueError, RecursionError) as error:
        raise ValueError("Analysis export must be valid UTF-8 JSON") from error
    schema = EXPORT_SCHEMAS[tool_id]
    if not isinstance(document, dict) or document.get("schema") != schema:
        raise ValueError(f"Analysis import requires schema {schema}")
    rows = document.get("events", []) if tool_id == "aiperf" else document.get("salientEvents", [])
    findings = document.get("findings", [])
    source = document.get("source", {})
    summary = document.get("summary", {})
    if not isinstance(source, dict) or not isinstance(summary, dict):
        raise ValueError("Analysis source and summary must be objects")
    if not isinstance(rows, list) or not isinstance(findings, list):
        raise ValueError("Analysis events and findings must be arrays")
    if len(rows) + len(findings) > 10_000:
        raise ValueError("Analysis exports are limited to 10000 events and findings")
    if not all(isinstance(row, dict) for row in [*rows, *findings]):
        raise ValueError("Analysis events and findings must contain objects")
    source_name = _text(source.get("name"), 240) or artifact_name[:240]
    normalized_findings = []
    events = []
    for row in findings:
        title = _text(row.get("title") or row.get("summary")) or "Analyzer finding"
        detail = _text(row.get("detail"), 1000)
        severity = _severity(row.get("severity"))
        normalized_findings.append({"title": title, "detail": detail, "severity": severity})
        events.append({
            "timestamp": _time(row.get("timestamp")),
            "severity": severity, "category": _text(row.get("category"), 120) or "procmon.finding",
            "summary": title, "detail": detail,
            "process": _text(row.get("process"), 120) or None,
            "evidence": {"sourceFile": source_name},
        })
    for row in rows:
        source_evidence = row.get("evidence") if isinstance(row.get("evidence"), dict) else {}
        evidence = {"sourceFile": _text(source_evidence.get("file"), 240) or source_name}
        source_line = source_evidence.get("sourceLine", row.get("row", row.get("rowNumber")))
        if isinstance(source_line, int) and not isinstance(source_line, bool) and source_line >= 0:
            evidence["sourceLine"] = source_line
        for field in ("counter", "threshold", "direction", "observed", "sampleCount", "start", "end", "metric", "value", "xmlElement", "ordinal"):
            value = source_evidence.get(field)
            if isinstance(value, str):
                evidence[field] = value[:320]
            elif isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
                evidence[field] = value
        result = _text(row.get("result"), 120)
        severity = row.get("severity")
        if tool_id == "aiprocmon" and not severity:
            severity = "info" if result in {"SUCCESS", "REPARSE", "NO MORE FILES", "NO MORE ENTRIES", "END OF FILE"} else "warning"
        events.append({
            "timestamp": _time(row.get("timestamp")),
            "severity": _severity(severity),
            "category": _text(row.get("category"), 120) or ("performance" if tool_id == "aiperf" else "procmon.event"),
            "host": _text(row.get("host"), 120) or None,
            "process": _text(row.get("process"), 120) or None,
            "summary": _text(row.get("summary")) or f"{_text(row.get('operation'), 120) or 'ProcMon event'}: {result}"[:320],
            "detail": _text(row.get("detail"), 1000) or None, "evidence": evidence,
        })
    return {"schema": schema, "parser": f"{tool_id}-analysis-export-v1", "event_count": len(events),
            "events": events, "findings": normalized_findings, "message": f"Imported {len(events)} normalized events."}