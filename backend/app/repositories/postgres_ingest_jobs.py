from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from app.repositories.ingest_jobs import IngestJobRecord, IngestJobState


class PostgresIngestJobRepository:
    """Postgres implementation of tenant-scoped ingest job persistence."""

    def __init__(self, db):
        self.db = db

    async def create(self, record: IngestJobRecord) -> IngestJobRecord:
        row = await self.db.fetchrow(
            """
            INSERT INTO ingest_jobs (
                tenant_id, job_id, tool_id, artifact_name, artifact_type, requested_by,
                schema, state, normalized_schema, native_conversion
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
            RETURNING tenant_id, job_id, tool_id, artifact_name, artifact_type, requested_by,
                      schema, state, created_at, updated_at, normalized_schema, native_conversion
            """,
            record.tenant_id, record.job_id, record.tool_id, record.artifact_name, record.artifact_type,
            record.requested_by, record.schema, record.state, record.normalized_schema,
            _encode_json(record.native_conversion),
        )
        return _record_from_row(row)

    async def list_for_tenant(self, tenant_id: int) -> list[IngestJobRecord]:
        rows = await self.db.fetch(
            """
            SELECT tenant_id, job_id, tool_id, artifact_name, artifact_type, requested_by,
                   schema, state, created_at, updated_at, normalized_schema, native_conversion
            FROM ingest_jobs
            WHERE tenant_id = $1
            ORDER BY created_at DESC, job_id
            """,
            tenant_id,
        )
        return [_record_from_row(row) for row in rows]

    async def get(self, tenant_id: int, job_id: str) -> IngestJobRecord | None:
        row = await self.db.fetchrow(
            """
            SELECT tenant_id, job_id, tool_id, artifact_name, artifact_type, requested_by,
                   schema, state, created_at, updated_at, normalized_schema, native_conversion
            FROM ingest_jobs WHERE tenant_id = $1 AND job_id = $2
            """,
            tenant_id,
            job_id,
        )
        return _record_from_row(row) if row else None

    async def update(self, tenant_id: int, job_id: str, **changes: Any) -> IngestJobRecord | None:
        allowed = {"state", "normalized_schema", "native_conversion"}
        if not changes or set(changes) - allowed:
            raise ValueError("Only state, normalized_schema, and native_conversion can be updated")
        assignments = []
        values: list[Any] = [tenant_id, job_id]
        for key, value in changes.items():
            values.append(_encode_json(value) if key == "native_conversion" else value)
            cast = "::jsonb" if key == "native_conversion" else ""
            assignments.append(f"{key} = ${len(values)}{cast}")
        row = await self.db.fetchrow(
            f"""
            UPDATE ingest_jobs SET {', '.join(assignments)}, updated_at = NOW()
            WHERE tenant_id = $1 AND job_id = $2
            RETURNING tenant_id, job_id, tool_id, artifact_name, artifact_type, requested_by,
                      schema, state, created_at, updated_at, normalized_schema, native_conversion
            """,
            *values,
        )
        return _record_from_row(row) if row else None


def _encode_json(value: Any) -> str | None:
    return json.dumps(value, separators=(",", ":")) if value is not None else None


def _decode_json(value: Any) -> dict | None:
    if value is None:
        return None
    if isinstance(value, str):
        return json.loads(value)
    return dict(value)


def _record_from_row(row: Any) -> IngestJobRecord:
    return IngestJobRecord(
        tenant_id=row["tenant_id"],
        job_id=row["job_id"],
        tool_id=row["tool_id"],
        artifact_name=row["artifact_name"],
        artifact_type=row["artifact_type"],
        requested_by=row["requested_by"],
        schema=row.get("schema") or "datasnare-ingest/job-v1",
        state=row["state"],
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
        normalized_schema=row.get("normalized_schema"),
        native_conversion=_decode_json(row.get("native_conversion")),
    )
