from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.ocr_note import OcrNote
from ..schemas.ocr_note import OcrNoteCreate, OcrNoteOut
from ..auth import require_user
from ..models.user import User

router = APIRouter(prefix="/ocr-notes", tags=["ocr-notes"])


@router.get("", response_model=list[OcrNoteOut])
def list_ocr_notes(
    q: str = Query(default=""),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    query = db.query(OcrNote).filter(OcrNote.user_id == current_user.id)
    if q:
        query = query.filter(OcrNote.translation_text.ilike(f"%{q}%"))
    return query.order_by(OcrNote.updated_at.desc()).all()


@router.post("", response_model=OcrNoteOut)
def create_ocr_note(
    data: OcrNoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    note = OcrNote(user_id=current_user.id, **data.model_dump())
    db.add(note)
    db.commit()
    db.refresh(note)
    return note


@router.delete("/{note_id}")
def delete_ocr_note(
    note_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    note = db.query(OcrNote).filter(
        OcrNote.id == note_id, OcrNote.user_id == current_user.id
    ).first()
    if not note:
        raise HTTPException(status_code=404, detail="ไม่พบโน้ต")
    db.delete(note)
    db.commit()
    return {"ok": True}
