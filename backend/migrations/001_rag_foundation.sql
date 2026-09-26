-- DataSnare-Core RAG foundation schema.
-- Requires PostgreSQL with the pgvector extension available.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS knowledge_items (
    tenant_id BIGINT NOT NULL,
    item_id TEXT NOT NULL,
    item_type TEXT NOT NULL,
    title TEXT,
    content TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_name TEXT,
    agent_id TEXT,
    site_id TEXT,
    area_id TEXT,
    observed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_items_scope
    ON knowledge_items (tenant_id, site_id, area_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_items_source
    ON knowledge_items (tenant_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_items_metadata
    ON knowledge_items USING GIN (metadata);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
    tenant_id BIGINT NOT NULL,
    chunk_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    start_offset INTEGER NOT NULL,
    end_offset INTEGER NOT NULL,
    embedding_model TEXT,
    embedding VECTOR(128),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, chunk_id),
    FOREIGN KEY (tenant_id, item_id) REFERENCES knowledge_items (tenant_id, item_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_item
    ON knowledge_chunks (tenant_id, item_id, chunk_index);

CREATE TABLE IF NOT EXISTS rag_agent_manifests (
    tenant_id BIGINT NOT NULL,
    agent_id TEXT NOT NULL,
    system_name TEXT NOT NULL,
    site_id TEXT,
    area_id TEXT,
    capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
    knowledge_types JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'unknown',
    last_seen_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, agent_id)
);

CREATE TABLE IF NOT EXISTS knowledge_graph_edges (
    tenant_id BIGINT NOT NULL,
    edge_id TEXT NOT NULL,
    subject_type TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    predicate TEXT NOT NULL,
    object_type TEXT NOT NULL,
    object_id TEXT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (tenant_id, edge_id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_graph_subject
    ON knowledge_graph_edges (tenant_id, subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_graph_object
    ON knowledge_graph_edges (tenant_id, object_type, object_id);

CREATE TABLE IF NOT EXISTS retrieval_audit_events (
    tenant_id BIGINT NOT NULL,
    event_id TEXT NOT NULL,
    retrieval_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    status TEXT NOT NULL,
    routed_agent_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_retrieval_audit_lookup
    ON retrieval_audit_events (tenant_id, created_at DESC);
