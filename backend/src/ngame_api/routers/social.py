from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..dependencies import get_current_profile, get_session
from ..models import AuthIdentity, SocialConnection, User
from ..schemas import FriendItem, FriendRequest, FriendsResponse, MessageResponse

router = APIRouter(prefix="/social", tags=["social"])


def pair(left: UUID, right: UUID) -> tuple[str, UUID, UUID]:
    first, second = sorted((left, right), key=str)
    return f"{first}:{second}", first, second


@router.get("/friends", response_model=FriendsResponse)
async def friends(profile: Annotated[tuple[User, AuthIdentity], Depends(get_current_profile)], session: Annotated[AsyncSession, Depends(get_session)]) -> FriendsResponse:
    user, _identity = profile
    connections = list((await session.scalars(select(SocialConnection).where(or_(SocialConnection.user_a_id == user.id, SocialConnection.user_b_id == user.id)))).all())
    other_ids = {row.user_b_id if row.user_a_id == user.id else row.user_a_id for row in connections}
    users = {candidate.id: candidate for candidate in (await session.scalars(select(User).where(User.id.in_(other_ids)))).all()} if other_ids else {}
    items: list[FriendItem] = []
    for row in connections:
        if row.status == "blocked" and row.requested_by_id != user.id:
            continue
        other_id = row.user_b_id if row.user_a_id == user.id else row.user_a_id
        other = users.get(other_id)
        if other is None: continue
        visible_status = "blocked" if row.status == "blocked" else "friend" if row.status == "accepted" else "outgoing" if row.requested_by_id == user.id else "incoming"
        items.append(FriendItem(connection_id=row.id, user_id=other.id, display_name=other.display_name, username=other.username, status=visible_status))
    return FriendsResponse(items=items)


@router.post("/friends", response_model=MessageResponse)
async def request_friend(payload: FriendRequest, profile: Annotated[tuple[User, AuthIdentity], Depends(get_current_profile)], session: Annotated[AsyncSession, Depends(get_session)]) -> MessageResponse:
    user, _identity = profile
    target = await session.scalar(select(User).where(User.username == payload.username.casefold()))
    if target is None: raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Player not found.")
    if target.id == user.id: raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot add yourself.")
    pair_key, user_a, user_b = pair(user.id, target.id)
    existing = await session.scalar(select(SocialConnection).where(SocialConnection.pair_key == pair_key))
    if existing is not None: raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A social connection already exists.")
    session.add(SocialConnection(pair_key=pair_key, user_a_id=user_a, user_b_id=user_b, requested_by_id=user.id, status="pending"))
    await session.commit()
    return MessageResponse(message="Friend request sent.")


@router.patch("/friends/{connection_id}/accept", response_model=MessageResponse)
async def accept_friend(connection_id: UUID, profile: Annotated[tuple[User, AuthIdentity], Depends(get_current_profile)], session: Annotated[AsyncSession, Depends(get_session)]) -> MessageResponse:
    user, _identity = profile
    row = await session.get(SocialConnection, connection_id)
    if row is None or row.status != "pending" or row.requested_by_id == user.id or user.id not in {row.user_a_id, row.user_b_id}: raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Friend request not found.")
    row.status = "accepted"
    await session.commit()
    return MessageResponse(message="Friend request accepted.")


@router.delete("/friends/{connection_id}", response_model=MessageResponse)
async def remove_friend(connection_id: UUID, profile: Annotated[tuple[User, AuthIdentity], Depends(get_current_profile)], session: Annotated[AsyncSession, Depends(get_session)]) -> MessageResponse:
    user, _identity = profile
    row = await session.get(SocialConnection, connection_id)
    if row is None or user.id not in {row.user_a_id, row.user_b_id} or (row.status == "blocked" and row.requested_by_id != user.id): raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found.")
    await session.delete(row)
    await session.commit()
    return MessageResponse(message="Connection removed.")


@router.post("/block", response_model=MessageResponse)
async def block_player(payload: FriendRequest, profile: Annotated[tuple[User, AuthIdentity], Depends(get_current_profile)], session: Annotated[AsyncSession, Depends(get_session)]) -> MessageResponse:
    user, _identity = profile
    target = await session.scalar(select(User).where(User.username == payload.username.casefold()))
    if target is None or target.id == user.id: raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Player not found.")
    pair_key, user_a, user_b = pair(user.id, target.id)
    row = await session.scalar(select(SocialConnection).where(SocialConnection.pair_key == pair_key))
    if row is None:
        row = SocialConnection(pair_key=pair_key, user_a_id=user_a, user_b_id=user_b, requested_by_id=user.id, status="blocked")
        session.add(row)
    else:
        row.requested_by_id = user.id
        row.status = "blocked"
    await session.commit()
    return MessageResponse(message="Player blocked.")
