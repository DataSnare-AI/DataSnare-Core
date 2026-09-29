import asyncio
import pathlib
import sys
from datetime import datetime, timezone


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.repositories.ingest_jobs import IngestJobRecord
from app.repositories.postgres_ingest_jobs import PostgresIngestJobRepository


class FakeDb:
    def __init__(self):
        self.calls = []
        self.row = None

    async def fetchrow(self, query, *args):
        self.calls.append((query, args))
        return self.row

    async def fetch(self, query, *args):
        self.calls.append((query, args))
        return [self.row] if self.row else []


def test_postgres_ingest_jobs_persist_state_and_result_metadata():
    async def scenario():
        db = FakeDb()
        repository = PostgresIngestJobRepository(db)
        now = datetime.now(timezone.utc)
        record = IngestJobRecord(tenant_id=7, tool_id="ailogscope", artifact_name="service.log", artifact_type="log", requested_by="operator")
        db.row = {"tenant_id": 7, "job_id": record.job_id, "tool_id": "ailogscope", "artifact_name": "service.log", "artifact_type": "log", "requested_by": "operator", "schema": record.schema, "state": "queued", "created_at": now, "updated_at": now, "normalized_schema": "datasnare-ailogscope/events-v1", "native_conversion": {"status": "queued"}}

        created = await repository.create(record)
        assert created.job_id == record.job_id
        assert 'INSERT INTO ingest_jobs' in db.calls[-1][0]

        db.row = {**db.row, "state": "completed", "native_conversion": '{"status":"completed","event_count":12}'}
        updated = await repository.update(7, record.job_id, state="completed", native_conversion={"status": "completed", "event_count": 12})
        assert updated.state == "completed"
        assert updated.native_conversion["event_count"] == 12
        assert 'UPDATE ingest_jobs SET state = $3, native_conversion = $4::jsonb' in db.calls[-1][0]

        fetched = await repository.get(7, record.job_id)
        assert fetched.tenant_id == 7
        assert fetched.updated_at == now
        listed = await repository.list_for_tenant(7)
        assert len(listed) == 1

    asyncio.run(scenario())
