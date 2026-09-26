from fastapi import FastAPI

from app.repositories.ingest_jobs import InMemoryIngestJobRepository
from app.repositories.partner_connections import InMemoryPartnerConnectionRepository
from app.routes.ingest import router as ingest_router
from app.routes.ninjaone import router as ninjaone_router
from app.routes.rag import router as rag_router


def create_app(*, partner_connections=None, ingest_jobs=None) -> FastAPI:
    app = FastAPI(title="DataSnare-Core API")
    app.state.partner_connections = partner_connections or InMemoryPartnerConnectionRepository()
    app.state.ingest_jobs = ingest_jobs or InMemoryIngestJobRepository()
    app.include_router(ingest_router)
    app.include_router(ninjaone_router)
    app.include_router(rag_router)
    return app


app = create_app()