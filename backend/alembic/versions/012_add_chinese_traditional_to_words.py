"""add chinese_traditional to words

Revision ID: 012
Revises: 011
Create Date: 2026-03-10
"""
from alembic import op
import sqlalchemy as sa

revision = '012'
down_revision = '011'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('words', sa.Column('chinese_traditional', sa.String(50), nullable=True))
    op.create_index('ix_words_chinese_traditional', 'words', ['chinese_traditional'])

    op.add_column('words_pending', sa.Column('chinese_traditional', sa.String(50), nullable=True))


def downgrade():
    op.drop_index('ix_words_chinese_traditional', table_name='words')
    op.drop_column('words', 'chinese_traditional')
    op.drop_column('words_pending', 'chinese_traditional')
