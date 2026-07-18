from datetime import datetime, timedelta, timezone
from pathlib import Path
import sqlite3
from uuid import uuid4

from alembic import command
from alembic.config import Config


def test_google_only_migration_purges_password_users_but_keeps_linked_google_user(
    tmp_path: Path,
    monkeypatch,
) -> None:
    database_path = tmp_path / "migration.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{database_path}")
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    command.upgrade(config, "20260717_0001")

    password_user_id = uuid4().hex
    linked_user_id = uuid4().hex
    now = datetime.now(timezone.utc).isoformat()
    expires_at = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    with sqlite3.connect(database_path) as database:
        database.executemany(
            "insert into users (id, display_name, status) values (?, ?, 'active')",
            [
                (password_user_id, "Password only"),
                (linked_user_id, "Linked Google"),
            ],
        )
        database.executemany(
            """
            insert into auth_identities
              (id, user_id, provider, provider_subject, email, email_verified)
            values (?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    uuid4().hex,
                    password_user_id,
                    "password",
                    "old@example.com",
                    "old@example.com",
                    1,
                ),
                (
                    uuid4().hex,
                    linked_user_id,
                    "password",
                    "linked@example.com",
                    "linked@example.com",
                    1,
                ),
                (uuid4().hex, linked_user_id, "google", "google-subject", "linked@example.com", 1),
            ],
        )
        database.executemany(
            "insert into password_credentials (user_id, password_hash) values (?, ?)",
            [
                (password_user_id, "unused-hash"),
                (linked_user_id, "unused-hash"),
            ],
        )
        database.executemany(
            """
            insert into refresh_sessions
              (id, user_id, token_hash, expires_at, created_at)
            values (?, ?, ?, ?, ?)
            """,
            [
                (uuid4().hex, password_user_id, "a" * 64, expires_at, now),
                (uuid4().hex, linked_user_id, "b" * 64, expires_at, now),
            ],
        )
        database.commit()

    command.upgrade(config, "head")

    with sqlite3.connect(database_path) as database:
        users = database.execute("select id from users").fetchall()
        identities = database.execute(
            "select user_id, provider from auth_identities"
        ).fetchall()
        sessions = database.execute(
            "select user_id from refresh_sessions"
        ).fetchall()
        tables = {
            row[0]
            for row in database.execute(
                "select name from sqlite_master where type = 'table'"
            )
        }
        version = database.execute(
            "select version_num from alembic_version"
        ).fetchone()

    assert users == [(linked_user_id,)]
    assert identities == [(linked_user_id, "google")]
    assert sessions == [(linked_user_id,)]
    assert "password_credentials" not in tables
    assert version == ("20260719_0007",)
