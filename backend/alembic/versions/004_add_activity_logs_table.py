"""add activity_logs table

Revision ID: 004
Revises: 003
Create Date: 2026-03-03

"""
from alembic import op
import sqlalchemy as sa

revision = '004'
down_revision = '003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'activity_logs',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('action', sa.String(50), nullable=False),
        sa.Column('word_id', sa.Integer(), nullable=True),
        sa.Column('chinese', sa.String(50), nullable=True),
        sa.Column('detail', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_activity_logs_created_at', 'activity_logs', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_activity_logs_created_at', table_name='activity_logs')
    op.drop_table('activity_logs')
