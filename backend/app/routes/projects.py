from __future__ import annotations

from fastapi import APIRouter

from app.routes.ingest import SUPPORTED_NATIVE_ARTIFACTS


router = APIRouter(prefix="/api/projects", tags=["Projects"])


@router.get("/web-migrations")
async def web_migrations():
    return {
        "schema": "datasnare-core/web-migrations-v1",
        "projects": [
            {
                "project_id": project_id,
                "frontend": "react",
                "backend": "python",
                "status": "contract-ready",
                "artifact_types": sorted(config["artifact_types"]),
                "normalized_schema": config["normalized_schema"],
                "converter": config["converter"],
            }
            for project_id, config in sorted(SUPPORTED_NATIVE_ARTIFACTS.items())
        ],
    }