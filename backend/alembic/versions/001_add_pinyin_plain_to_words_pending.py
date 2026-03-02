"""add pinyin_plain to words_pending

Revision ID: 001
Revises:
Create Date: 2026-03-02

"""
from alembic import op
import sqlalchemy as sa

revision = '001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text(
        "ALTER TABLE words_pending ADD COLUMN IF NOT EXISTS pinyin_plain VARCHAR(100)"
    ))


def downgrade() -> None:
    op.drop_column('words_pending', 'pinyin_plain')
