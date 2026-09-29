from fastapi import FastAPI

from app.repositories.ingest_jobs import InMemoryIngestJobRepository
from app.repositories.postgres_ingest_jobs import PostgresIngestJobRepository
from app.repositories.knowledge_items import InMemoryKnowledgeItemRepository
from app.repositories.agent_manifests import InMemoryAgentManifestRepository
from app.repositories.retrieval_audit import InMemoryRetrievalAuditRepository
from app.repositories.knowledge_graph import InMemoryKnowledgeGraphRepository
from app.repositories.site_cache import InMemorySiteQueryCache
from app.services.embeddings import LocalHashEmbeddingProvider
from app.services.vector_store import InMemoryVectorStore
from app.services.ainetscope_parser import ScapyCaptureParser
from app.services.ailogscope_parser import TextLogParser
from app.services.aiperf_parser import PerformanceParser
from app.services.aiprocmon_parser import ProcMonParser
from app.repositories.postgres_knowledge_items import PostgresKnowledgeItemRepository
from app.services.postgres_vector_store import PostgresVectorStore
from app.repositories.partner_connections import InMemoryPartnerConnectionRepository
from app.routes.ingest import router as ingest_router
from app.routes.ninjaone import router as ninjaone_router
from app.routes.rag import router as rag_router
from app.routes.knowledge import router as knowledge_router
from app.routes.agent_manifests import router as agent_manifests_router
from app.routes.knowledge_graph import router as knowledge_graph_router
from app.routes.projects import router as projects_router
from app.routes.ainetscope import router as ainetscope_router
from app.routes.ailogscope import router as ailogscope_router
from app.routes.tool_jobs import router as tool_jobs_router
from app.routes.health import router as health_router


def create_app(*, partner_connections=None, ingest_jobs=None, knowledge_items=None, embedding_provider=None, vector_store=None, agent_manifests=None, retrieval_audit=None, knowledge_graph=None, site_cache=None, capture_parser=None, log_parser=None, aiperf_parser=None, aiprocmon_parser=None, database_pool=None, auth_provider=None) -> FastAPI:
    app = FastAPI(title="DataSnare-Core API")
    app.state.database_pool = database_pool
    app.state.auth_provider = auth_provider
    app.state.partner_connections = partner_connections or InMemoryPartnerConnectionRepository()
    app.state.ingest_jobs = ingest_jobs or (PostgresIngestJobRepository(database_pool) if database_pool is not None else InMemoryIngestJobRepository())
    app.state.knowledge_items = knowledge_items or (PostgresKnowledgeItemRepository(database_pool) if database_pool is not None else InMemoryKnowledgeItemRepository())
    app.state.embedding_provider = embedding_provider or LocalHashEmbeddingProvider()
    app.state.vector_store = vector_store or (PostgresVectorStore(database_pool) if database_pool is not None else InMemoryVectorStore())
    app.state.agent_manifests = agent_manifests or InMemoryAgentManifestRepository()
    app.state.retrieval_audit = retrieval_audit or InMemoryRetrievalAuditRepository()
    app.state.knowledge_graph = knowledge_graph or InMemoryKnowledgeGraphRepository()
    app.state.site_cache = site_cache or InMemorySiteQueryCache()
    app.state.capture_parser = capture_parser or ScapyCaptureParser()
    app.state.log_parser = log_parser or TextLogParser()
    app.state.aiperf_parser = aiperf_parser or PerformanceParser()
    app.state.aiprocmon_parser = aiprocmon_parser or ProcMonParser()
    app.include_router(ingest_router)
    app.include_router(ninjaone_router)
    app.include_router(rag_router)
    app.include_router(knowledge_router)
    app.include_router(agent_manifests_router)
    app.include_router(knowledge_graph_router)
    app.include_router(projects_router)
    app.include_router(ainetscope_router)
    app.include_router(ailogscope_router)
    app.include_router(tool_jobs_router)
    app.include_router(health_router)
    return app


app = create_app()