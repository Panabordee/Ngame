import hashlib
import hmac
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends

from ..config import Settings
from ..dependencies import get_settings
from ..schemas import DailyPuzzleGuess, DailyPuzzleGuessResponse, DailyPuzzleResponse

router = APIRouter(prefix="/puzzles", tags=["puzzles"])
RANKS = ("A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K")


def puzzle_values(settings: Settings) -> tuple[str, int, str]:
    puzzle_id = datetime.now(timezone.utc).date().isoformat()
    digest = hmac.new(settings.oauth_state_secret.encode(), puzzle_id.encode(), hashlib.sha256).digest()
    rank_index = 1 + digest[0] % 11
    color = "red" if digest[1] % 2 == 0 else "black"
    return puzzle_id, rank_index, color


@router.get("/daily", response_model=DailyPuzzleResponse)
async def daily_puzzle(settings: Annotated[Settings, Depends(get_settings)]) -> DailyPuzzleResponse:
    puzzle_id, rank_index, _color = puzzle_values(settings)
    candidates = [f"{RANKS[rank_index]}-red", f"{RANKS[rank_index]}-black", f"{RANKS[rank_index - 1]}-red", f"{RANKS[rank_index + 1]}-black"]
    return DailyPuzzleResponse(puzzle_id=puzzle_id, lower_rank=RANKS[rank_index - 1], upper_rank=RANKS[rank_index + 1], candidates=sorted(candidates))


@router.post("/daily/guess", response_model=DailyPuzzleGuessResponse)
async def guess_daily(payload: DailyPuzzleGuess, settings: Annotated[Settings, Depends(get_settings)]) -> DailyPuzzleGuessResponse:
    _puzzle_id, rank_index, color = puzzle_values(settings)
    return DailyPuzzleGuessResponse(correct=hmac.compare_digest(payload.candidate, f"{RANKS[rank_index]}-{color}"))
