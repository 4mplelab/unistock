"""ec_oauth_tokens: reauth_required_at

Revision ID: b7e2c4d91a05
Revises: 9d3e5b7a1c42
Create Date: 2026-11-13 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'b7e2c4d91a05'
down_revision: Union[str, None] = '9d3e5b7a1c42'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('ec_oauth_tokens', sa.Column('reauth_required_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('ec_oauth_tokens', 'reauth_required_at')
