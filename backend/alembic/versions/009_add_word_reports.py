"""add word_reports table and report_flagged to users"""
from alembic import op
import sqlalchemy as sa

revision = '009'
down_revision = '008'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS report_flagged BOOLEAN NOT NULL DEFAULT false")
    op.execute("""
        CREATE TABLE IF NOT EXISTS word_reports (
            id SERIAL PRIMARY KEY,
            word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id),
            message VARCHAR(100) NOT NULL,
            created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_word_reports_id ON word_reports(id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_word_reports_word_id ON word_reports(word_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_word_reports_user_id ON word_reports(user_id)")


def downgrade():
    op.drop_table('word_reports')
    op.drop_column('users', 'report_flagged')
