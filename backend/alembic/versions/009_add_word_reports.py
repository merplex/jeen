"""add word_reports table and report_flagged to users"""
from alembic import op
import sqlalchemy as sa

revision = '009'
down_revision = '008'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('report_flagged', sa.Boolean(), nullable=False, server_default='false'))
    op.create_table(
        'word_reports',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('word_id', sa.Integer(), sa.ForeignKey('words.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False, index=True),
        sa.Column('message', sa.String(100), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()')),
    )


def downgrade():
    op.drop_table('word_reports')
    op.drop_column('users', 'report_flagged')
