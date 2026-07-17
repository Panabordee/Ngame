"""Remove password authentication and purge its accounts.

Revision ID: 20260717_0002
Revises: 20260717_0001
"""

from alembic import op
import sqlalchemy as sa


revision = "20260717_0002"
down_revision = "20260717_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    metadata = sa.MetaData()
    users = sa.Table("users", metadata, autoload_with=connection)
    identities = sa.Table("auth_identities", metadata, autoload_with=connection)
    credentials = sa.Table("password_credentials", metadata, autoload_with=connection)
    refresh_sessions = sa.Table("refresh_sessions", metadata, autoload_with=connection)

    password_user_ids = list(
        connection.execute(
            sa.select(identities.c.user_id).where(identities.c.provider == "password")
        ).scalars()
    )
    if password_user_ids:
        retained_user_ids = set(
            connection.execute(
                sa.select(identities.c.user_id).where(
                    identities.c.user_id.in_(password_user_ids),
                    identities.c.provider != "password",
                )
            ).scalars()
        )
        password_only_user_ids = [
            user_id for user_id in password_user_ids if user_id not in retained_user_ids
        ]
        connection.execute(
            sa.delete(refresh_sessions).where(
                refresh_sessions.c.user_id.in_(password_only_user_ids)
            )
        )
        connection.execute(
            sa.delete(credentials).where(credentials.c.user_id.in_(password_user_ids))
        )
        connection.execute(
            sa.delete(identities).where(
                identities.c.user_id.in_(password_user_ids),
                identities.c.provider == "password",
            )
        )
        connection.execute(
            sa.delete(users).where(users.c.id.in_(password_only_user_ids))
        )

    op.drop_table("password_credentials")


def downgrade() -> None:
    op.create_table(
        "password_credentials",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("password_hash", sa.String(length=512), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )
