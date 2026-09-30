import pathlib
import sys

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
SCRIPT_DIR = BACKEND_DIR / "scripts"
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from import_aiops_accounts import (
    IDENTITY_ISSUER,
    connection_error_message,
    endpoint_summary,
    prepare_snapshot,
)
import socket


def test_import_snapshot_preserves_hashes_and_never_selects_plaintext_passwords():
    password_hash = "$2b$12$existing-bcrypt-hash-value"
    snapshot = prepare_snapshot(
        tenant_rows=[{"tenant_id": 12, "tenant_name": "acme", "display_name": "Acme", "plan_key": "growth"}],
        plan_rows=[{"plan_key": "growth", "display_name": "Growth", "max_users": 50, "max_systems": 250, "is_active": True}],
        membership_rows=[{"tenant_id": 12, "username": "alice", "role_key": "operator"}],
        user_rows=[{"username": "alice", "password_hash": password_hash, "actor_name": "Alice", "email": "alice@example.test", "role": "operator", "is_active": True}],
    )

    assert snapshot["users"][0]["password_hash"] == password_hash
    assert "password" not in snapshot["users"][0]
    assert snapshot["users"][0]["is_active"] is True
    assert snapshot["memberships"][0]["identity_issuer"] == IDENTITY_ISSUER
    assert snapshot["memberships"][0]["identity_subject"] == "alice"


def test_import_snapshot_combines_duplicate_and_unknown_legacy_roles_safely():
    snapshot = prepare_snapshot(
        tenant_rows=[{"tenant_id": 12, "tenant_name": "acme"}],
        plan_rows=[],
        membership_rows=[
            {"tenant_id": 12, "username": "alice", "role_key": "viewer"},
            {"tenant_id": 12, "username": "alice", "role_key": "tenant_admin"},
            {"tenant_id": 12, "username": "bob", "role_key": "unsupported"},
        ],
        user_rows=[],
    )

    roles = {(row["tenant_id"], row["actor_id"]): row["role_key"] for row in snapshot["memberships"]}
    assert roles[(12, "alice")] == "tenant_admin"
    assert roles[(12, "bob")] == "viewer"


def test_import_snapshot_flags_role_combinations_without_safe_single_role_mapping():
    snapshot = prepare_snapshot(
        tenant_rows=[{"tenant_id": 12, "tenant_name": "acme"}],
        plan_rows=[],
        membership_rows=[
            {"tenant_id": 12, "username": "alice", "role_key": "operator"},
            {"tenant_id": 12, "username": "alice", "role_key": "approver"},
        ],
        user_rows=[],
    )

    assert snapshot["role_conflicts"] == [{"tenant_id": 12, "username": "alice", "roles": ["approver", "operator"]}]


def test_import_snapshot_collapses_subsumed_role_assignments_without_conflict():
    snapshot = prepare_snapshot(
        tenant_rows=[{"tenant_id": 12, "tenant_name": "acme"}],
        plan_rows=[],
        membership_rows=[
            {"tenant_id": 12, "username": "alice", "role_key": "tenant_admin"},
            {"tenant_id": 12, "username": "alice", "role_key": "operator"},
        ],
        user_rows=[],
    )

    assert snapshot["memberships"][0]["role_key"] == "tenant_admin"
    assert snapshot["role_conflicts"] == []


def test_import_snapshot_marks_accounts_without_password_as_invite_pending():
    snapshot = prepare_snapshot(
        tenant_rows=[],
        plan_rows=[],
        membership_rows=[],
        user_rows=[{"username": "invited", "password_hash": None, "is_active": True}],
    )

    assert snapshot["users"][0]["password_hash"] == "!invite-pending!"


def test_database_endpoint_summary_never_includes_credentials_or_query_parameters():
    summary = endpoint_summary("postgresql://alice:super-secret@db.example.test:5432/aiops?sslmode=require")

    assert summary == "db.example.test:5432/aiops"
    assert "alice" not in summary
    assert "super-secret" not in summary


def test_dns_error_explains_unresolvable_host_without_echoing_connection_string():
    url = "postgresql://alice:super-secret@bad-host.example:5432/aiops"
    message = connection_error_message("AIOps source", url, socket.gaierror(11001, "not found"))

    assert "Could not resolve the AIOps source database host" in message
    assert "bad-host.example:5432/aiops" in message
    assert "DNS/VPN/private-endpoint" in message
    assert "super-secret" not in message
