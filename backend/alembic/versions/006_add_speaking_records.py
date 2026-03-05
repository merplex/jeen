"""add speaking_records table

Revision ID: 006
Revises: 005
Create Date: 2026-03-05

"""
from alembic import op
import sqlalchemy as sa

revision = '006'
down_revision = '005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'speaking_records',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('word_id', sa.Integer(), sa.ForeignKey('words.id'), nullable=False),
        sa.Column('example_id', sa.Integer(), nullable=False),
        sa.Column('example_chinese', sa.String(500), nullable=False),
        sa.Column('pronunciation_score', sa.Float(), default=0),
        sa.Column('tone_score', sa.Float(), default=0),
        sa.Column('fluency_score', sa.Float(), default=0),
        sa.Column('practice_count', sa.Integer(), default=1),
        sa.Column('practiced_at', sa.DateTime(), server_default=sa.func.now()),
        sa.UniqueConstraint('user_id', 'example_id', name='uq_speaking_user_example'),
    )
    op.create_index('ix_speaking_records_user_id', 'speaking_records', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_speaking_records_user_id', table_name='speaking_records')
    op.drop_table('speaking_records')
