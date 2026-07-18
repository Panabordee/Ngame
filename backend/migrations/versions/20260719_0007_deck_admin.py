"""Add protected deck theme administration.

Revision ID: 20260719_0007
Revises: 20260719_0006
"""
from alembic import op
import sqlalchemy as sa

revision = "20260719_0007"
down_revision = "20260719_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("role", sa.String(16), nullable=False, server_default="player"))
    op.create_table("card_decks", sa.Column("id", sa.Uuid(), nullable=False), sa.Column("slug", sa.String(40), nullable=False), sa.Column("name", sa.String(64), nullable=False), sa.Column("active", sa.Boolean(), nullable=False), sa.Column("created_by_id", sa.Uuid(), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False), sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="RESTRICT"), sa.PrimaryKeyConstraint("id"), sa.UniqueConstraint("slug"))
    op.create_index("ix_card_decks_slug", "card_decks", ["slug"])
    op.create_index("ix_card_decks_active", "card_decks", ["active"])
    op.create_table("card_assets", sa.Column("id", sa.Uuid(), nullable=False), sa.Column("deck_id", sa.Uuid(), nullable=False), sa.Column("card_key", sa.String(32), nullable=False), sa.Column("asset_url", sa.String(2048), nullable=False), sa.Column("checksum_sha256", sa.String(64), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False), sa.ForeignKeyConstraint(["deck_id"], ["card_decks.id"], ondelete="CASCADE"), sa.PrimaryKeyConstraint("id"), sa.UniqueConstraint("deck_id", "card_key", name="uq_card_asset_deck_key"))
    op.create_index("ix_card_assets_deck_id", "card_assets", ["deck_id"])
    op.create_table("admin_audit_logs", sa.Column("id", sa.Uuid(), nullable=False), sa.Column("admin_user_id", sa.Uuid(), nullable=False), sa.Column("action", sa.String(64), nullable=False), sa.Column("resource_type", sa.String(32), nullable=False), sa.Column("resource_id", sa.String(64), nullable=False), sa.Column("details", sa.Text(), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False), sa.ForeignKeyConstraint(["admin_user_id"], ["users.id"], ondelete="RESTRICT"), sa.PrimaryKeyConstraint("id"))
    op.create_index("ix_admin_audit_logs_admin_user_id", "admin_audit_logs", ["admin_user_id"])
    op.create_index("ix_admin_audit_logs_action", "admin_audit_logs", ["action"])
    op.create_index("ix_admin_audit_logs_created_at", "admin_audit_logs", ["created_at"])


def downgrade() -> None:
    op.drop_table("admin_audit_logs")
    op.drop_table("card_assets")
    op.drop_table("card_decks")
    op.drop_column("users", "role")
