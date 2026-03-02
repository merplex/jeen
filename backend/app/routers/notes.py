from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.user_note import UserNote
from ..schemas.note import NoteOut, NoteCreate, NoteUpdate
from ..auth import require_user
from ..models.user import User

router = APIRouter(prefix="/notes", tags=["notes"])


@router.get("", response_model=list[NoteOut])
def list_notes(
    q: str = Query(default=""),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    query = db.query(UserNote).filter(UserNote.user_id == current_user.id)
    if q:
        query = query.filter(UserNote.note_text.ilike(f"%{q}%"))
    return query.order_by(UserNote.updated_at.desc()).all()


@router.post("", response_model=NoteOut)
def create_note(
    data: NoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    note = UserNote(user_id=current_user.id, **data.model_dump())
    db.add(note)
    db.commit()
    db.refresh(note)
    return note


@router.put("/{note_id}", response_model=NoteOut)
def update_note(
    note_id: int,
    data: NoteUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    note = db.query(UserNote).filter(
        UserNote.id == note_id, UserNote.user_id == current_user.id
    ).first()
    if not note:
        raise HTTPException(status_code=404, detail="ไม่พบโน้ต")
    note.note_text = data.note_text
    db.commit()
    db.refresh(note)
    return note


@router.delete("/{note_id}")
def delete_note(
    note_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    note = db.query(UserNote).filter(
        UserNote.id == note_id, UserNote.user_id == current_user.id
    ).first()
    if not note:
        raise HTTPException(status_code=404, detail="ไม่พบโน้ต")
    db.delete(note)
    db.commit()
    return {"ok": True}
