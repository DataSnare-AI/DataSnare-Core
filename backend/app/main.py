from fastapi import FastAPI

from app.repositories.ingest_jobs import InMemoryIngestJobRepository
from app.repositories.knowledge_items import InMemoryKnowledgeItemRepository
from app.repositories.agent_manifests import InMemoryAgentManifestRepository
from app.repositories.retrieval_audit import InMemoryRetrievalAuditRepository
from app.repositories.knowledge_graph import InMemoryKnowledgeGraphRepository
from app.repositories.site_cache import InMemorySiteQueryCache
from app.services.embeddings import LocalHashEmbeddingProvider
from app.services.vector_store import InMemoryVectorStore
from app.repositories.partner_connections import InMemoryPartnerConnectionRepository
from app.routes.ingest import router as ingest_router
from app.routes.ninjaone import router as ninjaone_router
from app.routes.rag import router as rag_router
from app.routes.knowledge import router as knowledge_router
from app.routes.agent_manifests import router as agent_manifests_router
from app.routes.knowledge_graph import router as knowledge_graph_router
from app.routes.projects import router as projects_router


def create_app(*, partner_connections=None, ingest_jobs=None, knowledge_items=None, embedding_provider=None, vector_store=None, agent_manifests=None, retrieval_audit=None, knowledge_graph=None, site_cache=None) -> FastAPI:
    app = FastAPI(title="DataSnare-Core API")
    app.state.partner_connections = partner_connections or InMemoryPartnerConnectionRepository()
    app.state.ingest_jobs = ingest_jobs or InMemoryIngestJobRepository()
    app.state.knowledge_items = knowledge_items or InMemoryKnowledgeItemRepository()
    app.state.embedding_provider = embedding_provider or LocalHashEmbeddingProvider()
    app.state.vector_store = vector_store or InMemoryVectorStore()
    app.state.agent_manifests = agent_manifests or InMemoryAgentManifestRepository()
    app.state.retrieval_audit = retrieval_audit or InMemoryRetrievalAuditRepository()
    app.state.knowledge_graph = knowledge_graph or InMemoryKnowledgeGraphRepository()
    app.state.site_cache = site_cache or InMemorySiteQueryCache()
    app.include_router(ingest_router)
    app.include_router(ninjaone_router)
    app.include_router(rag_router)
    app.include_router(knowledge_router)
    app.include_router(agent_manifests_router)
    app.include_router(knowledge_graph_router)
    app.include_router(projects_router)
    return app


app = create_app()