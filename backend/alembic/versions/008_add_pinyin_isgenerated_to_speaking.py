"""add example_pinyin and is_generated to speaking_records

Revision ID: 008
Revises: 007
Create Date: 2026-03-05

"""
from alembic import op
import sqlalchemy as sa

revision = '008'
down_revision = '007'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('speaking_records', sa.Column('example_pinyin', sa.String(500), nullable=True))
    op.add_column('speaking_records', sa.Column('is_generated', sa.Boolean(), server_default='false'))


def downgrade() -> None:
    op.drop_column('speaking_records', 'is_generated')
    op.drop_column('speaking_records', 'example_pinyin')
