from pydantic import BaseModel, Field


class DataResetRequest(BaseModel):
    confirm_phrase: str = Field(min_length=1)
