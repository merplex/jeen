"""add meaning_line to examples

Revision ID: 003
Revises: 002
Create Date: 2026-03-03

"""
from alembic import op
import sqlalchemy as sa

revision = '003'
down_revision = '002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'examples'
            ) THEN
                ALTER TABLE examples
                    ADD COLUMN IF NOT EXISTS meaning_line SMALLINT NOT NULL DEFAULT 0;
            END IF;
        END
        $$;
    """))


def downgrade() -> None:
    op.drop_column('examples', 'meaning_line')
