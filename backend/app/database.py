from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base, sessionmaker
from .config import settings

engine = create_engine(settings.DATABASE_URL)


@event.listens_for(engine, "connect")
def _set_timezone(dbapi_conn, _):
    with dbapi_conn.cursor() as cur:
        cur.execute("SET TIME ZONE 'Asia/Bangkok'")
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
