"""add related_words to words

Revision ID: 018
Revises: 017
Create Date: 2026-03-19
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "018"
down_revision = "017"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("words", sa.Column("related_words", JSONB, nullable=True))


def downgrade():
    op.drop_column("words", "related_words")
