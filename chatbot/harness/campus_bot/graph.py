"""The only answer flow; shared by HTTP and the local evaluation/CLI harness."""
from datetime import date
import re
from time import perf_counter, monotonic
from typing import TypedDict
from uuid import uuid4
from threading import Lock

from langgraph.graph import StateGraph, START, END
from langsmith import tracing_context

from .contracts import ChatRequest, ChatResponse, Generation, today_kst, database_path
from .llm import LLMSettings, OpenAIAnswerer, GenerationFailure, SearchPlan
from .codex import CodexAnswerer
from .retrieval import Repository, calendar_question, source, contextual_question, event_terms, period_question

NO_DATA='질문하신 정보에 대한 데이터가 현재 준비되어 있지 않습니다. 수집된 경남대학교 자료에서 확인할 수 없었습니다.'


def fallback_plan(question,history,when):
    """Local fallback only; regular requests are analyzed by the configured model."""
    resolved=contextual_question(question.strip(),history,when)
    how_to=bool(re.search(r'방법|어디|어떻게|절차|재설정|변경',resolved))
    if not how_to and re.search(r'내\s*(성적|학점|학번)|다른.?학생.*(성적|학번)|주민등록번호',resolved):
        intent='personal_record'
    elif not how_to and re.search(r'실시간|현재|지금|오늘',resolved) and re.search(r'남은.?좌석|빈.?자리|버스.*위치|셔틀.*위치',resolved):
        intent='live_data'
    else:
        intent='calendar' if calendar_question(resolved) else 'general'
    return SearchPlan(resolved_question=resolved,queries=[resolved[:120]],intent=intent,
                      calendar_query=resolved[:500] if intent=='calendar' else None)


class State(TypedDict, total=False):
    question: str
    history: list[str]
    as_of: date
    resolved_question: str
    route: str
    trace: list[str]
    answer: str
    outcome: str
    sources: list
    events: list
    warnings: list[str]
    next_actions: list[str]
    generation: Generation
    plan: SearchPlan
    analysis: Generation
    analysis_failed: bool
    deadline_at: float
    skip_reason: str


def build_graph(repo: Repository, answerer):
    def normalize(state):
        when=state.get('as_of') or today_kst()
        if isinstance(when,str):when=date.fromisoformat(when)
        question=contextual_question(state['question'].strip(),state.get('history',[]),when)
        return dict(resolved_question=question,as_of=when,trace=['normalize'],sources=[],events=[],warnings=[],next_actions=[],
                    deadline_at=state.get('deadline_at',monotonic()+answerer.settings.request_timeout_seconds))

    def analyze(state):
        plan=fallback_plan(state['question'],state.get('history',[]),state['as_of'])
        info=Generation();failed=False;warnings=[]
        if answerer.settings.mode!='off':
            try:
                if state.get('skip_reason'):
                    raise GenerationFailure(state['skip_reason'])
                plan,info=answerer.plan(question=state['question'],history=state.get('history',[]),as_of=state['as_of'],deadline_at=state['deadline_at'])
            except GenerationFailure as exc:
                failed=True;info=Generation(mode='source_fallback',reason=exc.reason)
                warnings.append('다른 질문을 처리 중이어서 입력하신 표현으로 자료를 검색했습니다.' if exc.reason=='codex_busy' else 'AI 질문 분석을 완료하지 못해 입력하신 표현으로 자료를 검색했습니다.')
        return dict(plan=plan,analysis=info,analysis_failed=failed,route=plan.intent,
                    warnings=warnings,trace=state['trace']+['analyze'])

    def retrieve(state):
        question=state['resolved_question']
        trace=state['trace']+['retrieve']
        if state['route']=='personal_record':
            return dict(outcome='not_found',answer=NO_DATA+' 개인별 성적·학적 데이터는 보유하고 있지 않습니다.',next_actions=['학생정보시스템에서 본인 정보를 확인해 주세요.'],trace=trace)
        if state['route']=='live_data':
            return dict(outcome='not_found',answer=NO_DATA,next_actions=[],trace=trace)
        if state['route']=='calendar':
            try:
                event_query=question if event_terms(question) else state['plan'].calendar_query or question
                period=period_question(state['question'],state.get('history',[]),state['plan'].resolved_question,state['as_of'])
                label,events,docs,terms=repo.calendar(event_query,state['as_of'],period_question=period)
            except ValueError:
                return dict(outcome='needs_clarification',answer='날짜를 확인해 주세요. 예를 들어 “2026년 12월 학사일정”처럼 입력할 수 있습니다.',next_actions=['올바른 연도·월·일을 입력해 주세요.'],trace=trace)
            if not events:
                cited=[source(d,d['content'][:500]) for d in docs[:2]]
                return dict(outcome='not_found',answer=NO_DATA+f' 조회 기준은 {label}입니다.',sources=cited,next_actions=['공식 학사일정에서 최신 게시 내용을 확인해 주세요.'],trace=trace)
            chosen=events[:24]
            sources=[];used=set()
            for event,line,doc in chosen:
                if doc['id'] not in used:
                    matching=[row for ev,row,d in chosen if d['id']==doc['id']]
                    start=doc['content'].find(matching[0]);end=doc['content'].find(matching[-1])+len(matching[-1])
                    sources.append(source(doc,doc['content'][start:end]));used.add(doc['id'])
            lines=[f'{label} 기준으로 확인한 일정입니다.']
            for event,_,_ in chosen:
                span=event.start.isoformat() if event.start==event.end else f'{event.start.isoformat()} ~ {event.end.isoformat()}'
                lines.append(f'• {span}: {event.title}')
                if event.note:
                    lines.append('  '+event.note)
            warnings=state['warnings']+['학사일정은 학교 사정에 따라 변경될 수 있습니다.']
            if len(events)>24:
                warnings.append('24개 일정만 표시했습니다. 월을 지정하면 더 자세히 확인할 수 있습니다.')
            return dict(outcome='answered',answer='\n'.join(lines),sources=sources,events=[e for e,_,_ in chosen],warnings=warnings,trace=trace)
        if state['analysis'].mode in {'codex','openai'}:
            sources=repo.planned_search(state['plan'].queries)
            cited=sources[0] if sources else None
            title=cited.title if cited else ''
        else:
            cited,title=repo.guidance(question)
            sources=[cited] if cited else []
        if not cited:
            return dict(outcome='not_found',answer=NO_DATA,next_actions=[],trace=trace)
        return dict(outcome='answered',answer=f'「{title}」 안내에서 확인한 내용입니다.\n\n{cited.quote}',sources=sources,trace=trace)

    def answer(state):
        warnings=list(state.get('warnings',[]))
        age=(state['as_of']-date.fromisoformat(repo.data_as_of)).days
        if age>30:
            warnings.append(f'자료 수집일은 {repo.data_as_of}입니다. 최신 공지와 달라질 수 있습니다.')
        result=dict(warnings=warnings,trace=state['trace']+['answer'],generation=Generation())
        if state['outcome']!='answered' or answerer.settings.mode=='off':
            return result
        if state['analysis_failed']:
            result['generation']=state['analysis']
            warnings.append('AI 답변 미사용: 검색 원문으로 안내합니다.')
            return result
        # Validate input provenance before any external transmission.
        for cited in state['sources']:
            doc=repo.document(document_id=cited.document_id)
            if not doc or cited.quote not in doc['content'] or cited.url!=doc['url']:
                raise ValueError('Untrusted citation context')
        try:
            generated,info=answerer.generate(question=state['resolved_question'],history=state.get('history',[]),
                sources=state['sources'],events=state['events'],route=state['route'],
                as_of=state['as_of'],data_as_of=repo.data_as_of,deadline_at=state['deadline_at'])
            result['generation']=info
            if not generated.sufficient:
                result.update(outcome='not_found',answer=NO_DATA,events=[],next_actions=[])
                return result
            prose='\n\n'.join(f'{claim.text.strip()} [문서 {claim.document_id}]' for claim in generated.claims)
            # The displayed calendar dates/list are ALWAYS the deterministic result.
            result['answer']=prose+'\n\n'+state['answer'] if state['route']=='calendar' else prose
        except GenerationFailure as exc:
            result['generation']=Generation(mode='source_fallback',reason=exc.reason)
            if exc.reason=='codex_busy':
                message='다른 AI 답변을 처리 중이어서 검색 원문으로 안내합니다. 잠시 후 다시 질문할 수 있습니다.'
            elif exc.reason=='codex_login_required':
                message='Codex 로그인을 확인할 수 없어 검색 원문으로 안내합니다.'
            else:
                message='AI 설정이 아직 완료되지 않아 검색 원문으로 안내합니다.' if exc.reason in {'missing_key','missing_model','missing_codex','invalid_config'} else 'AI 답변을 사용할 수 없어 검색 원문으로 안내합니다.'
            warnings.append(message)
        return result

    def validate(state):
        for cited in state.get('sources',[]):
            doc=repo.document(document_id=cited.document_id)
            if not doc or cited.url!=doc['url'] or cited.quote not in doc['content']:
                raise ValueError('Citation validation failed')
        if state['outcome']=='answered' and not state['sources']:
            raise ValueError('Grounded answers require citations')
        return dict(trace=state['trace']+['validate'])

    builder=StateGraph(State)
    for name,node in [('normalize',normalize),('analyze',analyze),('retrieve',retrieve),('answer',answer),('validate',validate)]:
        builder.add_node(name,node)
    builder.add_edge(START,'normalize');builder.add_edge('normalize','analyze');builder.add_edge('analyze','retrieve')
    builder.add_edge('retrieve','answer');builder.add_edge('answer','validate');builder.add_edge('validate',END)
    return builder.compile(name='kyungnam_campus_qa')


class CampusBot:
    def __init__(self, db_path=None, *, llm_settings=None, answerer=None):
        self.repo=Repository(db_path or database_path())
        settings=llm_settings or LLMSettings.from_env()
        self.answerer=answerer or (CodexAnswerer(settings) if settings.mode=='codex' else OpenAIAnswerer(settings))
        self.graph=build_graph(self.repo,self.answerer)
        self.request_lock=Lock()

    def close(self):
        self.answerer.close()

    def ask(self, request: ChatRequest) -> ChatResponse:
        started=perf_counter()
        state={'question':request.question,'history':request.history,'as_of':request.as_of or today_kst(),
               'deadline_at':monotonic()+self.answerer.settings.request_timeout_seconds}
        reserved=self.request_lock.acquire(blocking=False) if self.answerer.settings.mode=='codex' else False
        if self.answerer.settings.mode=='codex' and not reserved:
            state['skip_reason']='codex_busy'
        # Model calls are explicitly configured; cloud tracing stays disabled.
        try:
            with tracing_context(enabled=False):
                result=self.graph.invoke(state,config={'recursion_limit':8})
        finally:
            if reserved:
                self.request_lock.release()
        return ChatResponse(status='success' if result['outcome']=='answered' else 'warning',outcome=result['outcome'],
            summary=result['answer'].splitlines()[0],answer=result['answer'],sources=result['sources'],events=result['events'],
            as_of=result['as_of'],data_as_of=self.repo.data_as_of,warnings=result['warnings'],next_actions=result['next_actions'],
            artifacts=[f"document:{s.document_id}" for s in result['sources']],request_id=str(uuid4()),
            trace=result['trace'],elapsed_ms=round((perf_counter()-started)*1000,2),generation=result['generation'],
            search_queries=result['plan'].queries,analysis=result['analysis'])
