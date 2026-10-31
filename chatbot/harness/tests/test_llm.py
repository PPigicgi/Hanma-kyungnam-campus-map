"""Actual OpenAI SDK with mock HTTP transport. Never contacts a paid endpoint."""
from datetime import date
import json

import httpx2
from openai import OpenAI
from fastapi.testclient import TestClient
import pytest

from campus_bot.app import create_app
from campus_bot.contracts import ChatRequest
from campus_bot.graph import CampusBot, fallback_plan
from campus_bot.llm import LLMSettings, OpenAIAnswerer, GroundedAnswer, validate_claims, GenerationFailure

SETTINGS = LLMSettings(mode='openai', model='test-model', api_key='test-secret', reasoning_effort='low')


def response_json(parsed, status='completed'):
    return {'id': 'resp_test', 'object': 'response', 'created_at': 0, 'model': 'test-model',
            'status': status, 'output': [{'type': 'message', 'id': 'msg_test', 'status': 'completed',
                'role': 'assistant', 'content': [{'type': 'output_text', 'text': json.dumps(parsed, ensure_ascii=False), 'annotations': []}]}],
            'usage': {'input_tokens': 100, 'output_tokens': 50, 'total_tokens': 150}}


def grounded(payload, text='통학버스는 현금으로 이용할 수 없어요. 카드 이용 안내를 확인해 주세요.'):
    src = payload['sources'][0]
    quote = next((line for line in src['quote'].splitlines() if '현금' in line), src['quote'][:100])
    return {'sufficient': True, 'claims': [{'text': text, 'document_id': src['document_id'], 'quote': quote}]}


def make_bot(handler):
    calls = []
    def transport(request):
        body = json.loads(request.content)
        payload=json.loads(body['input'])
        if payload.get('phase')=='analyze':
            plan=fallback_plan(payload['question'],payload['history'],date.fromisoformat(payload['as_of']))
            return httpx2.Response(200,json=response_json(plan.model_dump(mode='json')))
        calls.append((request, body))
        return handler(request, body, payload)
    client = OpenAI(api_key=SETTINGS.api_key, max_retries=0, timeout=25,
                    http_client=httpx2.Client(transport=httpx2.MockTransport(transport)))
    return CampusBot(answerer=OpenAIAnswerer(SETTINGS, client=client)), calls


def ask(bot, question='통학버스 현금 가능해?', history=None):
    return bot.ask(ChatRequest(question=question, history=history or [], as_of=date(2026, 10, 30)))


def test_actual_sdk_request_and_generated_answer():
    bot, calls = make_bot(lambda req, body, payload: httpx2.Response(200, json=response_json(grounded(payload))))
    try:
        reply = ask(bot, history=['통학버스 이용 방법'])
        assert reply.generation.mode == 'openai'
        assert reply.generation.input_tokens == 100
        assert '현금으로 이용할 수 없어요' in reply.answer
        assert '[문서 ' in reply.answer
        request, body = calls[0]
        assert str(request.url) == 'https://api.openai.com/v1/responses'
        assert body['store'] is False and 'tools' not in body
        assert body['max_output_tokens'] == 3000 and body['reasoning']['effort'] == 'low'
        assert body['text']['format']['strict'] is True
        assert len(calls) == 1
        payload = json.loads(body['input'])
        assert payload['history'] == ['통학버스 이용 방법']
        assert sum(len(s['quote']) for s in payload['sources']) <= 12000
        assert 'test-secret' not in json.dumps(payload) + reply.model_dump_json()
    finally:
        bot.close()


@pytest.mark.parametrize('fault', ['bad_id', 'bad_quote', 'wrong_number', 'url', 'empty', 'incomplete', 'bad_json', 'refusal'])
def test_rejects_unusable_generation(fault):
    def handle(req, body, payload):
        parsed = grounded(payload)
        claim = parsed['claims'][0]
        if fault == 'bad_id': claim['document_id'] = -1
        if fault == 'bad_quote': claim['quote'] = '원문에 존재하지 않는 만들어낸 인용입니다.'
        if fault == 'wrong_number': claim['text'] = '현금 999999원을 내면 됩니다.'
        if fault == 'url': claim['text'] = 'https://example.com 에서 결제하세요.'
        if fault == 'empty': parsed['claims'] = []
        data = response_json(parsed, 'incomplete' if fault == 'incomplete' else 'completed')
        if fault == 'bad_json': data['output'][0]['content'][0]['text'] = 'not json'
        if fault == 'refusal': data['output'][0]['content'] = [{'type': 'refusal', 'refusal': 'no'}]
        return httpx2.Response(200, json=data)
    bot, calls = make_bot(handle)
    try:
        reply = ask(bot)
        assert reply.generation.mode == 'source_fallback'
        assert '현금사용은 불가' in reply.answer
        assert reply.warnings and len(calls) == 1
        assert '999999' not in reply.answer and 'example.com' not in reply.answer
    finally:
        bot.close()


@pytest.mark.parametrize('status', [401, 429, 500])
def test_api_failure_is_explicit_without_retry_or_secret(status, caplog):
    bot, calls = make_bot(lambda req, body, payload: httpx2.Response(status, json={'error': {'message': 'test-secret DO NOT LOG', 'type': 'error'}}))
    try:
        reply = ask(bot)
        assert reply.generation.reason == 'api_error' and len(calls) == 1
        assert 'test-secret' not in caplog.text + reply.model_dump_json()
    finally:
        bot.close()


def test_timeout_falls_back():
    def timeout(req, body, payload):
        raise httpx2.ReadTimeout('secret payload', request=req)
    bot, calls = make_bot(timeout)
    try:
        assert ask(bot).generation.reason == 'api_error'
        assert len(calls) == 1
    finally:
        bot.close()


def test_no_evidence_personal_live_skip_answer_generation():
    def forbidden(*args):
        pytest.fail('No API call is allowed for these routes')
    bot, calls = make_bot(forbidden)
    try:
        for question in ['2027년 3월 학사일정', '내 성적 알려줘', '지금 버스 위치']:
            assert ask(bot, question).outcome != 'answered'
        assert calls == []
    finally:
        bot.close()


@pytest.mark.parametrize('text,mode', [('계절학기 일정은 아래와 같습니다.', 'openai'), ('기말고사 일정은 아래에서 확인해 주세요.', 'openai'), ('2027-12-22에 계절학기가 시작돼요.', 'source_fallback'), ('내일부터 시작됩니다.', 'source_fallback')])
def test_calendar_display_remains_authoritative(text, mode):
    bot, _ = make_bot(lambda req, body, payload: httpx2.Response(200, json=response_json(grounded(payload, text))))
    try:
        reply = ask(bot, '2027년 1월 계절학기')
        assert reply.generation.mode == mode
        assert '2026-12-22 ~ 2027-01-13' in reply.answer
        assert '2027-12-22' not in reply.answer
        assert reply.events[0].start == date(2026, 12, 22)
    finally:
        bot.close()


def test_model_can_abstain_from_inadequate_guidance():
    bot, _ = make_bot(lambda req, body, payload: httpx2.Response(200, json=response_json({'sufficient': False, 'claims': []})))
    try:
        reply = ask(bot, '통학버스 우주 노선 요금')
        assert reply.outcome == 'not_found' and reply.generation.mode == 'openai'
        assert reply.sources
    finally:
        bot.close()


def test_settings_precedence_redaction_and_no_global_mutation(tmp_path, monkeypatch):
    env = tmp_path / '.env'
    env.write_text('CAMPUS_LLM_MODE=openai\nOPENAI_API_KEY=local-secret\nOPENAI_MODEL=file-model\n', encoding='utf8')
    settings = LLMSettings.from_env(env, {'OPENAI_MODEL': 'env-model'})
    assert settings.model == 'env-model' and settings.state == 'configured'
    assert 'local-secret' not in repr(settings) + json.dumps(settings.public())
    assert LLMSettings.from_env(env, {'OPENAI_API_KEY': ''}).state == 'missing_key'
    assert LLMSettings(mode='openai', api_key='key').state == 'missing_model'
    assert LLMSettings(mode='other').state == 'invalid_config'


def test_missing_key_and_http_mode_are_honest():
    settings = LLMSettings(mode='openai', model='test-model')
    with TestClient(create_app(llm_settings=settings)) as client:
        assert client.get('/api/info').json()['llm']['state'] == 'missing_key'
        assert client.get('/healthz').json()['llm']['configured'] is False
        reply = client.post('/api/chat', json={'question': '통학버스 현금 가능해?'}).json()
        assert reply['generation']['mode'] == 'source_fallback'
        assert reply['generation']['reason'] == 'missing_key'
        assert any('AI 질문 분석' in warning for warning in reply['warnings'])
        assert client.get('/.env').status_code == 404


def test_http_generated_path_and_lifecycle():
    bot, calls = make_bot(lambda req, body, payload: httpx2.Response(200, json=response_json(grounded(payload))))
    with TestClient(create_app(answerer=bot.answerer)) as client:
        info = client.get('/api/info').json()
        assert info['llm']['configured'] and not info['llm']['connection_verified']
        response = client.post('/api/chat', json={'question': '통학버스 현금 가능해?'})
        assert response.status_code == 200
        assert response.json()['generation']['mode'] == 'openai'
    assert bot.answerer.client.is_closed()


def test_multiple_guidance_topics_and_longest_alias():
    bot, calls = make_bot(lambda req, body, payload: httpx2.Response(200, json=response_json(grounded(payload, '안내에서 신청 방법을 확인할 수 있습니다.'))))
    try:
        ask(bot, '휴학과 복학 신청 방법 비교해 줘')
        payload = json.loads(calls[0][1]['input'])
        assert any('휴학' in s['title'] for s in payload['sources'])
        assert any('복학' in s['title'] for s in payload['sources'])
        assert len(payload['sources']) <= 5
        ask(bot, '졸업증명서 발급 방법')
        payload = json.loads(calls[1][1]['input'])
        assert '증명' in payload['sources'][0]['title']
    finally:
        bot.close()


@pytest.mark.parametrize('original,changed', [('4.30','30.4'),('2026-12-15','2026-15-12'),('055-249-2950','249-055-2950')])
def test_compound_number_changes_are_rejected(original,changed):
    from campus_bot.contracts import Source
    cited=Source(document_id=1,title='test',url='https://www.kyungnam.ac.kr/test',quote=f'확인된 수치는 {original} 입니다.',fetched_at='2026-10-30')
    parsed=GroundedAnswer(sufficient=True,claims=[{'text':f'수치는 {changed} 입니다.','document_id':1,'quote':cited.quote}])
    with pytest.raises(GenerationFailure,match='unsupported_number'):
        validate_claims(parsed,[cited],'guidance')
