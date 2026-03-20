"""add source to missed_searches

Revision ID: 019
Revises: 018
Create Date: 2026-03-20
"""
from alembic import op
import sqlalchemy as sa

revision = "019"
down_revision = "018"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "missed_searches",
        sa.Column("source", sa.String(20), nullable=False, server_default="search"),
    )


def downgrade():
    op.drop_column("missed_searches", "source")
