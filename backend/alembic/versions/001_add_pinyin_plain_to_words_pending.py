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
    op.add_column('words_pending', sa.Column('pinyin_plain', sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column('words_pending', 'pinyin_plain')
