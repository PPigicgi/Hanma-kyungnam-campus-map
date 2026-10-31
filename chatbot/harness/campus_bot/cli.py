import argparse
import json
import sys

from .contracts import ChatRequest
from .graph import CampusBot


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('question')
    parser.add_argument('--as-of')
    parser.add_argument('--db')
    args=parser.parse_args()
    sys.stdout.reconfigure(encoding='utf-8')
    response=CampusBot(args.db).ask(ChatRequest(question=args.question,as_of=args.as_of))
    print(json.dumps(response.model_dump(mode='json'),ensure_ascii=False,indent=2))


if __name__=='__main__':
    main()
