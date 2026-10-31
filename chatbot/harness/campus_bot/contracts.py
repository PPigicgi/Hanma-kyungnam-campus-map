from datetime import date, datetime, timedelta, timezone
from pathlib import Path
import os
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

KST = timezone(timedelta(hours=9))
DEFAULT_DB = Path(__file__).resolve().parents[2] / "kyungnam.db"


def database_path() -> Path:
    return Path(os.getenv("CAMPUS_DB_PATH", str(DEFAULT_DB))).expanduser().resolve()


def today_kst() -> date:
    return datetime.now(KST).date()


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=1, max_length=2000)
    history: list[str] = Field(default_factory=list, max_length=4)
    as_of: date | None = None

    @field_validator("question")
    @classmethod
    def not_blank(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("질문을 입력해 주세요.")
        return value

    @field_validator("history")
    @classmethod
    def bounded_history(cls, values):
        if any(not v.strip() or len(v)>2000 for v in values):
            raise ValueError("이전 질문은 1~2000자여야 합니다.")
        return values


class Source(BaseModel):
    document_id: int
    title: str
    url: str
    quote: str
    fetched_at: str
    modified_at: str | None = None
    published_at: str | None = None


class Event(BaseModel):
    title: str
    start: date
    end: date
    note: str = ""
    source_id: int


class Generation(BaseModel):
    mode: Literal['source', 'openai', 'codex', 'source_fallback'] = 'source'
    model: str | None = None
    reason: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None


class ChatResponse(BaseModel):
    status: str
    outcome: str
    summary: str
    answer: str
    sources: list[Source] = Field(default_factory=list)
    events: list[Event] = Field(default_factory=list)
    as_of: date
    data_as_of: str
    warnings: list[str] = Field(default_factory=list)
    next_actions: list[str] = Field(default_factory=list)
    artifacts: list[str] = Field(default_factory=list)
    request_id: str
    trace: list[str]
    elapsed_ms: float
    generation: Generation = Field(default_factory=Generation)
    search_queries: list[str] = Field(default_factory=list)
    analysis: Generation = Field(default_factory=Generation)


def unavailable(question: str, when: date) -> dict:
    return dict(status="error", outcome="unavailable", summary="안내 자료를 열 수 없습니다.",
                answer="안내 자료에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
                sources=[], events=[], as_of=when.isoformat(), data_as_of="",
                warnings=["자료 연결 오류"], next_actions=["운영자는 DB 경로와 읽기 권한을 확인한 뒤 다시 시작하세요. 연결이 복구되기 전에는 반복 요청하지 마세요."],
                artifacts=[], request_id="", trace=[], elapsed_ms=0)
