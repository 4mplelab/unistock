"""event_logs aggregation columns

Revision ID: 8cb96ecd8791
Revises: 1b28952727b7
Create Date: 2026-09-10 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '8cb96ecd8791'
down_revision: Union[str, None] = '1b28952727b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'event_logs',
        sa.Column('occurrence_count', sa.Integer(), nullable=False, server_default='1'),
    )
    op.add_column(
        'event_logs',
        sa.Column('last_occurred_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )
    op.execute("UPDATE event_logs SET last_occurred_at = created_at")


def downgrade() -> None:
    op.drop_column('event_logs', 'last_occurred_at')
    op.drop_column('event_logs', 'occurrence_count')
