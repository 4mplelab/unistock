from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class _ComponentRefMixin(BaseModel):
    component_type: Literal["part", "assembly", "none"] = "part"
    part_id: int | None = None
    assembly_id: int | None = None

    @model_validator(mode="after")
    def _check_exactly_one_component(self) -> "_ComponentRefMixin":
        if self.component_type == "part":
            if self.part_id is None or self.assembly_id is not None:
                raise ValueError("component_type=part の場合、part_idのみ指定してください")
        elif self.component_type == "assembly":
            if self.assembly_id is None or self.part_id is not None:
                raise ValueError("component_type=assembly の場合、assembly_idのみ指定してください")
        else:
            if self.part_id is not None or self.assembly_id is not None:
                raise ValueError("component_type=none(部品不要)の場合、part_id/assembly_idは指定できません")
        return self


class BomConditionInput(BaseModel):
    """BomItem行が消費される条件の1つ。1行につき0..N件持て、全件AND判定される。"""

    selector_type: Literal["option", "variation"]
    selector_id: str = Field(min_length=1, max_length=64)
    group_name: str | None = Field(default=None, max_length=255)
    choice_name: str | None = Field(default=None, max_length=255)
    group_order: int | None = None
    choice_order: int | None = None


class BomConditionRead(BomConditionInput):
    pass


class BomItemCreate(_ComponentRefMixin):
    item_id: str = Field(min_length=1, max_length=64)
    item_name: str | None = Field(default=None, max_length=255)
    quantity: int = Field(gt=0)
    conditions: list[BomConditionInput] = Field(default_factory=list)


class BomItemUpdate(BaseModel):
    quantity: int = Field(gt=0)


class BomItemRead(BaseModel):
    id: int
    item_id: str
    item_name: str | None
    component_type: Literal["part", "assembly", "none"]
    part_id: int | None
    assembly_id: int | None
    component_name: str
    quantity: int
    conditions: list[BomConditionRead]
    created_at: datetime
    updated_at: datetime


class BomListRead(BaseModel):
    items: list[BomItemRead]
    total: int


class BomReplaceLine(_ComponentRefMixin):
    quantity: int = Field(gt=0)
    conditions: list[BomConditionInput] = Field(default_factory=list)


class BomReplaceRequest(BaseModel):
    item_name: str | None = Field(default=None, max_length=255)
    lines: list[BomReplaceLine]


class BomImportResult(BaseModel):
    created: int
    updated: int
    errors: list[str]


class BomProductSettingRead(BaseModel):
    item_id: str
    matrix_layout: bool
    buildable_alert_threshold: int | None = None


class BomProductSettingUpdate(BaseModel):
    matrix_layout: bool
    buildable_alert_threshold: int | None = None


class ItemBuildableCountRead(BaseModel):
    """商品(item_id)の作成可能数。共通行・オプション選択肢・組み合わせセルごとに
    独立して算出した作成可能数のうち最小値(BOM一覧に表示される個々の数値の最悪値)。
    どの行にも算出可能な行が無かった場合(レシピ未設定等)はNone。"""

    item_id: str
    item_name: str | None
    buildable: int | None
