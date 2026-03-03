"""add source and admin_edited to words

Revision ID: 002
Revises: 001
Create Date: 2026-03-03

"""
from alembic import op
import sqlalchemy as sa

revision = '002'
down_revision = '001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'words'
            ) THEN
                ALTER TABLE words
                    ADD COLUMN IF NOT EXISTS source VARCHAR(100),
                    ADD COLUMN IF NOT EXISTS admin_edited BOOLEAN NOT NULL DEFAULT FALSE;
            END IF;
        END
        $$;
    """))


def downgrade() -> None:
    op.drop_column('words', 'source')
    op.drop_column('words', 'admin_edited')
