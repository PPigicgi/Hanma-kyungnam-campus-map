"""Data Ieum-style bounded Codex login harness. No token copying or shell commands."""
import asyncio
from concurrent.futures import CancelledError as FutureCancelledError
from datetime import datetime, timezone
import json
import logging
import os
from pathlib import Path
import signal
import subprocess
import tempfile
from threading import Lock

from .contracts import Generation
from .llm import GroundedAnswer, SearchPlan, GenerationFailure, SYSTEM_PROMPT, PLAN_PROMPT, evidence_payload, plan_payload, validate_claims, remaining_seconds

logger = logging.getLogger('campus_bot.codex')

DISABLED_FEATURES = ('shell_tool', 'shell_snapshot', 'unified_exec', 'apps', 'plugins', 'hooks',
                     'multi_agent', 'multi_agent_v2', 'browser_use', 'computer_use', 'image_generation',
                     'view_image', 'skill_search', 'sleep_tool', 'unbounded_connection_retries', 'js_repl')


class CodexAnswerer:
    def __init__(self, settings, *, deadline=None):
        self.settings = settings
        self.deadline = settings.request_timeout_seconds if deadline is None else deadline
        self.lock = Lock()
        self.local_session_available = False
        self.last_success = None
        self.closed = False
        self.active = None
        self.loop = None
        if settings.state == 'configured':
            try:
                result = subprocess.run([settings.codex_executable, 'login', 'status'],
                    stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    timeout=5, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
                self.local_session_available = result.returncode == 0
            except (OSError, subprocess.SubprocessError):
                pass

    def public(self):
        info = self.settings.public()
        if info['configured'] and not self.local_session_available:
            info.update(state='codex_login_required', configured=False)
        info.update(connection_verified=self.last_success is not None,
                    last_success_at=self.last_success, local_session_available=self.local_session_available,
                    max_active=1, active=self.lock.locked(), deadline_seconds=self.deadline,
                    upstream_output_token_cap=False)
        return info

    def command(self, directory):
        command = [self.settings.codex_executable, 'exec', '--ignore-user-config', '--ephemeral',
                   '--skip-git-repo-check', '--sandbox', 'read-only', '--model', self.settings.codex_model,
                   '--json', '--color', 'never', '--output-schema', str(directory/'schema.json'),
                   '-C', str(directory), '-c', 'model_instructions_file='+json.dumps(str(directory/'instructions.txt')),
                   '-c', 'project_doc_max_bytes=0', '-c', 'web_search="disabled"', '-c', 'approval_policy="never"']
        if self.settings.codex_effort:
            command += ['-c', 'model_reasoning_effort='+json.dumps(self.settings.codex_effort)]
        for feature in DISABLED_FEATURES:
            command += ['--disable', feature]
        command += ['-']
        return command

    async def stop_process(self, process):
        if process.returncode is None:
            if os.name == 'nt':
                killer = await asyncio.create_subprocess_exec(
                    str(Path(os.environ['SystemRoot'])/'System32/taskkill.exe'), '/PID', str(process.pid), '/T', '/F',
                    stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
                    creationflags=subprocess.CREATE_NO_WINDOW)
                await killer.wait()
            else:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        await process.wait()

    async def run(self, payload, schema=GroundedAnswer, instructions=SYSTEM_PROMPT, timeout=None):
        root = Path(self.settings.runtime_dir)
        root.mkdir(parents=True, exist_ok=True)
        self.loop = asyncio.get_running_loop()
        with tempfile.TemporaryDirectory(prefix='request-', dir=root) as folder:
            directory = Path(folder)
            (directory/'schema.json').write_text(json.dumps(schema.model_json_schema()), encoding='utf8')
            (directory/'instructions.txt').write_text(instructions+'\n도구를 사용하지 말고 제공된 JSON 자료만 읽으세요.', encoding='utf8')
            process = None
            readers = []
            try:
                process = await asyncio.create_subprocess_exec(*self.command(directory),
                    stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                    limit=131072, **({'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {'start_new_session': True}))
                self.active = process

                async def read_events():
                    total, usage, final = 0, None, None
                    while line := await process.stdout.readline():
                        total += len(line)
                        if total > 131072:
                            logger.warning('Codex output limit: stdout bytes exceeded')
                            raise GenerationFailure('codex_output_limit')
                        event = json.loads(line)
                        if event.get('type') in {'error','turn.failed'}:
                            raise GenerationFailure('codex_turn_failed')
                        if event.get('type') == 'turn.completed':
                            usage = event.get('usage')
                        item = event.get('item', {})
                        if item:
                            if item.get('type') == 'error':
                                raise GenerationFailure('codex_turn_failed')
                            if item.get('type') == 'agent_message':
                                if event.get('type') == 'item.completed':
                                    final = item.get('text')
                            elif item.get('type') != 'reasoning':
                                logger.warning('Codex rejected non-answer item type: %s', str(item.get('type'))[:60])
                                raise GenerationFailure('codex_tool_activity')
                    return final, usage

                async def discard_errors():
                    size = 0
                    while chunk := await process.stderr.read(4096):
                        size += len(chunk)
                        if size > 65536:
                            logger.warning('Codex output limit: stderr bytes exceeded')
                            raise GenerationFailure('codex_output_limit')

                async with asyncio.timeout(self.deadline if timeout is None else timeout):
                    readers = [asyncio.create_task(read_events()), asyncio.create_task(discard_errors())]
                    process.stdin.write(payload.encode('utf8'))
                    await process.stdin.drain()
                    process.stdin.close()
                    values = await asyncio.gather(*readers)
                    if await process.wait() != 0:
                        raise GenerationFailure('codex_exit_failed')
                    final, usage = values[0]
                    if not isinstance(usage, dict) or any(type(usage.get(k)) is not int or usage[k] < 0 for k in ('input_tokens','output_tokens')):
                        raise GenerationFailure('codex_usage_missing')
                    if usage['output_tokens'] > 6000:
                        logger.warning('Codex output limit: reported output tokens %d',usage['output_tokens'])
                        raise GenerationFailure('codex_output_limit')
                    return schema.model_validate_json(final), usage
            except TimeoutError:
                raise GenerationFailure('codex_timeout') from None
            except (ValueError, TypeError, OSError, asyncio.CancelledError):
                raise GenerationFailure('codex_invalid_output') from None
            finally:
                if process is not None:
                    await self.stop_process(process)
                for task in readers:
                    if not task.done():
                        task.cancel()
                await asyncio.gather(*readers, return_exceptions=True)
                self.active = None
                self.loop = None

    def _complete(self,payload,schema,instructions,deadline_at=None):
        if self.closed:
            raise GenerationFailure('codex_closed')
        if self.settings.state != 'configured':
            raise GenerationFailure(self.settings.state)
        if not self.local_session_available:
            raise GenerationFailure('codex_login_required')
        if not self.lock.acquire(blocking=False):
            raise GenerationFailure('codex_busy')
        try:
            if len(payload.encode('utf8')) > 80000:
                raise GenerationFailure('codex_input_limit')
            parsed, usage = asyncio.run(self.run(payload,schema,instructions,remaining_seconds(deadline_at,self.deadline)))
            self.last_success = datetime.now(timezone.utc).isoformat()
            return parsed, Generation(mode='codex', model=self.settings.codex_model,
                input_tokens=usage['input_tokens'], output_tokens=usage['output_tokens'])
        finally:
            self.lock.release()

    def plan(self,*,question,history,as_of,deadline_at=None):
        return self._complete(plan_payload(question,history,as_of),SearchPlan,PLAN_PROMPT,deadline_at)

    def generate(self,deadline_at=None,**inputs):
        parsed,info=self._complete(evidence_payload(**inputs),GroundedAnswer,SYSTEM_PROMPT,deadline_at)
        validate_claims(parsed,inputs['sources'],inputs['route'])
        return parsed,info

    def close(self):
        self.closed = True
        loop,process = self.loop,self.active
        if loop is not None and process is not None:
            try:
                asyncio.run_coroutine_threadsafe(self.stop_process(process), loop).result(timeout=10)
            except (RuntimeError, TimeoutError, FutureCancelledError):
                # The generation loop can finish and cancel this task after reaping its child.
                if process.returncode is None:
                    raise GenerationFailure('codex_cleanup_failed') from None
