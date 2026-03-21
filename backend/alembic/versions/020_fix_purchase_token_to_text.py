"""fix purchase_token column to TEXT

Revision ID: 020
Revises: 019
Create Date: 2026-03-21
"""
from alembic import op
import sqlalchemy as sa

revision = "020"
down_revision = "019"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column(
        "user_subscriptions",
        "purchase_token",
        type_=sa.Text(),
        existing_type=sa.String(500),
        existing_nullable=True,
    )


def downgrade():
    op.alter_column(
        "user_subscriptions",
        "purchase_token",
        type_=sa.String(500),
        existing_type=sa.Text(),
        existing_nullable=True,
    )
