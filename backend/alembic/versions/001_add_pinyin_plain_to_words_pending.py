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
    # ตรวจก่อนว่าตารางมีอยู่ (ถ้า fresh DB create_all จะสร้างพร้อม column อยู่แล้ว)
    op.execute(sa.text("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'words_pending'
            ) THEN
                ALTER TABLE words_pending
                    ADD COLUMN IF NOT EXISTS pinyin_plain VARCHAR(100);
            END IF;
        END
        $$;
    """))


def downgrade() -> None:
    op.drop_column('words_pending', 'pinyin_plain')
