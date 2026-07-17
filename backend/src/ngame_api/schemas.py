from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator


class UserResponse(BaseModel):
    id: UUID
    display_name: str
    username: str | None
    avatar_url: str | None
    email: EmailStr | None
    email_verified: bool
    account_type: Literal["registered", "guest"] = "registered"


class GuestLoginRequest(BaseModel):
    display_name: str | None = Field(default=None, max_length=32)

    @field_validator("display_name")
    @classmethod
    def normalize_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split())
        return normalized or None


class UserUpdateRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=32)
    username: str = Field(min_length=3, max_length=20, pattern=r"^[a-zA-Z0-9_]+$")

    @field_validator("display_name")
    @classmethod
    def normalize_display_name(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("display name cannot be blank")
        return normalized

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        return value.casefold()


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserResponse


class MessageResponse(BaseModel):
    message: str
