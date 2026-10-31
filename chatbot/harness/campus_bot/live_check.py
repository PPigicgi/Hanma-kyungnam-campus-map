"""Opt-in real model smoke test. Offline verify never executes this module."""
import argparse
from datetime import date
import json
from pathlib import Path
import sys

from .contracts import ChatRequest
from .graph import CampusBot
from .llm import LLMSettings


def main():
    parser = argparse.ArgumentParser(description='설정된 모델 실호출 최대 3건으로 연결 확인 (계정 사용량 발생)')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    settings = LLMSettings.from_env()
    if settings.state != 'configured':
        print(json.dumps({'status': 'blocked', 'reason': settings.state, 'live_calls': 0}))
        return 2
    bot = CampusBot(llm_settings=settings)
    records = []
    try:
        for question in ['통학버스 현금 가능해?', '휴학 신청 방법을 간단히 설명해 줘', '2026년 12월 기말고사 언제야?']:
            reply = bot.ask(ChatRequest(question=question, as_of=date(2026, 10, 30)))
            passed = reply.generation.mode == settings.mode and reply.outcome == 'answered' and bool(reply.sources)
            if '기말고사' in question:
                passed = passed and '2026-12-15 ~ 2026-12-21' in reply.answer
            records.append({'question': question, 'passed': bool(passed), 'response': reply.model_dump(mode='json')})
            # Stop after a failure: no repeated spending on unavailable credentials/model.
            if not passed:
                break
    finally:
        bot.close()
    result = {'kind': f'live_{settings.mode}_smoke', 'model': settings.codex_model if settings.mode=='codex' else settings.model, 'total': len(records),
              'passed': sum(r['passed'] for r in records), 'cases': records}
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps({k: v for k, v in result.items() if k != 'cases'}, ensure_ascii=False))
    return 0 if result['passed'] == 3 else 1


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf8')
    raise SystemExit(main())
