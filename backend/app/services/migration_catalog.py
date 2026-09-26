from __future__ import annotations

from pathlib import Path


MIGRATION_DIRECTORY = Path(__file__).resolve().parents[2] / "migrations"


def available_migrations() -> list[Path]:
    """Return ordered SQL migrations without executing them from application startup."""
    return sorted(MIGRATION_DIRECTORY.glob("*.sql"))
