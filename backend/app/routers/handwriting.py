import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from ..auth import require_user
from ..models.user import User

router = APIRouter(prefix="/handwriting", tags=["handwriting"])


class RecognizeRequest(BaseModel):
    strokes: list   # [[[x...], [y...], [t...]], ...]
    width: float = 300
    height: float = 300


@router.post("/recognize")
async def recognize(
    body: RecognizeRequest,
    _: User = Depends(require_user),
):
    url = "https://inputtools.google.com/request"
    params = {
        "itc": "zh-t-i0-handwrit",
        "num": "8",
        "cp": "0",
        "cs": "1",
        "ie": "utf-8",
        "oe": "utf-8",
        "app": "demopage",
    }
    payload = {
        "pre_context": "",
        "requests": [{
            "max_completions": 0,
            "ink": body.strokes,
            "language": "zh-CN",
            "writing_guide": {
                "writing_area_width": body.width,
                "writing_area_height": body.height,
            },
        }],
    }
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.post(url, params=params, json=payload)
            data = resp.json()
        if not data or data[0] != "SUCCESS":
            return {"candidates": []}
        candidates = data[1][0][1] if len(data) > 1 and data[1] else []
        return {"candidates": candidates[:8]}
    except Exception:
        return {"candidates": []}
