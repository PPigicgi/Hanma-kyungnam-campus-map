"""Local retrieval for a chatbot. Python standard library only; no model/API key."""
import argparse
import json
import re
import sqlite3
import sys
from pathlib import Path

DEFAULT_DB = Path(__file__).with_name('kyungnam.db')
STOP = {'경남대학교','경남대','어떻게','알려줘','알려주세요','무엇인가요','어디서','언제','하나요','있나요','방법은','대해서','대한'}


def query_tokens(query):
    words = [w for w in re.findall(r'[가-힣]+|[a-zA-Z0-9]+',query.lower()) if w not in STOP]
    tokens=[]
    for word in words[:16]:
        # Preserve full words and add overlapping bigrams for Korean inflections.
        if len(word)>=2:
            tokens.append(word)
            if re.search('[가-힣]',word):
                tokens.extend(word[i:i+2] for i in range(len(word)-1))
    return list(dict.fromkeys(tokens))[:64]


def search(query, limit=5, db_path=DEFAULT_DB):
    tokens=query_tokens(query)
    if not tokens or limit<1:
        return []
    uri=Path(db_path).resolve().as_uri()+'?mode=ro'
    db=sqlite3.connect(uri,uri=True);db.row_factory=sqlite3.Row
    match=' OR '.join('"'+t.replace('"','""')+'"' for t in tokens)
    rows=db.execute('''SELECT c.id AS chunk_id,c.document_id,c.chunk_index,c.content,d.title,d.url,d.category,d.kind,
        d.published_at,d.modified_at,d.fetched_at,d.flags_json,bm25(chunks_fts,6.0,1.0,0.5) AS bm25
        FROM chunks_fts JOIN chunks c ON c.id=chunks_fts.rowid JOIN documents d ON d.id=c.document_id
        WHERE chunks_fts MATCH ? ORDER BY bm25 LIMIT 100''',(match,)).fetchall()
    words=[w for w in re.findall(r'[가-힣]+|[a-zA-Z0-9]+',query.lower()) if w not in STOP and len(w)>1]
    ranked=[]
    for row in rows:
        r=dict(row)
        title=r['title'].lower();body=r['content'].lower()
        exact=sum(4 if w in title else 1 if w in body else 0 for w in words)
        # Durable guidance gets a small tie-break over notices; dates remain visible to caller.
        r['score']=round(-r.pop('bm25')+exact*2+(1 if r['kind']=='page' else 0),5)
        ranked.append(r)
    ranked.sort(key=lambda r:r['score'],reverse=True)
    result=[];seen=set()
    for r in ranked:
        if r['document_id'] not in seen:
            r['flags']=json.loads(r.pop('flags_json'))
            r['attachments']=[dict(a) for a in db.execute('SELECT a.url,a.title,a.status FROM attachments a JOIN links l ON l.url=a.url WHERE l.document_id=? AND l.is_attachment=1',(r['document_id'],))]
            result.append(r);seen.add(r['document_id'])
        if len(result)>=min(limit,50):
            break
    db.close()
    return result


if __name__=='__main__':
    if hasattr(sys.stdout,'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    p=argparse.ArgumentParser()
    p.add_argument('query')
    p.add_argument('--limit',type=int,default=5)
    p.add_argument('--db',type=Path,default=DEFAULT_DB)
    args=p.parse_args()
    print(json.dumps(search(args.query,args.limit,args.db),ensure_ascii=False,indent=2))
