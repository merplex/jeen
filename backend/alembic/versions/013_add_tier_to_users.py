"""add tier to users

Revision ID: 013
Revises: 012
Create Date: 2026-03-11
"""
from alembic import op
import sqlalchemy as sa

revision = '013'
down_revision = '012'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('tier', sa.String(20), nullable=False, server_default='reduser'))


def downgrade():
    op.drop_column('users', 'tier')
