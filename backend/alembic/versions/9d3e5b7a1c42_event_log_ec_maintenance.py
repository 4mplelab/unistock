"""event_logs category: ec_maintenance

Revision ID: 9d3e5b7a1c42
Revises: 4f2c9a1d7e30
Create Date: 2026-10-21 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = '9d3e5b7a1c42'
down_revision: Union[str, None] = '4f2c9a1d7e30'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_OLD_CATEGORIES = (
    "'reservation_skipped', 'assembly_stock_shortfall', 'stock_operation_failed', "
    "'retention_cleanup', 'auth_error'"
)
_NEW_CATEGORIES = _OLD_CATEGORIES + ", 'ec_maintenance'"


def upgrade() -> None:
    op.drop_constraint('ck_event_logs_category', 'event_logs', type_='check')
    op.create_check_constraint('ck_event_logs_category', 'event_logs', f"category IN ({_NEW_CATEGORIES})")


def downgrade() -> None:
    op.execute("DELETE FROM event_logs WHERE category = 'ec_maintenance'")
    op.drop_constraint('ck_event_logs_category', 'event_logs', type_='check')
    op.create_check_constraint('ck_event_logs_category', 'event_logs', f"category IN ({_OLD_CATEGORIES})")
