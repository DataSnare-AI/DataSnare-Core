from __future__ import annotations

import csv
import io
import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import re
from typing import Any

import yaml
from pypdf import PdfReader


MAX_PREVIEW_EVENTS = 200
MAX_INDEX_TEXT = 500_000
MAX_PDF_PAGES = 100
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
    knowledge_text: str


class TextLogParser:
    async def analyze(self, data: bytes, artifact_name: str) -> LogAnalysis:
        extension = Path(artifact_name).suffix.lower()
        if extension == ".pdf":
            text, encoding, parser_name = _decode_pdf(data), "binary/pdf", "ailogscope-pdf-python-v1"
            records = _text_records(text)
        elif extension in {".json", ".jsonl", ".ndjson"}:
            text, encoding = _decode(data)
            records = _json_records(text, extension)
            parser_name = "ailogscope-json-python-v1"
        elif extension in {".yaml", ".yml"}:
            text, encoding = _decode(data)
            records = _structured_records(yaml.safe_load(text))
            parser_name = "ailogscope-yaml-python-v1"
        elif extension == ".csv":
            text, encoding = _decode(data)
            records = _csv_records(text)
            parser_name = "ailogscope-csv-python-v1"
        else:
            text, encoding = _decode(data)
            records = _text_records(text)
            parser_name = "ailogscope-python-text-parser-v1"

        preview: list[dict] = []
        severity_counts: dict[str, int] = {}
        knowledge_lines: list[str] = []
        knowledge_size = 0
        for source_line, raw, record in records:
            message = _record_message(record, raw)
            raw_level = str(record.get("severity") or record.get("level") or record.get("levelDisplayName") or "")
            level_match = LEVEL_PATTERN.search(f"{raw_level} {raw}")
            normalized_level = level_match.group(1).upper() if level_match else "INFO"
            severity = _severity(normalized_level)
            severity_counts[severity] = severity_counts.get(severity, 0) + 1
            timestamp = _parse_timestamp(record.get("timestamp") or record.get("timestampUtc") or record.get("timeCreated") or record.get("time") or raw)
            if len(preview) < MAX_PREVIEW_EVENTS:
                preview.append({
                    "timestamp": timestamp,
                    "source": "DataSnare-AILogScope",
                    "category": str(record.get("category") or record.get("channel") or "log.application"),
                    "severity": severity,
                    "host": str(record.get("host") or record.get("computer") or ""),
                    "process": str(record.get("process") or record.get("processName") or ""),
                    "summary": message[:320],
                    "detail": {"message": message, "record": record or None},
                    "evidence": {"sourceFile": artifact_name, "sourceLine": source_line},
                })
            if knowledge_size < MAX_INDEX_TEXT:
                addition = f"{timestamp or ''} {severity.upper()} {message}".strip()[:MAX_INDEX_TEXT - knowledge_size]
                knowledge_lines.append(addition)
                knowledge_size += len(addition) + 1
        event_count = len(records)
        return LogAnalysis(
            schema="datasnare-ailogscope/events-v1",
            bytes=len(data),
            events=event_count,
            source_encoding=encoding,
            status="completed",
            parser=parser_name,
            message=f"Normalized {event_count} records; returning up to {MAX_PREVIEW_EVENTS} event samples.",
            preview=preview,
            severity_counts=severity_counts,
            knowledge_text="\n".join(knowledge_lines),
        )


def _decode(data: bytes) -> tuple[str, str]:
    for encoding in ("utf-8-sig", "utf-16", "utf-16-le", "utf-16-be"):
        try:
            return data.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace"), "utf-8-replaced"


def _parse_timestamp(value: Any) -> str | None:
    if value in (None, ""):
        return None
    text = str(value).strip()
    match = TIMESTAMP_PATTERN.match(text)
    normalized = (match.group(1) if match else text).replace("/", "-").replace(",", ".")
    if re.search(r"[+-]\d{4}$", normalized):
        normalized = f"{normalized[:-5]}{normalized[-5:-2]}:{normalized[-2:]}"
    try:
        return datetime.fromisoformat(normalized.replace("Z", "+00:00")).isoformat().replace("+00:00", "Z")
    except ValueError:
        return None


def _decode_pdf(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data), strict=False)
    return "\n".join(page.extract_text() or "" for page in reader.pages[:MAX_PDF_PAGES])


def _json_records(text: str, extension: str) -> list[tuple[int, str, dict[str, Any]]]:
    if extension in {".jsonl", ".ndjson"}:
        records = []
        for line_number, line in enumerate(text.splitlines(), 1):
            if line.strip():
                value = json.loads(line)
                records.append((line_number, line, value if isinstance(value, dict) else {"message": str(value)}))
        return records
    return _structured_records(json.loads(text))


def _structured_records(value: Any) -> list[tuple[int, str, dict[str, Any]]]:
    if isinstance(value, dict):
        rows = value.get("events") or value.get("records") or value.get("items")
        if rows is None:
            rows = [value]
    else:
        rows = value if isinstance(value, list) else [value]
    return [(index, json.dumps(row, ensure_ascii=False, default=str), row if isinstance(row, dict) else {"message": str(row)}) for index, row in enumerate(rows, 1)]


def _csv_records(text: str) -> list[tuple[int, str, dict[str, Any]]]:
    return [(index, json.dumps(row, ensure_ascii=False), row) for index, row in enumerate(csv.DictReader(io.StringIO(text)), 2)]


def _text_records(text: str) -> list[tuple[int, str, dict[str, Any]]]:
    return [(index, line, {}) for index, line in enumerate(text.splitlines(), 1) if line.strip()]


def _record_message(record: dict[str, Any], raw: str) -> str:
    for key in ("message", "summary", "renderedMessage", "description", "eventData", "detail"):
        value = record.get(key)
        if value not in (None, ""):
            return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    return raw.strip()


def _severity(value: Any) -> str:
    text = str(value or "").upper()
    if re.search(r"\b(CRITICAL|FATAL)\b", text):
        return "critical"
    if re.search(r"\b(ERROR|ERR)\b", text):
        return "error"
    if re.search(r"\b(WARN(?:ING)?)\b", text):
        return "warning"
    return "info"
