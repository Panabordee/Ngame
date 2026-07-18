"""Add friends and blocking.

Revision ID: 20260719_0006
Revises: 20260718_0005
"""
from alembic import op
import sqlalchemy as sa

revision = "20260719_0006"
down_revision = "20260718_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("social_connections", sa.Column("id", sa.Uuid(), nullable=False), sa.Column("pair_key", sa.String(73), nullable=False), sa.Column("user_a_id", sa.Uuid(), nullable=False), sa.Column("user_b_id", sa.Uuid(), nullable=False), sa.Column("requested_by_id", sa.Uuid(), nullable=False), sa.Column("status", sa.String(16), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False), sa.ForeignKeyConstraint(["user_a_id"], ["users.id"], ondelete="CASCADE"), sa.ForeignKeyConstraint(["user_b_id"], ["users.id"], ondelete="CASCADE"), sa.ForeignKeyConstraint(["requested_by_id"], ["users.id"], ondelete="CASCADE"), sa.PrimaryKeyConstraint("id"), sa.UniqueConstraint("pair_key"))
    op.create_index("ix_social_connections_pair_key", "social_connections", ["pair_key"])
    op.create_index("ix_social_connections_user_a_id", "social_connections", ["user_a_id"])
    op.create_index("ix_social_connections_user_b_id", "social_connections", ["user_b_id"])


def downgrade() -> None:
    op.drop_table("social_connections")
