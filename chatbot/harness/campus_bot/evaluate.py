import argparse
from datetime import date
import json
from pathlib import Path
import sys

from .contracts import ChatRequest
from .graph import CampusBot
from .llm import LLMSettings

ROOT=Path(__file__).resolve().parents[1]


def evaluate(bot=None):
    bot=bot or CampusBot(llm_settings=LLMSettings(mode='off'))
    records=[]
    for case in json.loads((ROOT/'eval_cases.json').read_text(encoding='utf8')):
        response=bot.ask(ChatRequest(question=case['question'],history=case.get('history',[]),as_of=date(2026,10,30)))
        errors=[]
        if response.outcome!=case['outcome']:errors.append('outcome')
        if case.get('contains') and case['contains'] not in response.answer:errors.append('answer')
        if case.get('source_path') and not any(s.url.endswith(case['source_path']) for s in response.sources):errors.append('source')
        if case.get('event') and not any(e.title==case['event'] for e in response.events):errors.append('event')
        if response.outcome=='answered' and not response.sources:errors.append('missing citation')
        records.append({'question':case['question'],'passed':not errors,'errors':errors,'response':response.model_dump(mode='json')})
    return {'reference_date':'2026-10-30','total':len(records),'passed':sum(r['passed'] for r in records),'cases':records}


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output',type=Path);args=p.parse_args()
    result=evaluate()
    if args.output:
        args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
    sys.stdout.reconfigure(encoding='utf-8')
    print(json.dumps({'passed':result['passed'],'total':result['total'],'failures':[{'question':r['question'],'errors':r['errors'],'answer':r['response']['answer']} for r in result['cases'] if not r['passed']]},ensure_ascii=False,indent=2))
    raise SystemExit(0 if result['passed']==result['total'] else 1)
