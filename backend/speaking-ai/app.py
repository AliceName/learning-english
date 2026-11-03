"""Local-only model service. Public authentication/persistence belong to .NET."""
from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from engine import MAX_BYTES, EngineBusyError, RecordingError, SpeakingEngine


class BodyLimit:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        consumed, started = 0, False

        async def limited_receive():
            nonlocal consumed
            message = await receive()
            consumed += len(message.get('body', b''))
            if consumed > MAX_BYTES + 64 * 1024:
                raise RecordingError('Yêu cầu vượt quá 2 MB.')
            return message

        async def track_send(message):
            nonlocal started
            if message['type'] == 'http.response.start':
                started = True
            await send(message)
        try:
            await self.app(scope, limited_receive, track_send)
        except RecordingError:
            if started:
                raise
            await JSONResponse({'title': 'Yêu cầu vượt quá 2 MB.'}, status_code=413)(scope, receive, send)


def create_app(engine=None):
    @asynccontextmanager
    async def lifespan(app):
        app.state.engine = engine if engine is not None else await run_in_threadpool(SpeakingEngine)
        yield

    application = FastAPI(title='LinguaAI Speaking', lifespan=lifespan)
    application.add_middleware(BodyLimit)

    @application.get('/health')
    def health(request: Request):
        scorer = request.app.state.engine
        return {'status': 'ready', 'modelVersion': scorer.model_version, 'maxRecordingSeconds': 12}

    @application.post('/score')
    async def score(request: Request, file: UploadFile = File(), text: str = Form(min_length=1, max_length=300)):
        try:
            data = await file.read(MAX_BYTES + 1)
            if len(data) > MAX_BYTES:
                return JSONResponse({'title': 'Audio tối đa 2 MB.'}, status_code=413)
            result = await run_in_threadpool(request.app.state.engine.score, data, text)
            return JSONResponse(result, headers={'Cache-Control': 'no-store'})
        except RecordingError as exc:
            return JSONResponse({'title': str(exc)}, status_code=422)
        except EngineBusyError as exc:
            return JSONResponse({'title': str(exc)}, status_code=429, headers={'Retry-After': '3'})
        except Exception:
            logging.exception('Speaking inference failed')
            return JSONResponse({'title': 'Bộ chấm tạm thời không xử lý được bản ghi. Vui lòng thử lại.'}, status_code=503)
        finally:
            await file.close()

    return application


app = create_app()
