from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from typing import Any


ANALYSIS_SCHEMA = "datasnare-ainetscope/analysis-v1"
MAX_EXPORTED_EVENTS = 10_000


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
    if not isinstance(document, dict) or document.get("schema") != ANALYSIS_SCHEMA:
        raise ValueError(f"AINetScope import requires schema {ANALYSIS_SCHEMA}")

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