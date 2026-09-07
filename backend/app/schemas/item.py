from pydantic import BaseModel, Field


class ItemRead(BaseModel):
    item_id: str
    title: str
    stock: int


class ItemDescriptionUpdate(BaseModel):
    detail: str = Field(min_length=1)


class ItemUpdateRead(BaseModel):
    item_id: str
    success: bool


class ItemOptionChoiceRead(BaseModel):
    option_variation_id: str
    variation_name: str
    price: int


class ItemOptionRead(BaseModel):
    option_id: str
    option_name: str
    choices: list[ItemOptionChoiceRead]


class ItemVariationRead(BaseModel):
    variation_id: str
    variation_name: str
    stock: int
