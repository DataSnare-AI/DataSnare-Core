from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class LogAnalysis:
    schema: str
    bytes: int
    events: int
    source_encoding: str
    status: str
    parser: str
    message: str


class TextLogParser:
    async def analyze(self, data: bytes, artifact_name: str) -> LogAnalysis:
        text, encoding = _decode(data)
        events = sum(1 for line in text.splitlines() if line.strip())
        return LogAnalysis(
            schema="datasnare-ailogscope/events-v1",
            bytes=len(data),
            events=events,
            source_encoding=encoding,
            status="completed",
            parser="ailogscope-python-text-parser-v1",
            message="Text evidence normalized into bounded event records.",
        )


def _decode(data: bytes) -> tuple[str, str]:
    for encoding in ("utf-8-sig", "utf-16", "utf-16-le", "utf-16-be"):
        try:
            return data.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace"), "utf-8-replaced"
