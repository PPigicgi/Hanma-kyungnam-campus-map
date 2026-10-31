from concurrent.futures import ThreadPoolExecutor
from datetime import date
import sqlite3

from fastapi.testclient import TestClient
from pydantic import ValidationError
import pytest

from campus_bot.app import create_app
from campus_bot.contracts import ChatRequest
from campus_bot.evaluate import evaluate
from campus_bot.graph import CampusBot
from campus_bot.llm import LLMSettings
from campus_bot.retrieval import resolve_period,topic_for,contextual_question


@pytest.fixture(scope='module')
def bot():return CampusBot(llm_settings=LLMSettings(mode='off'))


def test_grounded_cases(bot):
    result=evaluate(bot)
    assert result['passed']==result['total'],[(r['question'],r['errors']) for r in result['cases'] if not r['passed']]


@pytest.mark.parametrize('question',['','  ','x'*2001])
def test_bad_questions(question):
    with pytest.raises(ValidationError):ChatRequest(question=question)


def test_history_bounds():
    with pytest.raises(ValidationError):ChatRequest(question='휴학',history=['x']*5)


def test_read_only(bot):
    with bot.repo.connect() as db:
        with pytest.raises(sqlite3.OperationalError):db.execute("UPDATE documents SET title='bad' WHERE id=1")


def test_graph_nodes(bot):
    assert {'normalize','analyze','retrieve','answer','validate'}<=set(bot.graph.get_graph().nodes)


def test_parallel_requests_are_isolated(bot):
    questions=['2026년 12월 기말고사','복학 신청 방법','2027년 3월 일정','통학버스 현금']
    with ThreadPoolExecutor(max_workers=4) as pool:
        responses=list(pool.map(lambda q:bot.ask(ChatRequest(question=q,as_of=date(2026,10,30))),questions))
    assert len({r.request_id for r in responses})==4
    assert '2026-12-15' in responses[0].answer
    assert '복학' in responses[1].answer
    assert responses[2].outcome=='not_found'
    assert '현금사용은 불가' in responses[3].answer


def test_calendar_boundaries():
    assert resolve_period('다음 달 학사일정',date(2026,12,31))[:2]==(date(2027,1,1),date(2027,1,31))
    assert resolve_period('내년 2학기 일정',date(2026,1,1))[:2]==(date(2027,9,1),date(2028,2,29))
    assert resolve_period('다음 주 일정',date(2026,10,30))[:2]==(date(2026,11,2),date(2026,11,8))
    assert resolve_period('다음 학기 일정',date(2026,10,30))[:2]==(date(2027,3,1),date(2027,8,31))
    assert resolve_period('지난 학기 일정',date(2026,10,30))[:2]==(date(2026,3,1),date(2026,8,31))


def test_specific_topics_and_followups():
    assert topic_for('졸업증명서 발급 방법')[0]=='증명서'
    q=contextual_question('그럼 다음 달은?',['2026년 12월 학사일정'],date(2026,10,30))
    assert resolve_period(q,date(2026,10,30))[:2]==(date(2027,1,1),date(2027,1,31))
    q=contextual_question('그럼 다음 달은?',['2026년 12월 학사일정','그럼 다음 달은?'],date(2026,10,30))
    assert resolve_period(q,date(2026,10,30))[:2]==(date(2027,2,1),date(2027,2,28))


def test_new_topic_overrides_previous_calendar(bot):
    for question,path in [('그럼 졸업증명서 발급 방법은?','/ko/6941/subview.do'),('그럼 휴학 신청 방법은?','/ko/4401/subview.do'),('졸업증명서 발급은 언제 돼?','/ko/6941/subview.do')]:
        response=bot.ask(ChatRequest(question=question,history=['2026년 12월 학사일정'],as_of=date(2026,10,30)))
        assert response.outcome=='answered'
        assert response.sources[0].url.endswith(path)
        assert not response.events


def test_http_actual_graph():
    with TestClient(create_app(llm_settings=LLMSettings(mode='off'))) as client:
        assert client.get('/healthz').json()['ready']
        reply=client.post('/api/chat',json={'question':'2027년 1월 계절학기','as_of':'2026-10-30'})
        assert reply.status_code==200
        assert reply.json()['events'][0]['start']=='2026-12-22'
        assert reply.json()['trace']==['normalize','analyze','retrieve','answer','validate']
        assert client.post('/api/chat',json={'question':' '}).status_code==422
        assert client.post('/api/chat',json={'question':'x','as_of':'bad'}).status_code==422
        assert client.get('/').status_code==200
        assert 'frame-ancestors' in client.get('/').headers['content-security-policy']
        assert client.get('/static/app.js').status_code==200


def test_unavailable_db(tmp_path):
    with TestClient(create_app(tmp_path/'missing.db')) as client:
        assert client.get('/healthz').status_code==503
        response=client.post('/api/chat',json={'question':'학사일정'})
        assert response.status_code==503
        assert response.json()['outcome']=='unavailable'
        assert not (tmp_path/'missing.db').exists()


