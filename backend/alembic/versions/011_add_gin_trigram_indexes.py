"""add GIN trigram indexes for fast substring search"""
from alembic import op

revision = '011'
down_revision = '010'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute("CREATE INDEX IF NOT EXISTS idx_chinese_trgm ON words USING GIN (chinese gin_trgm_ops)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_pinyin_plain_trgm ON words USING GIN (pinyin_plain gin_trgm_ops)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_thai_meaning_trgm ON words USING GIN (thai_meaning gin_trgm_ops)")


def downgrade():
    op.execute("DROP INDEX IF EXISTS idx_thai_meaning_trgm")
    op.execute("DROP INDEX IF EXISTS idx_pinyin_plain_trgm")
    op.execute("DROP INDEX IF EXISTS idx_chinese_trgm")
