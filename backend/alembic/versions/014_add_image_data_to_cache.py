"""add image_data and image_source to word_image_cache

Revision ID: 014
Revises: 013
Create Date: 2026-03-12
"""
from alembic import op
import sqlalchemy as sa

revision = "014"
down_revision = "013"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("word_image_cache", sa.Column("image_data", sa.LargeBinary(), nullable=True))
    op.add_column("word_image_cache", sa.Column("image_source", sa.String(32), nullable=True))
    op.add_column("word_image_cache", sa.Column("last_accessed_at", sa.DateTime(), nullable=True,
                                                  server_default=sa.func.now()))


def downgrade():
    op.drop_column("word_image_cache", "last_accessed_at")
    op.drop_column("word_image_cache", "image_data")
    op.drop_column("word_image_cache", "image_source")
