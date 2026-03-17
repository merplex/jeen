"""add image_url to words

Revision ID: 017
Revises: 016
Create Date: 2026-03-17
"""
from alembic import op
import sqlalchemy as sa

revision = "017"
down_revision = "016"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("words", sa.Column("image_url", sa.String(500), nullable=True))


def downgrade():
    op.drop_column("words", "image_url")
