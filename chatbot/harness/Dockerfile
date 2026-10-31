FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 CAMPUS_DB_PATH=/data/kyungnam.db
WORKDIR /app/harness
COPY harness/requirements.lock /app/harness/requirements.lock
RUN pip install --no-cache-dir -r requirements.lock && useradd --uid 10001 --create-home campus
COPY search.py /app/search.py
COPY harness/campus_bot /app/harness/campus_bot
USER 10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz',timeout=3)"
CMD ["python","-m","uvicorn","campus_bot.app:app","--host","0.0.0.0","--port","8000","--limit-concurrency","64"]
