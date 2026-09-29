from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import re


MAX_PREVIEW_EVENTS = 200
TIMESTAMP_PATTERN = re.compile(r"^\s*(\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?)", re.I)
LEVEL_PATTERN = re.compile(r"\b(CRITICAL|FATAL|ERROR|ERR|WARN(?:ING)?|NOTICE|INFO|DEBUG|TRACE)\b", re.I)


@dataclass(frozen=True)
class LogAnalysis:
    schema: str
    bytes: int
    events: int
    source_encoding: str
    status: str
    parser: str
    message: str
    preview: list[dict]
    severity_counts: dict[str, int]


class TextLogParser:
    async def analyze(self, data: bytes, artifact_name: str) -> LogAnalysis:
        text, encoding = _decode(data)
        preview = []
        severity_counts: dict[str, int] = {}
        event_count = 0
        for line_number, line in enumerate(text.splitlines(), start=1):
            if not line.strip():
                continue
            event_count += 1
            level_match = LEVEL_PATTERN.search(line)
            raw_level = level_match.group(1).upper() if level_match else "INFO"
            severity = "critical" if raw_level in {"CRITICAL", "FATAL"} else "error" if raw_level in {"ERROR", "ERR"} else "warning" if raw_level.startswith("WARN") else "info"
            severity_counts[severity] = severity_counts.get(severity, 0) + 1
            timestamp = _parse_timestamp(line)
            if len(preview) < MAX_PREVIEW_EVENTS:
                message = line.strip()
                preview.append({
                    "timestamp": timestamp,
                    "source": "DataSnare-AILogScope",
                    "category": "log.application",
                    "severity": severity,
                    "host": "",
                    "process": "",
                    "summary": message[:320],
                    "detail": {"message": message, "level": raw_level},
                    "evidence": {"sourceFile": artifact_name, "sourceLine": line_number},
                })
        return LogAnalysis(
            schema="datasnare-ailogscope/events-v1",
            bytes=len(data),
            events=event_count,
            source_encoding=encoding,
            status="completed",
            parser="ailogscope-python-text-parser-v1",
            message=f"Normalized {event_count} non-empty lines; returning up to {MAX_PREVIEW_EVENTS} event samples.",
            preview=preview,
            severity_counts=severity_counts,
        )


def _decode(data: bytes) -> tuple[str, str]:
    for encoding in ("utf-8-sig", "utf-16", "utf-16-le", "utf-16-be"):
        try:
            return data.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace"), "utf-8-replaced"


def _parse_timestamp(line: str) -> str | None:
    match = TIMESTAMP_PATTERN.match(line)
    if not match:
        return None
    value = match.group(1).replace("/", "-").replace(",", ".")
    if re.search(r"[+-]\d{4}$", value):
        value = f"{value[:-5]}{value[-5:-2]}:{value[-2:]}"
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).isoformat().replace("+00:00", "Z")
    except ValueError:
        return None
