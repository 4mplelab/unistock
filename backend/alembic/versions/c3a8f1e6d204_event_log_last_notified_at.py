"""event_logs: last_notified_at

Revision ID: c3a8f1e6d204
Revises: b7e2c4d91a05
Create Date: 2026-11-13 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'c3a8f1e6d204'
down_revision: Union[str, None] = 'b7e2c4d91a05'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('event_logs', sa.Column('last_notified_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('event_logs', 'last_notified_at')
