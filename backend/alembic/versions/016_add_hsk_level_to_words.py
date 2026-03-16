"""add hsk_level to words

Revision ID: 016
Revises: 015
Create Date: 2026-03-16
"""
from alembic import op
import sqlalchemy as sa

revision = "016"
down_revision = "015"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("words", sa.Column("hsk_level", sa.String(10), nullable=True))
    op.create_index("ix_words_hsk_level", "words", ["hsk_level"])


def downgrade():
    op.drop_index("ix_words_hsk_level", table_name="words")
    op.drop_column("words", "hsk_level")
