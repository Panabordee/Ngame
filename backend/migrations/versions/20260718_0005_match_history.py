"""Add authoritative match history.

Revision ID: 20260718_0005
Revises: 20260717_0004
"""
from alembic import op
import sqlalchemy as sa

revision = "20260718_0005"
down_revision = "20260717_0004"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.create_table("match_player_records", sa.Column("id", sa.Uuid(), nullable=False), sa.Column("match_id", sa.String(64), nullable=False), sa.Column("user_id", sa.Uuid(), nullable=False), sa.Column("won", sa.Boolean(), nullable=False), sa.Column("guesses", sa.Integer(), nullable=False), sa.Column("correct_guesses", sa.Integer(), nullable=False), sa.Column("cards_revealed", sa.Integer(), nullable=False), sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False), sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"), sa.PrimaryKeyConstraint("id"), sa.UniqueConstraint("match_id", "user_id", name="uq_match_player"))
    op.create_index("ix_match_player_records_match_id", "match_player_records", ["match_id"])
    op.create_index("ix_match_player_records_user_id", "match_player_records", ["user_id"])
    op.create_index("ix_match_player_records_completed_at", "match_player_records", ["completed_at"])

def downgrade() -> None:
    op.drop_table("match_player_records")
