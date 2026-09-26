from __future__ import annotations

import os

from fastapi import APIRouter, Request

from app.routes.ingest import SUPPORTED_NATIVE_ARTIFACTS
from app.services.migration_catalog import available_migrations


router = APIRouter(prefix="/api/health", tags=["Health"])


@router.get("/readiness")
async def readiness(request: Request):
    production = os.getenv("DATASNARE_ENV", "development").lower() == "production"
    storage_mode = "postgres" if getattr(request.app.state, "database_pool", None) is not None else "in-memory"
    auth_mode = "configured-provider" if getattr(request.app.state, "auth_provider", None) is not None else "development-headers"
    checks = {
        "migration_catalog": bool(available_migrations()),
        "tenant_authentication": auth_mode == "configured-provider" or not production,
        "persistent_storage": storage_mode == "postgres" or not production,
        "tool_contracts": set(SUPPORTED_NATIVE_ARTIFACTS) == {"ailogscope", "aiperf", "aiprocmon", "ainetscope"},
    }
    ready = all(checks.values())
    return {
        "schema": "datasnare-core/readiness-v1",
        "status": "ready" if ready else "not_ready",
        "environment": "production" if production else "development",
        "auth_mode": auth_mode,
        "storage_mode": storage_mode,
        "checks": checks,
        "migration_count": len(available_migrations()),
        "tool_count": len(SUPPORTED_NATIVE_ARTIFACTS),
    }
