"""Add editable player profile fields.

Revision ID: 20260717_0004
Revises: 20260717_0003
"""

from alembic import op
import sqlalchemy as sa


revision = "20260717_0004"
down_revision = "20260717_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("username", sa.String(length=20), nullable=True))
        batch.add_column(sa.Column("avatar_url", sa.String(length=2048), nullable=True))
        batch.create_unique_constraint("uq_users_username", ["username"])


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_constraint("uq_users_username", type_="unique")
        batch.drop_column("avatar_url")
        batch.drop_column("username")
