"""add password_hash to users"""
from alembic import op
import sqlalchemy as sa

revision = '010'
down_revision = '009'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('password_hash', sa.String(200), nullable=True))


def downgrade():
    op.drop_column('users', 'password_hash')
