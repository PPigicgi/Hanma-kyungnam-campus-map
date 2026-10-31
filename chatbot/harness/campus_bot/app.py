from contextlib import asynccontextmanager,closing
import logging
from pathlib import Path
import sqlite3

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .contracts import ChatRequest, ChatResponse, database_path, today_kst, unavailable
from .graph import CampusBot

STATIC=Path(__file__).with_name('static')
logger=logging.getLogger('campus_bot')


def create_app(db_path=None, *, llm_settings=None, answerer=None):
    @asynccontextmanager
    async def lifespan(app):
        try:
            app.state.bot=CampusBot(db_path or database_path(),llm_settings=llm_settings,answerer=answerer)
        except (OSError,ValueError,sqlite3.Error):
            logger.error('Campus DB cannot be opened; verify CAMPUS_DB_PATH and schema.')
            app.state.bot=None
        try:
            yield
        finally:
            if app.state.bot:
                app.state.bot.close()

    app=FastAPI(title='한마',version='1.1.0',lifespan=lifespan)

    @app.middleware('http')
    async def headers(request,call_next):
        response=await call_next(request)
        response.headers['X-Content-Type-Options']='nosniff'
        response.headers['Referrer-Policy']='no-referrer'
        if request.url.path in {'/','/mobile','/mobile/'} or request.url.path.startswith('/static'):
            response.headers['Content-Security-Policy']="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"
        if request.url.path.startswith('/api/'):
            response.headers['Cache-Control']='no-store'
        return response

    @app.get('/healthz')
    def health(request:Request):
        bot=request.app.state.bot
        if not bot:
            return JSONResponse({'status':'error','ready':False},status_code=503)
        try:
            with closing(bot.repo.connect()) as db:
                db.execute('SELECT 1 FROM documents LIMIT 1').fetchone()
        except sqlite3.Error:
            return JSONResponse({'status':'error','ready':False},status_code=503)
        return {'status':'success','ready':True,'data_as_of':bot.repo.data_as_of,'searchable_documents':bot.repo.count,
                'llm':bot.answerer.public()}

    @app.get('/api/info')
    def info(request:Request):
        bot=request.app.state.bot
        return {'ready':bool(bot),'data_as_of':bot.repo.data_as_of if bot else '',
                'today':today_kst().isoformat(),'timezone':'Asia/Seoul',
                'llm':bot.answerer.public() if bot else {'state':'unavailable','configured':False},
                'examples':['이번 달 학사일정','기말고사 언제야?','휴학 신청 방법','통학버스 현금 가능해?']}

    @app.post('/api/chat',response_model=ChatResponse)
    def chat(payload:ChatRequest,request:Request):
        bot=request.app.state.bot
        if not bot:
            return JSONResponse(unavailable(payload.question,payload.as_of or today_kst()),status_code=503)
        try:
            return bot.ask(payload)
        except (sqlite3.Error,OSError,ValueError):
            logger.error('Campus answer failed; verify the database and application configuration.')
            return JSONResponse(unavailable(payload.question,payload.as_of or today_kst()),status_code=503)

    @app.get('/')
    def index():
        return FileResponse(STATIC/'index.html')

    @app.get('/mobile',include_in_schema=False,response_class=HTMLResponse)
    def mobile_index():
        # One shared chat document; this entry point always uses the mobile styles.
        html=(STATIC/'index.html').read_text(encoding='utf-8')
        return HTMLResponse(html.replace('<body>','<body class="mobile-view">')
                            .replace('media="(max-width:700px)"','media="all"')
                            .replace('href="/"','href="/mobile"'))

    app.mount('/static',StaticFiles(directory=STATIC),name='static')
    return app


app=create_app()
