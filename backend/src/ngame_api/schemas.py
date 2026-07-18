from datetime import datetime
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

class MatchResultPlayerInput(BaseModel):
    user_id: UUID
    won: bool
    guesses: int = Field(ge=0)
    correct_guesses: int = Field(ge=0)
    cards_revealed: int = Field(ge=0)

class InternalMatchResultRequest(BaseModel):
    match_id: str = Field(min_length=1, max_length=64)
    players: list[MatchResultPlayerInput]

class MatchHistoryItem(BaseModel):
    match_id: str
    won: bool
    guesses: int
    correct_guesses: int
    cards_revealed: int
    completed_at: datetime

class PlayerStatsResponse(BaseModel):
    games: int
    wins: int
    guesses: int
    correct_guesses: int
    current_streak: int
    achievements: list[str]
    recent_matches: list[MatchHistoryItem]

class LeaderboardEntry(BaseModel):
    rank: int
    user_id: UUID
    display_name: str
    games: int
    wins: int
    rating: int

class LeaderboardResponse(BaseModel):
    season: str
    entries: list[LeaderboardEntry]

class DailyPuzzleResponse(BaseModel):
    puzzle_id: str
    lower_rank: str
    upper_rank: str
    candidates: list[str]

class DailyPuzzleGuess(BaseModel):
    candidate: str = Field(min_length=3, max_length=16)

class DailyPuzzleGuessResponse(BaseModel):
    correct: bool

class FriendRequest(BaseModel):
    username: str = Field(min_length=3, max_length=20, pattern=r"^[a-zA-Z0-9_]+$")

class FriendItem(BaseModel):
    connection_id: UUID
    user_id: UUID
    display_name: str
    username: str | None
    status: Literal["incoming", "outgoing", "friend", "blocked"]

class FriendsResponse(BaseModel):
    items: list[FriendItem]
