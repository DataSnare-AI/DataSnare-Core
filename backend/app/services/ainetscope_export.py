from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from typing import Any


ANALYSIS_SCHEMA = "datasnare-ainetscope/analysis-v1"
TWO_SIDED_SCHEMA = "datasnare-ainetscope/two-sided-findings-v1"
MAX_EXPORTED_EVENTS = 10_000


def _bounded_analytics(value, depth=0):
    if depth > 6:
        return None
    if isinstance(value, str):
        return value[:1000]
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value if math.isfinite(value) else None
    if isinstance(value, list):
        return [_bounded_analytics(item, depth + 1) for item in value[:100]]
    if isinstance(value, dict):
        return {str(key)[:80]: _bounded_analytics(item, depth + 1) for key, item in list(value.items())[:50]}
    return None


def _analyze_two_sided(document, artifact_name):
    findings = document.get("findings")
    if not isinstance(findings, list) or not all(isinstance(row, dict) for row in findings):
        raise ValueError("Two-Sided findings must be an array of objects")
    if len(findings) > 1000:
        raise ValueError("Two-Sided exports are limited to 1000 findings")
    analytics = {key: _bounded_analytics(document.get(key)) for key in ("scope", "metrics", "sources", "caveats")}
    if not isinstance(analytics["scope"], dict) or not isinstance(analytics["metrics"], dict):
        raise ValueError("Two-Sided exports require scope and metrics objects")
    events = []
    safe_findings = []
    for row in findings:
        source = row.get("evidence") if isinstance(row.get("evidence"), dict) else {}
        evidence = {"sourceFile": _text(source.get("sourceFile"), 240) or artifact_name[:240]}
        for key in ("sourceA", "sourceB"):
            if isinstance(source.get(key), str):
                evidence[key] = source[key][:240]
        for key in ("frameA", "frameB", "packetNumber", "bOffsetMs"):
            value = source.get(key)
            if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
                evidence[key] = value
        summary = _text(row.get("title") or row.get("summary")) or "Two-Sided finding"
        detail = _text(row.get("detail"), 1000)
        event = {"timestamp": _timestamp(row.get("timestamp")), "severity": _severity(row.get("severity")),
                 "category": _text(row.get("category"), 120) or "network.two-sided",
                 "summary": summary, "detail": detail, "evidence": evidence}
        events.append(event)
        safe_findings.append({"title": summary, "detail": detail, "severity": event["severity"],
                              "timestamp": event["timestamp"], "evidence": evidence, "metrics": _bounded_analytics(row.get("metrics"))})
    return {"schema": TWO_SIDED_SCHEMA, "parser": "ainetscope-two-sided-findings-v1", "status": "completed",
            "event_count": len(events), "preview": events, "findings": safe_findings, "analytics": analytics,
            "packets": None, "flows": 0, "hosts": None, "bytes": None, "protocols": {}, "service_count": 0,
            "source_artifact_name": artifact_name, "message": f"Imported {len(events)} Two-Sided findings with bounded analytics context."}


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
    return {
        "critical": "critical",
        "high": "critical",
        "error": "error",
        "medium": "warning",
        "warn": "warning",
        "warning": "warning",
        "low": "info",
        "info": "info",
    }.get(_text(value, 24).lower(), "info")


def _finding(row: dict[str, Any], fallback_time: Any) -> dict[str, Any]:
    packet = row.get("packet")
    evidence = {"sourceFile": ""}
    if isinstance(packet, int) and not isinstance(packet, bool) and packet >= 0:
        evidence["packetNumber"] = packet
    return {
        "timestamp": _timestamp(row.get("timestamp") or fallback_time),
        "severity": _severity(row.get("severity")),
        "category": "network.finding",
        "host": _text(row.get("host"), 120) or None,
        "process": None,
        "summary": _text(row.get("title")) or "AINetScope finding",
        "detail": _text(row.get("detail"), 1000) or None,
        "evidence": evidence,
    }


def analyze_ainetscope_export(content: bytes, artifact_name: str) -> dict[str, Any]:
    try:
        document = json.loads(content.decode("utf-8-sig"))
    except (RecursionError, UnicodeError, ValueError) as error:
        raise ValueError("AINetScope import must be a valid UTF-8 JSON analysis export") from error
    if isinstance(document, dict) and document.get("schema") == TWO_SIDED_SCHEMA:
        return _analyze_two_sided(document, artifact_name)
    if not isinstance(document, dict) or document.get("schema") != ANALYSIS_SCHEMA:
        raise ValueError(f"AINetScope import requires schema {ANALYSIS_SCHEMA} or {TWO_SIDED_SCHEMA}")

    capture = document.get("capture", {})
    if not isinstance(capture, dict):
        raise ValueError("AINetScope capture summary must be a JSON object")
    flows = document.get("flows", [])
    findings = document.get("findings", [])
    services = document.get("services", [])
    if not all(isinstance(rows, list) for rows in (flows, findings, services)):
        raise ValueError("AINetScope flows, findings, and services must be JSON arrays")
    if len(flows) + len(findings) > MAX_EXPORTED_EVENTS:
        raise ValueError(f"AINetScope exports are limited to {MAX_EXPORTED_EVENTS} flow and finding events")
    if not all(isinstance(row, dict) for row in [*flows, *findings]):
        raise ValueError("AINetScope flows and findings must be JSON objects")

    fallback_time = document.get("generatedAt") or capture.get("start")
    safe_findings = []
    events = []
    for row in findings:
        normalized = _finding(row, fallback_time)
        events.append({**normalized, "evidence": {**normalized["evidence"], "sourceFile": artifact_name[:240]}})
        safe_findings.append({
            "title": normalized["summary"],
            "detail": normalized["detail"] or "",
            "severity": normalized["severity"],
            "packet": normalized["evidence"].get("packetNumber"),
        })

    for row in flows:
        protocol = _text(row.get("protocol"), 24).upper() or "NETWORK"
        endpoint_a = _text(row.get("a"), 120) or "unknown"
        endpoint_b = _text(row.get("b"), 120) or "unknown"
        flow_key = _text(row.get("key"), 160)
        detail = {}
        for field in ("packets", "bytes", "latencyValue", "state", "duration", "resets", "retransmissions"):
            value = row.get(field)
            if isinstance(value, (str, int, float, bool)):
                detail[field] = value[:240] if isinstance(value, str) else value
        events.append({
            "timestamp": _timestamp(row.get("first") or fallback_time),
            "severity": "warning" if row.get("resets") or row.get("state") == "Handshake failed" else "info",
            "category": f"network.flow.{protocol.lower()}",
            "host": None,
            "process": None,
            "summary": f"{protocol} {endpoint_a} <-> {endpoint_b}"[:320],
            "detail": detail or None,
            "evidence": {"sourceFile": artifact_name[:240], **({"flow": flow_key} if flow_key else {})},
        })

    summary = {
        "parser": "ainetscope-analysis-export-v1",
        "status": "completed",
        "event_count": len(events),
        "packets": capture.get("packets") if isinstance(capture.get("packets"), int) else None,
        "flows": len(flows),
        "hosts": capture.get("hosts") if isinstance(capture.get("hosts"), int) else None,
        "bytes": capture.get("bytes") if isinstance(capture.get("bytes"), int) else None,
        "protocols": {},
        "findings": safe_findings,
        "preview": events,
        "message": f"Imported {len(events)} events from the AINetScope analysis export.",
        "source_artifact_name": _text(capture.get("name"), 240) or artifact_name[:240],
        "service_count": len(services),
    }
    return summary