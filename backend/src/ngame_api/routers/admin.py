import json
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..dependencies import get_session, require_admin
from ..models import AdminAuditLog, AuthIdentity, CardAsset, CardDeck, User
from ..schemas import CardAssetInput, CardAssetResponse, CardDeckCreate, CardDeckResponse, CardDeckUpdate, MessageResponse


router = APIRouter(tags=["deck themes"])


async def _response(session: AsyncSession, deck: CardDeck) -> CardDeckResponse:
    assets = (await session.scalars(select(CardAsset).where(CardAsset.deck_id == deck.id).order_by(CardAsset.card_key))).all()
    return CardDeckResponse(id=deck.id, slug=deck.slug, name=deck.name, active=deck.active, assets=[CardAssetResponse(id=a.id, card_key=a.card_key, asset_url=a.asset_url, checksum_sha256=a.checksum_sha256) for a in assets])


async def _deck(session: AsyncSession, deck_id: UUID) -> CardDeck:
    deck = await session.get(CardDeck, deck_id)
    if deck is None:
        raise HTTPException(status_code=404, detail="Deck theme not found.")
    return deck


def _audit(admin: User, action: str, resource_type: str, resource_id: object, details: dict[str, object]) -> AdminAuditLog:
    return AdminAuditLog(admin_user_id=admin.id, action=action, resource_type=resource_type, resource_id=str(resource_id), details=json.dumps(details, sort_keys=True))


@router.get("/decks", response_model=list[CardDeckResponse])
async def active_decks(session: Annotated[AsyncSession, Depends(get_session)]) -> list[CardDeckResponse]:
    decks = (await session.scalars(select(CardDeck).where(CardDeck.active.is_(True)).order_by(CardDeck.name))).all()
    return [await _response(session, deck) for deck in decks]


@router.get("/admin/decks", response_model=list[CardDeckResponse])
async def all_decks(_: Annotated[tuple[User, AuthIdentity], Depends(require_admin)], session: Annotated[AsyncSession, Depends(get_session)]) -> list[CardDeckResponse]:
    decks = (await session.scalars(select(CardDeck).order_by(CardDeck.name))).all()
    return [await _response(session, deck) for deck in decks]


@router.post("/admin/decks", response_model=CardDeckResponse, status_code=201)
async def create_deck(payload: CardDeckCreate, profile: Annotated[tuple[User, AuthIdentity], Depends(require_admin)], session: Annotated[AsyncSession, Depends(get_session)]) -> CardDeckResponse:
    admin = profile[0]
    if payload.active:
        raise HTTPException(status_code=422, detail="Add a BACK asset before activating a deck theme.")
    deck = CardDeck(slug=payload.slug, name=payload.name.strip(), active=payload.active, created_by_id=admin.id)
    session.add(deck)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Deck slug is already in use.") from None
    session.add(_audit(admin, "deck.create", "card_deck", deck.id, payload.model_dump()))
    await session.commit()
    return await _response(session, deck)


@router.patch("/admin/decks/{deck_id}", response_model=CardDeckResponse)
async def update_deck(deck_id: UUID, payload: CardDeckUpdate, profile: Annotated[tuple[User, AuthIdentity], Depends(require_admin)], session: Annotated[AsyncSession, Depends(get_session)]) -> CardDeckResponse:
    deck = await _deck(session, deck_id)
    changes = payload.model_dump(exclude_none=True)
    if changes.get("active") is True:
        back = await session.scalar(select(CardAsset).where(CardAsset.deck_id == deck.id, CardAsset.card_key == "BACK"))
        if back is None:
            raise HTTPException(status_code=422, detail="An active deck theme requires a BACK asset.")
    for key, value in changes.items():
        setattr(deck, key, value.strip() if isinstance(value, str) else value)
    session.add(_audit(profile[0], "deck.update", "card_deck", deck.id, changes))
    await session.commit()
    return await _response(session, deck)


@router.post("/admin/decks/{deck_id}/assets", response_model=CardAssetResponse, status_code=201)
async def add_asset(deck_id: UUID, payload: CardAssetInput, profile: Annotated[tuple[User, AuthIdentity], Depends(require_admin)], session: Annotated[AsyncSession, Depends(get_session)]) -> CardAssetResponse:
    await _deck(session, deck_id)
    asset = CardAsset(deck_id=deck_id, card_key=payload.card_key, asset_url=payload.asset_url, checksum_sha256=payload.checksum_sha256.casefold())
    session.add(asset)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status_code=409, detail="That card asset already exists in this deck.") from None
    session.add(_audit(profile[0], "asset.create", "card_asset", asset.id, {"deck_id": str(deck_id), "card_key": asset.card_key}))
    await session.commit()
    return CardAssetResponse(id=asset.id, card_key=asset.card_key, asset_url=asset.asset_url, checksum_sha256=asset.checksum_sha256)


@router.delete("/admin/assets/{asset_id}", response_model=MessageResponse)
async def delete_asset(asset_id: UUID, profile: Annotated[tuple[User, AuthIdentity], Depends(require_admin)], session: Annotated[AsyncSession, Depends(get_session)]) -> MessageResponse:
    asset = await session.get(CardAsset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="Card asset not found.")
    deck = await _deck(session, asset.deck_id)
    if deck.active and asset.card_key == "BACK":
        raise HTTPException(status_code=409, detail="Deactivate the deck before deleting its BACK asset.")
    session.add(_audit(profile[0], "asset.delete", "card_asset", asset.id, {"card_key": asset.card_key}))
    await session.delete(asset)
    await session.commit()
    return MessageResponse(message="Card asset deleted.")
