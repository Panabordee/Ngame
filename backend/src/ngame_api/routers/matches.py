import secrets
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import Settings
from ..dependencies import get_current_profile, get_session, get_settings
from ..models import AuthIdentity, MatchPlayerRecord, User
from ..schemas import InternalMatchResultRequest, LeaderboardEntry, LeaderboardResponse, MatchHistoryItem, MessageResponse, PlayerStatsResponse

router = APIRouter(prefix="/matches", tags=["matches"])

@router.post("/internal/results", response_model=MessageResponse)
async def store_result(payload: InternalMatchResultRequest, session: Annotated[AsyncSession, Depends(get_session)], settings: Annotated[Settings, Depends(get_settings)], x_ngame_internal_secret: Annotated[str | None, Header()] = None) -> MessageResponse:
    if x_ngame_internal_secret is None or not secrets.compare_digest(x_ngame_internal_secret, settings.match_result_secret):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden.")
    for player in payload.players:
        existing = await session.scalar(select(MatchPlayerRecord).where(MatchPlayerRecord.match_id == payload.match_id, MatchPlayerRecord.user_id == player.user_id))
        if existing is None:
            session.add(MatchPlayerRecord(match_id=payload.match_id, user_id=player.user_id, won=player.won, guesses=player.guesses, correct_guesses=player.correct_guesses, cards_revealed=player.cards_revealed))
    await session.commit()
    return MessageResponse(message="Match result stored.")

@router.get("/me", response_model=PlayerStatsResponse)
async def my_matches(profile: Annotated[tuple[User, AuthIdentity], Depends(get_current_profile)], session: Annotated[AsyncSession, Depends(get_session)]) -> PlayerStatsResponse:
    user, _identity = profile
    rows = list((await session.scalars(select(MatchPlayerRecord).where(MatchPlayerRecord.user_id == user.id).order_by(MatchPlayerRecord.completed_at.desc()).limit(20))).all())
    outcomes = list((await session.scalars(select(MatchPlayerRecord.won).where(MatchPlayerRecord.user_id == user.id).order_by(MatchPlayerRecord.completed_at.desc()))).all())
    totals = (await session.execute(select(func.count(MatchPlayerRecord.id), func.coalesce(func.sum(case((MatchPlayerRecord.won, 1), else_=0)), 0), func.coalesce(func.sum(MatchPlayerRecord.guesses), 0), func.coalesce(func.sum(MatchPlayerRecord.correct_guesses), 0), func.coalesce(func.sum(MatchPlayerRecord.cards_revealed), 0)).where(MatchPlayerRecord.user_id == user.id))).one()
    streak = 0
    for won in outcomes:
        if not won: break
        streak += 1
    games, wins, guesses, correct_guesses, cards_revealed = map(int, totals)
    achievements: list[str] = []
    if games >= 1: achievements.append("first-match")
    if wins >= 1: achievements.append("first-win")
    if wins >= 10: achievements.append("ten-wins")
    if streak >= 3: achievements.append("hot-streak")
    if cards_revealed >= 100: achievements.append("codebreaker")
    if guesses >= 20 and correct_guesses * 100 >= guesses * 70: achievements.append("sharp-eye")
    return PlayerStatsResponse(games=games, wins=wins, guesses=guesses, correct_guesses=correct_guesses, current_streak=streak, achievements=achievements, recent_matches=[MatchHistoryItem(match_id=row.match_id, won=row.won, guesses=row.guesses, correct_guesses=row.correct_guesses, cards_revealed=row.cards_revealed, completed_at=row.completed_at) for row in rows])

@router.get("/leaderboard", response_model=LeaderboardResponse)
async def leaderboard(session: Annotated[AsyncSession, Depends(get_session)], season: str = "current") -> LeaderboardResponse:
    if season not in {"current", "all-time"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="season must be current or all-time")
    query = select(User.id, User.display_name, func.count(MatchPlayerRecord.id).label("games"), func.sum(case((MatchPlayerRecord.won, 1), else_=0)).label("wins")).join(MatchPlayerRecord, MatchPlayerRecord.user_id == User.id)
    season_name = "all-time"
    if season == "current":
        now = datetime.now(timezone.utc)
        start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
        query = query.where(MatchPlayerRecord.completed_at >= start)
        season_name = start.strftime("%Y-%m")
    rows = (await session.execute(query.group_by(User.id, User.display_name).order_by(func.sum(case((MatchPlayerRecord.won, 1), else_=0)).desc(), func.count(MatchPlayerRecord.id).asc(), User.display_name.asc()).limit(50))).all()
    return LeaderboardResponse(season=season_name, entries=[LeaderboardEntry(rank=index + 1, user_id=row.id, display_name=row.display_name, games=int(row.games), wins=int(row.wins), rating=1000 + int(row.wins) * 25 - (int(row.games) - int(row.wins)) * 10) for index, row in enumerate(rows)])
