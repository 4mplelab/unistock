from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, computed_field

from app.schemas.bom import BomConditionRead

TagStr = Annotated[str, Field(min_length=1, max_length=20)]


class AssemblyItemCreate(BaseModel):
    material_type: Literal["part", "assembly"]
    material_id: int
    quantity: int = Field(gt=0)


class AssemblyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    sku: str | None = Field(default=None, max_length=100)
    stock: int = Field(default=0, ge=0)
    unit_cost: int | None = Field(default=None, ge=0)
    tags: list[TagStr] | None = Field(default=None, max_length=5)
    # タグとは別の、一覧の絞り込み・並び替え用の単一の分類(Part.groupと同じ用途)
    group: str | None = Field(default=None, max_length=100)
    memo: str | None = Field(default=None)
    # 中間品自体の作成と組成(レシピ)登録を1トランザクションでまとめて行うための任意フィールド
    recipe: list[AssemblyItemCreate] = Field(default_factory=list)


class AssemblyUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    sku: str | None = Field(default=None, max_length=100)
    stock: int | None = Field(default=None, ge=0)
    unit_cost: int | None = Field(default=None, ge=0)
    tags: list[TagStr] | None = Field(default=None, max_length=5)
    group: str | None = Field(default=None, max_length=100)
    memo: str | None = Field(default=None)
    # stockを直接変更した場合、assembly_builds(kind=adjustment)に記録するメモ(任意)
    note: str | None = Field(default=None, max_length=255)
    # 指定時のみ組成(レシピ)を丸ごと置き換える。未指定(None)なら既存のレシピはそのまま
    recipe: list[AssemblyItemCreate] | None = Field(default=None)


class AssemblyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    sku: str | None
    stock: int
    reserved: int
    unit_cost: int | None
    tags: list[str] | None
    group: str | None
    memo: str | None
    created_at: datetime
    updated_at: datetime

    @computed_field
    @property
    def available(self) -> int:
        return self.stock - self.reserved


class AssemblyImportResult(BaseModel):
    created: int
    updated: int
    errors: list[str]


class AssemblyBuildableAvailable(BaseModel):
    """中間品の在庫(available)に、自身のレシピ(材料)から追加で組み立てられる分を
    加えた数。材料がさらに中間品の場合は再帰的に辿って算出する(BOM一覧の
    作成可能数計算で使用)。"""

    id: int
    available: int


class AssemblyCostRead(BaseModel):
    """中間品の原価(レシピの部品原価合計+自身の追加費用)。材料がさらに中間品の
    場合は再帰的に辿って算出する(assembly_service.compute_costs参照)。"""

    id: int
    cost: int


class AssemblyItemRead(BaseModel):
    id: int
    material_type: Literal["part", "assembly"]
    material_id: int
    material_name: str
    quantity: int
    created_at: datetime
    updated_at: datetime


class AssemblyRecipeReplace(BaseModel):
    lines: list[AssemblyItemCreate]


class AssemblyBuildCreate(BaseModel):
    quantity: int = Field(gt=0)
    note: str | None = Field(default=None, max_length=255)


class AssemblyBomUsageRead(BaseModel):
    """この中間品を参照しているBOM行。「BOMに展開する」機能で、どのBOM行を
    個別の部品/中間品行に置き換えられるかを一覧表示するために使う。"""

    bom_item_id: int
    shop_id: int
    item_id: str
    item_name: str | None
    quantity: int
    conditions: list[BomConditionRead]


class AssemblyRecipeUsageRead(BaseModel):
    """この中間品を材料として使っている、別の中間品のレシピ行。"""

    assembly_item_id: int
    assembly_id: int
    assembly_name: str
    quantity: int


class AssemblyUsagesRead(BaseModel):
    bom_items: list[AssemblyBomUsageRead]
    assembly_items: list[AssemblyRecipeUsageRead]
