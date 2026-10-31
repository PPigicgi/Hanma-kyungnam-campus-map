from datetime import date
import json
from time import monotonic
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import httpx2
from openai import OpenAI
import pytest

from campus_bot.contracts import ChatRequest
from campus_bot.graph import CampusBot,NO_DATA,fallback_plan
from campus_bot.llm import LLMSettings,OpenAIAnswerer,SearchPlan,remaining_seconds,GenerationFailure
from test_llm import response_json
from test_codex import fixture_bot,VALID


def test_planner_precedes_search_and_uses_synonyms(monkeypatch):
    phases=[]
    def transport(request):
        body=json.loads(request.content);payload=json.loads(body['input'])
        if payload.get('phase')=='analyze':
            phases.append('plan')
            assert payload['question']=='차 가지고 가면 돈 내야 해?'
            assert payload['history']==['학교에 가려고 해']
            plan=SearchPlan(resolved_question='경남대학교 교내 주차 요금',queries=['주차 요금'],intent='general',calendar_query=None)
            return httpx2.Response(200,json=response_json(plan.model_dump(mode='json')))
        phases.append('answer')
        assert payload['question']=='차 가지고 가면 돈 내야 해?'
        assert any('주차요금' in s['title'] for s in payload['sources'])
        return httpx2.Response(200,json=response_json({'sufficient':False,'claims':[]}))
    settings=LLMSettings(mode='openai',model='test',api_key='test')
    client=OpenAI(api_key='test',http_client=httpx2.Client(transport=httpx2.MockTransport(transport)))
    bot=CampusBot(answerer=OpenAIAnswerer(settings,client=client))
    original=bot.repo.planned_search
    def search(queries):
        phases.append('search');assert queries==['주차 요금'];return original(queries)
    monkeypatch.setattr(bot.repo,'planned_search',search)
    try:
        result=bot.ask(ChatRequest(question='차 가지고 가면 돈 내야 해?',history=['학교에 가려고 해']))
        assert phases==['plan','search','answer']
        assert result.search_queries==['주차 요금'] and result.analysis.mode=='openai'
        assert result.answer==NO_DATA
    finally:bot.close()


@pytest.mark.parametrize('question',['내 성적은 어디서 확인해?','등록금 확인 방법','비밀번호 재설정 방법','오늘 식당 운영시간','도서관 자리 예약 방법'])
def test_public_guidance_is_not_personal_or_realtime_denial(question):
    plan=fallback_plan(question,[],date(2026,10,30))
    assert plan.intent=='general'


def test_planned_corpus_search_is_not_topic_whitelist():
    bot=CampusBot(llm_settings=LLMSettings(mode='off'))
    assert any('주차요금' in s.title for s in bot.repo.planned_search(['주차 요금']))
    assert any('보건진료소' in s.title for s in bot.repo.planned_search(['보건진료소']))
    assert not bot.repo.planned_search(['초공간양자순간이동정류장'])


def test_explicit_calendar_dates_survive_bad_plan_rewrite():
    def transport(request):
        p=json.loads(json.loads(request.content)['input'])
        if p.get('phase')=='analyze':
            plan=SearchPlan(resolved_question='2030년 1월 기말고사',queries=['기말고사'],intent='calendar',calendar_query='2030년 1월 개강')
            return httpx2.Response(200,json=response_json(plan.model_dump(mode='json')))
        assert p['question']=='2026년 12월 기말고사 언제야?'
        assert p['events'][0]['start']=='2026-12-15'
        s=p['sources'][0]
        result={'sufficient':True,'claims':[{'text':'기말고사 일정입니다.','document_id':s['document_id'],'quote':s['quote']}]}
        return httpx2.Response(200,json=response_json(result))
    settings=LLMSettings(mode='openai',model='test',api_key='test')
    client=OpenAI(api_key='test',http_client=httpx2.Client(transport=httpx2.MockTransport(transport)))
    bot=CampusBot(answerer=OpenAIAnswerer(settings,client=client))
    try:
        result=bot.ask(ChatRequest(question='2026년 12월 기말고사 언제야?',as_of=date(2026,10,30)))
        assert '2026-12-15 ~ 2026-12-21' in result.answer
        assert '2030' not in result.answer
    finally:bot.close()


@pytest.mark.parametrize('event',['학위수여식','없는특별학사행사'])
def test_unknown_specific_event_never_becomes_all_month_events(event):
    def transport(request):
        p=json.loads(json.loads(request.content)['input'])
        assert p.get('phase')=='analyze'  # No matching event: no answer-generation call.
        plan=SearchPlan(resolved_question=f'2026년 12월 {event}',queries=[event],intent='calendar',calendar_query=event)
        return httpx2.Response(200,json=response_json(plan.model_dump(mode='json')))
    client=OpenAI(api_key='test',http_client=httpx2.Client(transport=httpx2.MockTransport(transport)))
    bot=CampusBot(answerer=OpenAIAnswerer(LLMSettings(mode='openai',model='test',api_key='test'),client=client))
    try:
        reply=bot.ask(ChatRequest(question=f'2026년 12월 {event} 언제야?',as_of=date(2026,10,30)))
        assert reply.outcome=='not_found' and NO_DATA in reply.answer
        assert reply.events==[] and '기말고사기간' not in reply.answer
    finally:bot.close()


def test_analyzed_followup_period_is_used_when_current_question_has_no_date():
    def transport(request):
        p=json.loads(json.loads(request.content)['input'])
        if p.get('phase')=='analyze':
            plan=SearchPlan(resolved_question='2026년 4월 중간고사',queries=['중간고사'],intent='calendar',calendar_query='중간고사')
            return httpx2.Response(200,json=response_json(plan.model_dump(mode='json')))
        assert all(e['start'].startswith('2026-04') for e in p['events'])
        s=p['sources'][0]
        return httpx2.Response(200,json=response_json({'sufficient':True,'claims':[{'text':'중간고사 기간입니다.','document_id':s['document_id'],'quote':s['quote']}]}))
    client=OpenAI(api_key='test',http_client=httpx2.Client(transport=httpx2.MockTransport(transport)))
    bot=CampusBot(answerer=OpenAIAnswerer(LLMSettings(mode='openai',model='test',api_key='test'),client=client))
    try:
        reply=bot.ask(ChatRequest(question='그달 중간고사는 언제야?',history=['2026년 4월 학사일정'],as_of=date(2026,10,30)))
        assert reply.outcome=='answered' and '2026년 4월' in reply.answer
        assert '2026-10-' not in reply.answer
    finally:bot.close()


def test_calendar_generation_insufficient_means_no_data():
    def transport(request):
        p=json.loads(json.loads(request.content)['input'])
        if p.get('phase')=='analyze':
            plan=SearchPlan(resolved_question=p['question'],queries=['기말고사'],intent='calendar',calendar_query='기말고사')
            return httpx2.Response(200,json=response_json(plan.model_dump(mode='json')))
        return httpx2.Response(200,json=response_json({'sufficient':False,'claims':[]}))
    client=OpenAI(api_key='test',http_client=httpx2.Client(transport=httpx2.MockTransport(transport)))
    bot=CampusBot(answerer=OpenAIAnswerer(LLMSettings(mode='openai',model='test',api_key='test'),client=client))
    try:
        reply=bot.ask(ChatRequest(question='2026년 12월 기말고사 언제야?',as_of=date(2026,10,30)))
        assert reply.outcome=='not_found' and reply.answer==NO_DATA and not reply.events
    finally:bot.close()


@pytest.mark.parametrize('suffix',['보여줘','알려 주세요','좀 정리해줘'])
def test_offline_schedule_request_phrasing_keeps_full_schedule(suffix):
    bot=CampusBot(llm_settings=LLMSettings(mode='off'))
    plain=bot.ask(ChatRequest(question='2026년 12월 학사일정',as_of=date(2026,10,30)))
    polite=bot.ask(ChatRequest(question=f'2026년 12월 학사일정 {suffix}',as_of=date(2026,10,30)))
    assert polite.outcome=='answered' and polite.events==plain.events
    _,events,_,_=bot.repo.calendar(f'2026년 12월 없는특별학사행사 {suffix}',date(2026,10,30))
    assert not events


def test_shared_deadline_covers_both_native_calls(tmp_path):
    # Each phase fits a 3s adapter cap, but the sum exceeds this request's budget.
    script='import time; time.sleep(.4)\n'+VALID
    bot=fixture_bot(tmp_path,script,deadline=3)
    object.__setattr__(bot.answerer.settings,'request_timeout_seconds',.75)
    try:
        started=monotonic()
        reply=bot.ask(ChatRequest(question='통학버스 현금 가능해?'))
        assert reply.analysis.mode=='codex'
        assert reply.generation.mode=='source_fallback'
        assert reply.generation.reason in {'codex_timeout','request_timeout'}
        assert monotonic()-started<3
        assert bot.answerer.active is None
    finally:bot.close()


def test_expired_budget_does_not_start_another_call():
    with pytest.raises(GenerationFailure,match='request_timeout'):
        remaining_seconds(monotonic()-1,600)


def test_missing_live_data_has_no_unrelated_canned_topics():
    bot=CampusBot(llm_settings=LLMSettings(mode='off'))
    reply=bot.ask(ChatRequest(question='지금 버스 위치'))
    assert reply.outcome=='not_found' and reply.answer==NO_DATA


def test_request_slot_is_reserved_between_analysis_and_answer(tmp_path,monkeypatch):
    bot=fixture_bot(tmp_path)
    entered=Event();release=Event();original=bot.repo.planned_search
    def held_search(queries):
        entered.set()
        assert release.wait(5)
        return original(queries)
    monkeypatch.setattr(bot.repo,'planned_search',held_search)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            first=pool.submit(bot.ask,ChatRequest(question='통학버스 현금 가능해?'))
            try:
                assert entered.wait(4)
                assert bot.answerer.active is None  # Between the two model calls.
                second=bot.ask(ChatRequest(question='통학버스 현금 가능해?'))
                assert second.analysis.reason=='codex_busy'
                assert second.generation.mode=='source_fallback'
            finally:release.set()
            assert first.result(timeout=5).generation.mode=='codex'
    finally:bot.close()


@pytest.mark.parametrize('value',['0','120x','3601'])
def test_invalid_timeout_configuration_rejected(tmp_path,value):
    with pytest.raises(ValueError):
        LLMSettings.from_env(tmp_path/'missing.env',{'CAMPUS_REQUEST_TIMEOUT_SECONDS':value})
