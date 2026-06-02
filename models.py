"""
models.py — SIVARR Pydantic request/response models
All FastAPI request body models live here.
Import with: from models import LoginRequest, ChatRequest, ...
"""

import re
from pydantic import BaseModel, validator
from config import MAX_MESSAGE_LEN, MAX_NAME_LEN


def _sanitize(text: str, max_len: int = MAX_MESSAGE_LEN) -> str:
    """Inline sanitise for validator use (avoids circular import with utils)."""
    if not text:
        return ""
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text).strip()
    return text[:max_len]


# ── Auth ─────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    name: str             = ""       # required only for register
    email: str
    password: str         = ""
    confirm_password: str = ""       # register only
    phone: str            = ""
    action: str           = "login"  # "login" | "register"

    @validator("email")
    def email_valid(cls, v):
        v = _sanitize(v, 200).lower().strip()
        if not v:
            raise ValueError("Email is required.")
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", v):
            raise ValueError("Enter a valid email address.")
        return v


class AdminLoginRequest(BaseModel):
    password: str


class LecturerLoginRequest(BaseModel):
    password: str
    name: str = ""


# ── Chat & Quiz ──────────────────────────────────────────────────

class ChatRequest(BaseModel):
    sid: str
    message: str
    context: str = ""

    @validator("message")
    def msg_valid(cls, v):
        v = _sanitize(v, MAX_MESSAGE_LEN)
        if not v:
            raise ValueError("Message cannot be empty.")
        return v

    @validator("sid")
    def sid_valid(cls, v):
        v = _sanitize(v, 100)
        if not v:
            raise ValueError("Session ID required.")
        return v


class QuizRequest(BaseModel):
    sid: str
    topic: str
    difficulty: str
    answer: str
    question: str
    correct: str
    explanation: str

    @validator("difficulty")
    def diff_valid(cls, v):
        if v not in ["easy", "medium", "hard"]:
            raise ValueError("Invalid difficulty.")
        return v

    @validator("answer", "correct")
    def answer_valid(cls, v):
        v = v.strip().upper()
        if v not in ["A", "B", "C", "D"]:
            raise ValueError("Answer must be A, B, C, or D.")
        return v


class DifficultyRequest(BaseModel):
    sid: str
    level: str

    @validator("level")
    def level_valid(cls, v):
        if v not in ["easy", "medium", "hard"]:
            raise ValueError("Level must be easy, medium, or hard.")
        return v


# ── Academic ──────────────────────────────────────────────────────

class AnnouncementRequest(BaseModel):
    token: str
    title: str
    body: str


class TopicsRequest(BaseModel):
    token: str
    topics: list


class CreateClassRequest(BaseModel):
    token: str
    name: str
    code: str = ""


class JoinClassRequest(BaseModel):
    token: str
    code: str


class MaterialRequest(BaseModel):
    token: str
    class_code: str
    title: str
    content: str
    material_type: str = "note"


class ClassAnnouncementRequest(BaseModel):
    token: str
    class_code: str
    title: str
    body: str


class LiveClassRequest(BaseModel):
    token: str
    class_code: str
    meeting_url: str
    title: str = "Live Class"


class AssignmentRequest(BaseModel):
    token: str
    class_code: str
    title: str
    description: str
    due_date: str = ""


class SubmitAssignmentRequest(BaseModel):
    token: str
    class_code: str
    assignment_id: str
    submission: str


class DiscussionRequest(BaseModel):
    token: str
    class_code: str
    message: str


class AssignExamRequest(BaseModel):
    token: str
    class_code: str
    exam_id: str
    due_date: str = ""


class StudyPlanRequest(BaseModel):
    token: str
    topics: list
    hours_per_day: int = 2
    days: int = 7
    goal: str = ""
