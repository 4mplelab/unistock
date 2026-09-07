from datetime import date

from pydantic import BaseModel


class SalesSummaryPoint(BaseModel):
    date: date
    revenue: int
    cost: int
    gross_profit: int
    order_count: int


class SalesSummaryProductRow(BaseModel):
    item_id: str
    title: str | None
    quantity: int
    revenue: int
    cost: int
    gross_profit: int
    gross_margin_rate: float


class SalesSummaryCategoryProductRow(BaseModel):
    item_id: str
    title: str | None
    quantity: int
    revenue: int


class SalesSummaryCategoryRow(BaseModel):
    # カテゴリが未設定の商品は category_id=None,name="未分類" にまとめる
    category_id: int | None
    name: str
    quantity: int
    revenue: int
    # このカテゴリに属する商品の内訳(売上が多い順、上位PRODUCT_RANKING_LIMIT件)
    products: list[SalesSummaryCategoryProductRow]


class SalesSummaryRead(BaseModel):
    days: int
    total_revenue: int
    total_quantity: int
    total_cost: int
    total_gross_profit: int
    gross_margin_rate: float
    order_count: int
    average_order_value: float
    points: list[SalesSummaryPoint]
    products: list[SalesSummaryProductRow]
    categories: list[SalesSummaryCategoryRow]
