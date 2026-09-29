from __future__ import annotations

import io
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from scapy.all import ICMP, IP, IPv6, PcapReader, TCP, UDP
from scapy.error import Scapy_Exception


MAX_PACKET_PREVIEW = 250
MAX_CAPTURE_PACKETS = 1_000_000


@dataclass(frozen=True)
class CaptureAnalysis:
    schema: str
    format: str
    bytes: int
    packets: int
    status: str
    parser: str
    message: str
    flows: int
    hosts: int
    protocols: dict[str, int]
    findings: list[dict[str, Any]]
    preview: list[dict[str, Any]]


class CaptureParser:
    async def analyze(self, data: bytes, artifact_name: str) -> CaptureAnalysis:
        raise NotImplementedError


class ScapyCaptureParser(CaptureParser):
    """Decode PCAP/PCAPNG into bounded normalized packet evidence."""

    async def analyze(self, data: bytes, artifact_name: str) -> CaptureAnalysis:
        capture_format = _capture_format(data)
        if capture_format is None:
            raise ValueError("Unsupported or invalid PCAP/PCAPNG header")
        protocols: Counter[str] = Counter()
        hosts: set[str] = set()
        flows: set[tuple[str, str, str]] = set()
        preview: list[dict[str, Any]] = []
        packets_seen = 0
        resets = 0
        try:
            reader = PcapReader(io.BytesIO(data))
            try:
                for packet in reader:
                    packets_seen += 1
                    if packets_seen > MAX_CAPTURE_PACKETS:
                        raise ValueError(f"Capture exceeds the {MAX_CAPTURE_PACKETS:,}-packet staging limit")
                    source, destination = _addresses(packet)
                    transport = "TCP" if TCP in packet else "UDP" if UDP in packet else "ICMP" if ICMP in packet else "Other"
                    source_port = destination_port = 0
                    flags = ""
                    if TCP in packet:
                        source_port, destination_port = int(packet[TCP].sport), int(packet[TCP].dport)
                        flags = str(packet[TCP].flags)
                        resets += int("R" in flags)
                    elif UDP in packet:
                        source_port, destination_port = int(packet[UDP].sport), int(packet[UDP].dport)
                    protocols[transport] += 1
                    hosts.update(address for address in (source, destination) if address)
                    if source and destination and transport in {"TCP", "UDP"}:
                        endpoints = sorted((f"{source}:{source_port}", f"{destination}:{destination_port}"))
                        flows.add((transport, endpoints[0], endpoints[1]))
                    if len(preview) < MAX_PACKET_PREVIEW:
                        detail = f"{transport} {source_port} → {destination_port}" if transport in {"TCP", "UDP"} else packet.summary()
                        if flags:
                            detail += f" [{flags}]"
                        preview.append({
                            "number": packets_seen,
                            "timestamp": _packet_time(packet.time),
                            "source": "DataSnare-AINetScope",
                            "category": f"network.{transport.lower()}",
                            "severity": "warning" if "R" in flags else "info",
                            "host": source,
                            "process": "",
                            "summary": detail[:320],
                            "detail": {"source": source, "destination": destination, "sourcePort": source_port, "destinationPort": destination_port, "flags": flags, "length": len(packet)},
                            "evidence": {"sourceFile": artifact_name, "packetNumber": packets_seen},
                        })
            finally:
                reader.close()
        except (Scapy_Exception, OSError, EOFError) as error:
            raise ValueError(f"Could not decode {capture_format.upper()} capture: {error}") from error
        if packets_seen == 0:
            raise ValueError("Capture contained no packet records")
        findings = []
        if resets:
            findings.append({"id": "tcp-resets", "severity": "medium", "title": "TCP resets observed", "detail": f"{resets} TCP reset packet(s) were observed.", "count": resets})
        return CaptureAnalysis(
            schema="datasnare-ainetscope/analysis-v1", format=capture_format, bytes=len(data), packets=packets_seen,
            status="completed", parser="ainetscope-scapy-python-v1",
            message=f"Decoded {packets_seen:,} packets; returning up to {MAX_PACKET_PREVIEW} packet summaries.",
            flows=len(flows), hosts=len(hosts), protocols=dict(protocols), findings=findings, preview=preview,
        )


def _capture_format(data: bytes) -> str | None:
    if len(data) >= 4 and data[:4] in {b"\x0a\x0d\x0d\x0a"}:
        return "pcapng"
    if len(data) >= 4 and data[:4] in {
        b"\xd4\xc3\xb2\xa1", b"\xa1\xb2\xc3\xd4", b"\x4d\x3c\xb2\xa1", b"\xa1\xb2\x3c\x4d",
    }:
        return "pcap"
    return None


def _addresses(packet) -> tuple[str, str]:
    if IP in packet:
        return str(packet[IP].src), str(packet[IP].dst)
    if IPv6 in packet:
        return str(packet[IPv6].src), str(packet[IPv6].dst)
    return "", ""


def _packet_time(value) -> str | None:
    try:
        return datetime.fromtimestamp(float(value), timezone.utc).isoformat().replace("+00:00", "Z")
    except (TypeError, ValueError, OSError, OverflowError):
        return None
