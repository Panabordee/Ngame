"""Enforce one Google identity per normalized email.

Revision ID: 20260717_0003
Revises: 20260717_0002
"""

from alembic import op


revision = "20260717_0003"
down_revision = "20260717_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("auth_identities") as batch:
        batch.create_unique_constraint("uq_auth_identity_email", ["email"])


def downgrade() -> None:
    with op.batch_alter_table("auth_identities") as batch:
        batch.drop_constraint("uq_auth_identity_email", type_="unique")
