from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base, sessionmaker
from .config import settings

# Railway provides postgres:// but SQLAlchemy 2.x requires postgresql://
db_url = settings.DATABASE_URL.replace("postgres://", "postgresql://", 1)
engine = create_engine(db_url)


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
