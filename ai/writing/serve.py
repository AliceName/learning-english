"""Run with uvicorn serve:app --app-dir ai/writing --host 127.0.0.1 --port 8000 --workers 1."""
from contextlib import asynccontextmanager
import asyncio
import logging
import os
from pathlib import Path
import threading

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from data import ROOT
from inference import WritingEngine, InputBudgetError, EngineBusyError
from local_feedback import FeedbackEngine, FeedbackBusyError


class WritingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    text: str = Field(min_length=1, max_length=12000)
    corrections: bool = False

    @field_validator("text")
    @classmethod
    def nonempty(cls, value):
        if not value.strip():
            raise ValueError("Bài viết không được để trống.")
        return value


class AcceptedExplanation(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    category: str = Field(min_length=1, max_length=100)
    original: str = Field(max_length=12000)
    suggestion: str = Field(max_length=24000)
    message: str = Field(min_length=1, max_length=1000)
    templateVersion: str = Field(min_length=1, max_length=100)


class AcceptedSuggestion(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    original: str = Field(min_length=1, max_length=12000)
    suggestion: str = Field(max_length=24000)
    explanations: list[AcceptedExplanation] | None = Field(default=None, max_length=40)


class FeedbackRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    text: str = Field(min_length=1, max_length=12000)
    topic: str | None = Field(default=None, max_length=500)
    errors: list[AcceptedSuggestion] = Field(default_factory=list, max_length=200)

    @field_validator("text")
    @classmethod
    def nonempty(cls, value):
        if not value.strip():
            raise ValueError("Bài viết không được để trống.")
        return value


def create_app(engine_factory=None, feedback_factory=None):
    @asynccontextmanager
    async def lifespan(app):
        if engine_factory:
            app.state.engine = engine_factory()
        else:
            cefr = Path(os.getenv("WRITING_CEFR_RUN", str(ROOT / "artifacts/cefr-my-first-run")))
            gec = os.getenv("WRITING_GEC_RUN")
            app.state.engine = WritingEngine(cefr, Path(gec) if gec else None,
                                             os.getenv("WRITING_DEVICE", "auto"))
        app.state.feedback_engine = feedback_factory() if feedback_factory else FeedbackEngine.from_env()
        try:
            yield
        finally:
            app.state.feedback_engine.close()
            app.state.engine = None

    app = FastAPI(title="Local Writing AI", lifespan=lifespan)

    @app.get("/health")
    def health(request: Request):
        engine = request.app.state.engine
        return {"status": "ready", "correctionsEnabled": engine.gec is not None,
                "cefrRun": getattr(getattr(engine, "cefr", None), "run_name", None),
                "gecRun": getattr(engine.gec, "run_name", None),
                **request.app.state.feedback_engine.health()}

    @app.get("/internal/writing/capabilities")
    def capabilities(request: Request):
        engine = request.app.state.engine
        feedback = request.app.state.feedback_engine.health()
        enabled = bool(feedback.get("feedbackEnabled"))
        return {"status": "ready", "busy": engine.lock.locked(), **engine.processing_limits(), "feedbackEnabled": enabled,
                "feedbackStatus": "enabled" if enabled else
                    "unavailable" if feedback.get("feedbackStatus") == "configuration_error" else "disabled"}

    @app.post("/internal/writing/preflight")
    def preflight(body: WritingRequest, request: Request):
        try:
            return request.app.state.engine.preflight(body.text, body.corrections)
        except Exception as error:
            logging.getLogger(__name__).error("Writing preflight failed: %s", type(error).__name__)
            raise HTTPException(status_code=503, detail="Chưa kiểm tra được giới hạn bài viết. Hãy thử lại sau.") from error

    @app.post("/internal/writing/feedback")
    async def feedback(body: FeedbackRequest, request: Request):
        engine = request.app.state.feedback_engine
        cancelled = threading.Event()
        task = asyncio.create_task(asyncio.to_thread(engine.analyze, body.text, body.topic,
            [item.model_dump() for item in body.errors], cancelled))
        try:
            while not task.done():
                if await request.is_disconnected():
                    engine.cancel(cancelled)
                    # The worker owns process teardown and lock release. Its
                    # errors are intentionally not echoed into the response.
                    await asyncio.shield(task)
                    raise HTTPException(status_code=499, detail="Đã dừng yêu cầu nhận xét.")
                await asyncio.wait({task}, timeout=0.05)
            return await task
        except FeedbackBusyError as error:
            raise HTTPException(status_code=429, detail=str(error)) from error
        except asyncio.CancelledError:
            engine.cancel(cancelled)
            task.add_done_callback(lambda completed: completed.exception() if not completed.cancelled() else None)
            raise

    @app.post("/internal/writing/analyze")
    def analyze(body: WritingRequest, request: Request):
        try:
            return request.app.state.engine.analyze(body.text, body.corrections)
        except InputBudgetError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        except EngineBusyError as error:
            raise HTTPException(status_code=429, detail=str(error)) from error
        except Exception as error:
            logging.getLogger(__name__).error("Writing inference failed: %s", type(error).__name__)
            raise HTTPException(status_code=503, detail="AI chưa thể xử lý bài viết. Vui lòng thử lại sau.") from error

    return app


app = create_app()
