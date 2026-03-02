import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .database import Base, engine
from .routers import search, words, users, flashcard, admin, notes

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Thai-Chinese Dictionary API", version="1.0.0")

ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:5173",
    os.getenv("FRONTEND_URL", ""),
    "https://thaidict.vercel.app",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o for o in ALLOWED_ORIGINS if o],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(search.router)
app.include_router(words.router)
app.include_router(users.router)
app.include_router(flashcard.router)
app.include_router(admin.router)
app.include_router(notes.router)


@app.get("/")
def root():
    return {"message": "Thai-Chinese Dictionary API", "docs": "/docs"}


@app.get("/health")
def health_check():
    return {"status": "ok"}
