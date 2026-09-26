from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CaptureAnalysis:
    schema: str
    format: str
    bytes: int
    packets: int
    status: str
    parser: str
    message: str


class CaptureParser:
    async def analyze(self, data: bytes, artifact_name: str) -> CaptureAnalysis:
        raise NotImplementedError


class HeaderCaptureParser(CaptureParser):
    """Safe upload boundary until the full Python packet decoder is deployed."""

    async def analyze(self, data: bytes, artifact_name: str) -> CaptureAnalysis:
        capture_format = _capture_format(data)
        if capture_format is None:
            raise ValueError("Unsupported or invalid PCAP/PCAPNG header")
        return CaptureAnalysis(
            schema="datasnare-ainetscope/analysis-v1",
            format=capture_format,
            bytes=len(data),
            packets=0,
            status="accepted",
            parser="ainetscope-python-parser-planned",
            message="Capture accepted; full packet decoding is pending the Python parser implementation.",
        )


def _capture_format(data: bytes) -> str | None:
    if len(data) >= 4 and data[:4] in {b"\x0a\x0d\x0d\x0a"}:
        return "pcapng"
    if len(data) >= 4 and data[:4] in {
        b"\xd4\xc3\xb2\xa1", b"\xa1\xb2\xc3\xd4", b"\x4d\x3c\xb2\xa1", b"\xa1\xb2\x3c\x4d",
    }:
        return "pcap"
    return None
