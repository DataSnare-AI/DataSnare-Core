from __future__ import annotations

from typing import Any, Iterable

from app.security.authorization import ActorContext


RESTRICTED_ROLES = {"tenant_admin", "platform_admin"}


def can_read_metadata(actor: ActorContext, metadata: dict[str, Any]) -> bool:
    classification = str(metadata.get("classification", "internal")).lower()
    return classification != "restricted" or actor.role in RESTRICTED_ROLES


def filter_by_policy(actor: ActorContext, documents: Iterable[Any]) -> list[Any]:
    return [document for document in documents if can_read_metadata(actor, getattr(document, "metadata", {}))]
