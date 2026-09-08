"""add order_items.cost

Revision ID: 1b28952727b7
Revises: 0001
Create Date: 2026-09-08 13:25:27.801748

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '1b28952727b7'
down_revision: Union[str, None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('order_items', sa.Column('cost', sa.Integer(), nullable=True))
    op.create_check_constraint('ck_order_items_cost', 'order_items', 'cost IS NULL OR cost >= 0')


def downgrade() -> None:
    op.drop_constraint('ck_order_items_cost', 'order_items', type_='check')
    op.drop_column('order_items', 'cost')
