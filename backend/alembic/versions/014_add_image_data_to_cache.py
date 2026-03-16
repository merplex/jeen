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
    # สร้างตารางถ้ายังไม่มี (กรณี DB ใหม่ที่ไม่เคยรัน migration เก่าก่อน)
    op.execute("""
        CREATE TABLE IF NOT EXISTS word_image_cache (
            word_id     INTEGER PRIMARY KEY REFERENCES words(id) ON DELETE CASCADE,
            image_url   TEXT,
            cached_at   TIMESTAMP DEFAULT NOW()
        )
    """)
    # เพิ่ม columns ถ้ายังไม่มี
    op.execute("ALTER TABLE word_image_cache ADD COLUMN IF NOT EXISTS image_data BYTEA")
    op.execute("ALTER TABLE word_image_cache ADD COLUMN IF NOT EXISTS image_source VARCHAR(32)")
    op.execute("ALTER TABLE word_image_cache ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMP DEFAULT NOW()")


def downgrade():
    op.drop_column("word_image_cache", "last_accessed_at")
    op.drop_column("word_image_cache", "image_data")
    op.drop_column("word_image_cache", "image_source")
