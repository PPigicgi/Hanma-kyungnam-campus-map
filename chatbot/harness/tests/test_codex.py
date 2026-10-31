"""Subprocess contract/lifecycle tests with a local Python fixture, never a live model."""
from concurrent.futures import ThreadPoolExecutor
import ctypes
from datetime import date
import json
import os
import sys
import time

import pytest

from campus_bot.codex import CodexAnswerer
from campus_bot.contracts import ChatRequest
from campus_bot.graph import CampusBot
from campus_bot.llm import LLMSettings

VALID = r'''
import json,sys
p=json.load(sys.stdin)
if p.get('phase')=='analyze':
    plan={'resolved_question':p['question'],'queries':['통학버스 현금'],'intent':'general','calendar_query':None}
    print(json.dumps({'type':'item.completed','item':{'type':'agent_message','text':json.dumps(plan)}}))
    print(json.dumps({'type':'turn.completed','usage':{'input_tokens':100,'output_tokens':40}}))
    sys.exit(0)
s=p['sources'][0]
q=next(line for line in s['quote'].splitlines() if '현금' in line)
answer={'sufficient':True,'claims':[{'text':'현금으로는 이용할 수 없어요.','document_id':s['document_id'],'quote':q}]}
print(json.dumps({'type':'item.completed','item':{'type':'agent_message','text':json.dumps(answer)}}))
print(json.dumps({'type':'turn.completed','usage':{'input_tokens':100,'output_tokens':40}}))
'''


def fixture_bot(tmp_path, script=VALID, deadline=3):
    settings=LLMSettings(mode='codex',codex_executable=sys.executable,codex_model='preserved-model',
                         codex_effort='xhigh',runtime_dir=str(tmp_path))
    answerer=CodexAnswerer(settings,deadline=deadline)
    answerer.local_session_available=True
    answerer.command=lambda directory:[sys.executable,'-X','utf8','-c',script]
    return CampusBot(answerer=answerer)


def ask(bot):
    return bot.ask(ChatRequest(question='통학버스 현금 가능해?',as_of=date(2026,10,30)))


def test_native_subprocess_output_and_ephemeral_cleanup(tmp_path):
    bot=fixture_bot(tmp_path)
    try:
        reply=ask(bot)
        assert reply.generation.mode=='codex'
        assert reply.generation.model=='preserved-model'
        assert reply.generation.output_tokens==40
        assert bot.answerer.public()['connection_verified']
        assert not list(tmp_path.glob('request-*'))
    finally:bot.close()


@pytest.mark.parametrize('script,reason', [
    ("import sys; sys.stdin.read(); print('not json')",'codex_invalid_output'),
    ("import json; print(json.dumps({'type':'item.started','item':{'type':'command_execution','command':'forbidden'}}))",'codex_tool_activity'),
    ("import json; print(json.dumps({'type':'turn.failed','error':'failure'}))",'codex_turn_failed'),
    ("import json; print(json.dumps({'type':'item.completed','item':{'type':'error','message':'failure'}}))",'codex_turn_failed'),
    ("import sys; sys.stdin.read(); sys.exit(1)",'codex_exit_failed'),
    ("import sys; sys.stdin.read(); print('x'*140000)",'codex_invalid_output'),
    ("import sys; sys.stderr.write('x'*70000); sys.stderr.flush(); sys.stdin.read()",'codex_output_limit'),
    (VALID.replace("'output_tokens':40","'output_tokens':6001"),'codex_output_limit'),
])
def test_bad_process_outputs_are_rejected(tmp_path,script,reason):
    bot=fixture_bot(tmp_path,script)
    try:
        reply=ask(bot)
        assert reply.generation.mode=='source_fallback'
        assert reply.generation.reason==reason
        assert '현금사용은 불가' in reply.answer
        assert bot.answerer.active is None
        assert not list(tmp_path.glob('request-*'))
    finally:bot.close()


def process_alive(pid):
    if os.name=='nt':
        handle=ctypes.windll.kernel32.OpenProcess(0x1000,False,pid)
        if not handle:return False
        try:
            code=ctypes.c_ulong()
            ctypes.windll.kernel32.GetExitCodeProcess(handle,ctypes.byref(code))
            return code.value==259
        finally:ctypes.windll.kernel32.CloseHandle(handle)
    try:os.kill(pid,0);return True
    except ProcessLookupError:return False


def test_timeout_kills_owned_process_and_releases_capacity(tmp_path):
    pid_file=tmp_path/'observed-pid'
    script=f"import os,time,pathlib; pathlib.Path({str(pid_file)!r}).write_text(str(os.getpid())); time.sleep(30)"
    bot=fixture_bot(tmp_path,script,deadline=.5)
    try:
        reply=ask(bot)
        assert reply.generation.reason=='codex_timeout'
        assert not process_alive(int(pid_file.read_text()))
        assert not bot.answerer.lock.locked()
        assert not list(tmp_path.glob('request-*'))
    finally:bot.close()


def test_concurrency_rejects_without_queue_and_close_stops_active(tmp_path):
    bot=fixture_bot(tmp_path,'import time; time.sleep(30)',deadline=10)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future=pool.submit(ask,bot)
        until=time.monotonic()+5
        while bot.answerer.active is None and time.monotonic()<until:time.sleep(.02)
        assert bot.answerer.active is not None
        pid=bot.answerer.active.pid
        assert ask(bot).generation.reason=='codex_busy'
        bot.close()
        assert future.result(timeout=5).generation.mode=='source_fallback'
        assert not process_alive(pid)


def test_isolation_flags_keep_original_model_and_effort(tmp_path):
    settings=LLMSettings(mode='codex',codex_executable=sys.executable,codex_model='gpt-6-astra',codex_effort='xhigh',runtime_dir=str(tmp_path))
    answerer=CodexAnswerer(settings)
    command=answerer.command(tmp_path)
    assert command[command.index('--model')+1]=='gpt-6-astra'
    assert 'model_reasoning_effort="xhigh"' in command
    for flag in ['--ignore-user-config','--ephemeral','--output-schema','read-only','web_search="disabled"']:
        assert flag in command
    for feature in ['shell_tool','apps','plugins','hooks','multi_agent','unified_exec','browser_use']:
        assert command[command.index(feature)-1]=='--disable'
    assert '--dangerously-bypass-approvals-and-sandbox' not in command


def test_local_login_missing_skips_generation(tmp_path):
    bot=fixture_bot(tmp_path)
    bot.answerer.local_session_available=False
    try:
        assert ask(bot).generation.reason=='codex_login_required'
        assert not bot.answerer.public()['configured']
        assert not list(tmp_path.glob('request-*'))
    finally:bot.close()


@pytest.mark.parametrize('override,expected', [('', 'gpt-6-astra'),('gpt-6-luna','gpt-6-luna')])
def test_app_model_override_preserves_global_settings(tmp_path,override,expected):
    config=tmp_path/'config.toml'
    original='model="gpt-6-astra"\nmodel_reasoning_effort="xhigh"\n'
    config.write_text(original,encoding='utf8')
    settings=LLMSettings.from_env(tmp_path/'missing.env',{'CAMPUS_LLM_MODE':'codex','CODEX_HOME':str(tmp_path),
        'CAMPUS_CODEX_MODEL':override,'CAMPUS_CODEX_EXECUTABLE':sys.executable})
    assert settings.codex_model==expected and settings.codex_effort=='xhigh'
    assert config.read_text(encoding='utf8')==original
