"""stock_movements reason: direct_consumed

Revision ID: 4f2c9a1d7e30
Revises: 8cb96ecd8791
Create Date: 2026-10-02 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = '4f2c9a1d7e30'
down_revision: Union[str, None] = '8cb96ecd8791'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_OLD_REASONS = (
    "'manual_edit', 'add_stock', 'purchase_order_received', 'purchase_order_receive_undone', "
    "'order_consumed', 'order_dispatch_undone', 'assembly_build', 'assembly_build_material', "
    "'manual_item_consumed'"
)
_NEW_REASONS = _OLD_REASONS + ", 'direct_consumed'"


def upgrade() -> None:
    op.drop_constraint('ck_stock_movements_reason', 'stock_movements', type_='check')
    op.create_check_constraint('ck_stock_movements_reason', 'stock_movements', f"reason IN ({_NEW_REASONS})")


def downgrade() -> None:
    op.execute("DELETE FROM stock_movements WHERE reason = 'direct_consumed'")
    op.drop_constraint('ck_stock_movements_reason', 'stock_movements', type_='check')
    op.create_check_constraint('ck_stock_movements_reason', 'stock_movements', f"reason IN ({_OLD_REASONS})")
