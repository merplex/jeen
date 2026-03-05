"""add deck column to flashcards

Revision ID: 005
Revises: 004
Create Date: 2026-03-05

"""
from alembic import op
import sqlalchemy as sa

revision = '005'
down_revision = '004'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('flashcards', sa.Column('deck', sa.Integer(), nullable=False, server_default='1'))
    op.drop_constraint('flashcards_user_id_word_id_key', 'flashcards', type_='unique')
    op.create_unique_constraint('uq_flashcards_user_word_deck', 'flashcards', ['user_id', 'word_id', 'deck'])


def downgrade() -> None:
    op.drop_constraint('uq_flashcards_user_word_deck', 'flashcards', type_='unique')
    op.create_unique_constraint('flashcards_user_id_word_id_key', 'flashcards', ['user_id', 'word_id'])
    op.drop_column('flashcards', 'deck')
