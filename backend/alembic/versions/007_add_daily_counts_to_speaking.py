"""add daily_assess_count and daily_gen_count to speaking_records

Revision ID: 007
Revises: 006
Create Date: 2026-03-05

"""
from alembic import op
import sqlalchemy as sa

revision = '007'
down_revision = '006'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('speaking_records', sa.Column('daily_assess_count', sa.Integer(), server_default='0'))
    op.add_column('speaking_records', sa.Column('daily_gen_count', sa.Integer(), server_default='0'))


def downgrade() -> None:
    op.drop_column('speaking_records', 'daily_gen_count')
    op.drop_column('speaking_records', 'daily_assess_count')
