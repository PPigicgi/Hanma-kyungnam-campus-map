"""Owns all read-only DB access, source excerpts and calendar interpretation."""
from __future__ import annotations

import calendar
from contextlib import closing
from datetime import date, timedelta
import importlib.util
import json
from pathlib import Path
import re
import sqlite3
from urllib.parse import parse_qs, urlsplit

from .contracts import Source, Event

SEARCH_FILE = Path(__file__).resolve().parents[2] / "search.py"
spec = importlib.util.spec_from_file_location("campus_existing_search", SEARCH_FILE)
existing_search = importlib.util.module_from_spec(spec)
spec.loader.exec_module(existing_search)

TOPICS = [
    ("통학버스", ("통학버스", "셔틀", "통학 버스"), "/ko/4319/subview.do", ("승차방법",)),
    ("휴학", ("휴학",), "/ko/4401/subview.do", ("휴학처리절차", "휴학시기 및 방법")),
    ("복학", ("복학",), "/ko/4402/subview.do", ("복학처리절차", "복학시기")),
    ("수강신청", ("수강신청", "수강 신청", "수강바구니", "수강 바구니"), "/ko/4390/subview.do", ("정규수강신청", "예비수강신청")),
    ("재수강", ("재수강", "재이수"), "/ko/4391/subview.do", ("재수강",)),
    ("전과", ("전과",), "/ko/4400/subview.do", ("신청",)),
    ("복수전공", ("복수전공", "부전공"), "/ko/4399/subview.do", ("신청",)),
    ("졸업", ("졸업",), "/ko/4407/subview.do", ("졸업요건", "졸업")),
    ("국가장학금", ("국가장학", "국장"), "/ko/4418/subview.do", ("신청",)),
    ("교내장학금", ("교내장학", "성적장학"), "/ko/4416/subview.do", ("재학생",)),
    ("장학금", ("장학", "학비"), "/ko/4415/subview.do", ("장학",)),
    ("증명서", ("증명서", "재학증명", "성적증명", "졸업증명"), "/ko/6941/subview.do", ("인터넷", "발급")),
    ("학생증", ("학생증",), "/ko/6942/subview.do", ("발급",)),
    ("도서관", ("도서관",), "/ko/4446/subview.do", ("이용", "열람", "운영")),
    ("찾아오시는길", ("학교 주소", "학교주소", "학교 위치", "찾아가는", "찾아오", "캠퍼스 주소"), "/ko/4218/subview.do", ("경상남도", "주소")),
]
EVENT_ALIASES = {
    "기말": ("기말고사",), "중간": ("중간고사",), "겨울방학": ("동계방학",), "여름방학": ("하계방학",),
    "방학": ("방학",), "개강": ("개강",), "종강": ("종강",), "보강": ("보강",),
    "졸업": ("학위수여",), "복학": ("복학",), "휴학": ("휴학",), "수강": ("수강",),
    "등록": ("등록",), "수업일수": ("수업일수",), "계절": ("계절학기",),
}


def topic_for(question):
    matches=[(max(len(x) for x in t[1] if x in question),-i,t) for i,t in enumerate(TOPICS) if any(x in question for x in t[1])]
    return max(matches,key=lambda item:item[:2])[2] if matches else None


def calendar_question(question):
    topic=topic_for(question)
    # Specific service intent owns its question, even if its name contains a calendar term
    # (e.g. 졸업증명서) or mentions vacation (e.g. 통학버스 방학 운행).
    if topic and topic[0] not in {'휴학','복학','수강신청','졸업'}:
        return False
    if re.search(r"학사.?일정|중간고사|기말고사|방학|개강|종강|보강|학위수여|수업일수|계절학기", question):
        return True
    if re.search(r"(이번|다음|지난).?(달|주)|\d{1,2}월|오늘|내일", question) and "일정" in question:
        return True
    return bool(re.search(r"언제|날짜|마감|일정", question) and re.search(r"복학|휴학|수강|등록|졸업|계절", question))


def resolve_period(question, today):
    """Inclusive dates; an explicit year/month always takes precedence over current time."""
    question=question.replace('봄학기','1학기').replace('가을학기','2학기')
    years = re.findall(r"(20\d{2})\s*년|(?<!\d)(20\d{2})\s*학년도", question)
    year = int(next((a or b for a,b in years), today.year))
    if not years:
        year += 1 if "내년" in question else -1 if "작년" in question else 0
    month_match = re.search(r"(?<!\d)(\d{1,2})\s*월", question)
    if month_match:
        month = int(month_match.group(1))
        if not 1 <= month <= 12:
            raise ValueError("월은 1월부터 12월 사이로 입력해 주세요.")
        day_match = re.search(r"월\s*(\d{1,2})\s*일", question)
        if day_match:
            target = date(year,month,int(day_match.group(1)))
            return target,target,f"{target.isoformat()}"
        return date(year,month,1),date(year,month,calendar.monthrange(year,month)[1]),f"{year}년 {month}월"
    if re.search(r"(이번|다음|지난)\s*달", question):
        shift = 1 if re.search(r"다음\s*달",question) else -1 if re.search(r"지난\s*달",question) else 0
        total=today.year*12+today.month-1+shift
        y,m=divmod(total,12);m+=1
        return date(y,m,1),date(y,m,calendar.monthrange(y,m)[1]),f"{y}년 {m}월"
    if re.search(r"(이번|다음|지난)\s*주",question):
        shift = 7 if re.search(r"다음\s*주",question) else -7 if re.search(r"지난\s*주",question) else 0
        first=today-timedelta(days=today.weekday())+timedelta(days=shift)
        return first,first+timedelta(days=6),f"{first.isoformat()}~{(first+timedelta(days=6)).isoformat()}"
    if "오늘" in question or "내일" in question:
        target=today+timedelta(days=int("내일" in question))
        return target,target,target.isoformat()
    relative_semester=re.search(r'(다음|지난|이번)\s*학기',question)
    if relative_semester:
        if years:
            raise ValueError('상대 학기와 명시 연도를 동시에 지정하지 마세요.')
        current_year=today.year-int(today.month<=2)
        current_semester=2 if today.month>=9 or today.month<=2 else 1
        shift={'다음':1,'지난':-1,'이번':0}[relative_semester.group(1)]
        y,s=divmod(current_year*2+current_semester-1+shift,2)
        if s==0:
            return date(y,3,1),date(y,8,31),f'{y}학년도 1학기'
        return date(y,9,1),date(y+1,2,calendar.monthrange(y+1,2)[1]),f'{y}학년도 2학기'
    semester=re.search(r"([12])\s*학기",question)
    if semester or not (years or "내년" in question or "작년" in question):
        second = (semester.group(1)=='2') if semester else (today.month>=9 or today.month<=2)
        academic_year=year-1 if not years and '내년' not in question and '작년' not in question and today.month<=2 else year
        if second:
            return date(academic_year,9,1),date(academic_year+1,2,calendar.monthrange(academic_year+1,2)[1]),f"{academic_year}학년도 2학기"
        return date(academic_year,3,1),date(academic_year,8,31),f"{academic_year}학년도 1학기"
    if "학년도" in question:
        return date(year,3,1),date(year+1,2,calendar.monthrange(year+1,2)[1]),f"{year}학년도"
    return date(year,1,1),date(year,12,31),f"{year}년"


def contextual_question(question,history,today):
    """Resolve explicit follow-ups from the bounded user-question history only."""
    previous=''
    for current in [*history,question]:
        is_followup=bool(re.match(r'\s*(그럼|그다음|그\s*다음|그건|그거|그때|그러면)',current))
        if previous and is_followup:
            if calendar_question(previous):
                try:
                    first,last,_=resolve_period(previous,today)
                except ValueError:
                    first,last=today,today
                relative_month=re.search(r'(다음|지난|이번)\s*달',current)
                if relative_month and (first.year,first.month)==(last.year,last.month):
                    shift={'다음':1,'지난':-1,'이번':0}[relative_month.group(1)]
                    y,m=divmod(first.year*12+first.month-1+shift,12)
                    current=current[:relative_month.start()]+f'{y}년 {m+1}월'+current[relative_month.end():]
                if not calendar_question(current) and not topic_for(current):
                    current='학사일정 '+current
            elif not topic_for(current) and topic_for(previous):
                current=topic_for(previous)[0]+' '+current
        previous=current
    return previous


def event_terms(question):
    # Specific aliases precede generic '방학'.
    for word,terms in EVENT_ALIASES.items():
        if word in question:
            return terms
    return ()


def calendar_filter_terms(question):
    known=event_terms(question)
    if known:
        return known
    # A specific unknown event must never silently mean all events in the month.
    name=re.sub(r'20\d{2}\s*(?:학년도|년)?|\d{1,2}\s*(?:월|일|학기)', ' ',question)
    name=re.sub(r'(?:이번|다음|지난)\s*(?:달|주|학기)|올해|내년|작년|오늘|내일|그럼|그러면|언제야|언제인가요|언제|(?:알려|보여|정리해|확인해)\s*(?:주세요|줘|줄래)|(?<![가-힣])(?:좀|한번)(?![가-힣])', ' ',name)
    name=re.sub(r'[\s?.!]+','',name)
    if not name or re.fullmatch(r'(?:전체)?(?:학사)?일정(?:표)?(?:은|는|이|을|도)?',name):
        return ()
    return (name,)


def period_question(original,history,interpreted,today):
    """Explicit current dates win; otherwise use resolved follow-up context."""
    def dated(text):
        return bool(re.search(r'20\d{2}|\d{1,2}\s*월|[12]\s*학기|(?:이번|다음|지난)\s*(?:달|주|학기)|올해|내년|작년|오늘|내일|봄학기|가을학기',text))
    resolved=contextual_question(original,history,today)
    if dated(original) or dated(resolved):
        return resolved
    if history and dated(interpreted):
        return interpreted
    return resolved


def events_from_document(doc):
    query=parse_qs(urlsplit(doc['url']).query)
    year,month=int(query['year'][0]),int(query['month'][0])
    events=[]
    for line in doc['content'].splitlines():
        m=re.match(r'^(\d{2})\.(\d{2})(?:\s*~\s*(\d{2})\.(\d{2}))?\s*\|\s*(.+)',line)
        if not m:
            continue
        sm,sd=int(m[1]),int(m[2]);em,ed=int(m[3] or sm),int(m[4] or sd)
        sy=year-1 if sm>month else year
        ey=sy+int((em,ed)<(sm,sd))
        fields=m[5].split('|',1)
        events.append((Event(title=fields[0].strip(),start=date(sy,sm,sd),end=date(ey,em,ed),note=fields[1].strip() if len(fields)>1 else '',source_id=doc['id']),line))
    return events


def source(doc, quote):
    if quote not in doc['content']:
        raise ValueError("Source quote must be an exact substring")
    return Source(document_id=doc['id'],title=doc['title'],url=doc['url'],quote=quote,
                  fetched_at=doc['fetched_at'],modified_at=doc.get('modified_at'),published_at=doc.get('published_at'))


class Repository:
    def __init__(self, path):
        self.path=Path(path).resolve()
        if not self.path.is_file():
            raise FileNotFoundError("Campus DB is missing")
        with closing(self.connect()) as db:
            tables={r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type IN ('table','view')")}
            if not {'documents','chunks','chunks_fts','attachments','links'} <= tables:
                raise ValueError("Campus DB schema is incompatible")
            self.data_as_of=db.execute('SELECT max(fetched_at) FROM documents').fetchone()[0][:10]
            self.count=db.execute('SELECT count(DISTINCT document_id) FROM chunks').fetchone()[0]

    def connect(self):
        db=sqlite3.connect(self.path.as_uri()+'?mode=ro',uri=True,timeout=5)
        db.row_factory=sqlite3.Row
        db.execute('PRAGMA query_only=ON')
        return db

    def document(self, *, path=None, document_id=None):
        with closing(self.connect()) as db:
            if path:
                row=db.execute('SELECT id,url,title,content,kind,fetched_at,published_at,modified_at,flags_json FROM documents WHERE url=?',('https://www.kyungnam.ac.kr'+path,)).fetchone()
            else:
                row=db.execute('SELECT id,url,title,content,kind,fetched_at,published_at,modified_at,flags_json FROM documents WHERE id=?',(document_id,)).fetchone()
        return dict(row) if row else None

    def search(self, question, limit=4):
        return existing_search.search(question,limit,self.path)

    def calendar(self, question, when, *, period_question=None):
        # The model may standardize event names, but cannot replace user dates.
        first,last,label=resolve_period(period_question or question,when)
        terms=calendar_filter_terms(question)
        with closing(self.connect()) as db:
            docs=[dict(r) for r in db.execute("SELECT id,url,title,content,kind,fetched_at,published_at,modified_at,flags_json FROM documents WHERE kind='calendar'")]
        relevant=[];found={}
        for doc in docs:
            params=parse_qs(urlsplit(doc['url']).query)
            y,m=int(params['year'][0]),int(params['month'][0])
            if date(y,m,1)<=last and date(y,m,calendar.monthrange(y,m)[1])>=first:
                relevant.append(doc)
                for event,line in events_from_document(doc):
                    if event.end>=first and event.start<=last and (not terms or any(t.replace(' ','') in event.title.replace(' ','') for t in terms)):
                        found.setdefault((event.start,event.end,event.title),(event,line,doc))
        return label,sorted(found.values(),key=lambda x:(x[0].start,x[0].title)),relevant,terms

    def guidance(self, question):
        topic=topic_for(question)
        if topic:
            doc=self.document(path=topic[2])
            if doc and doc['content']:
                return self.excerpt(doc,question,topic[3]),topic[0]
        hits=self.search(question,3)
        words=[w for w in re.findall('[가-힣]{2,}',question) if w not in {'알려줘','알려주세요','어떻게','어디야','언제야','있어요','있나요','경남대학교','경남대'}]
        for hit in hits:
            matched=sum(w in hit['title']+' '+hit['content'] for w in words)
            if words and matched>=min(2,len(words)) and matched/len(words)>=0.75 and hit['score']>=8:
                doc=self.document(document_id=hit['document_id'])
                return source(doc,hit['content']),doc['title']
        return None,None

    def rag_sources(self, question, primary):
        """Bounded context from the selected page and explicitly requested related topics."""
        docs = [self.document(document_id=primary.document_id)]
        matches = [(t, max((a for a in t[1] if a in question), key=len))
                   for t in TOPICS if any(a in question for a in t[1])]
        for topic, alias in matches:
            if any(alias != other and alias in other for _, other in matches):
                continue
            doc = self.document(path=topic[2])
            if doc and doc['id'] not in {d['id'] for d in docs if d}:
                docs.append(doc)
        result = []
        for doc in docs[:3]:
            if not doc or not doc['content']:
                continue
            content = doc['content']
            anchor = primary.quote if doc['id'] == primary.document_id else self.excerpt(doc, question, ()).quote
            start = max(0, content.find(anchor) - 700) if len(content) > 4000 else 0
            result.append(source(doc, content[start:start + 4000]))
        return result

    def planned_search(self, queries):
        """Search all corpus topics using the model's bounded keyword expansions."""
        hints=[];batches=[]
        for query in queries[:3]:
            topic=topic_for(query)
            if topic:
                doc=self.document(path=topic[2])
                if doc and doc['content']:
                    hints.append((doc,self.excerpt(doc,query,topic[3]).quote))
            hits=self.search(query,4)
            words=[w for w in re.findall(r'[가-힣]{2,}|[a-zA-Z]{2,}',query.lower()) if w not in existing_search.STOP and w not in {'방법','안내','학교','이용','확인','신청','정보'}]
            batch=[]
            for hit in hits:
                text=(hit['title']+' '+hit['content']).lower()
                if words and any(word in text for word in words):
                    batch.append((self.document(document_id=hit['document_id']),hit['content']))
            batches.append(batch)
        # Round-robin query results so a synonym or second intent is not starved.
        candidates=hints+[(batch[i]) for i in range(4) for batch in batches if len(batch)>i]
        found=[];seen=set()
        for doc,anchor in candidates:
            if not doc or doc['id'] in seen:
                continue
            start=max(0,doc['content'].find(anchor)-250)
            found.append(source(doc,doc['content'][start:start+2400]));seen.add(doc['id'])
            if len(found)==5:
                break
        return found

    @staticmethod
    def excerpt(doc,question,anchors):
        content=doc['content']
        lines=content.splitlines(keepends=True)
        offsets=[];pos=0
        for line in lines:
            offsets.append(pos);pos+=len(line)
        useful=[i for i,line in enumerate(lines) if line.strip() and not re.search(r'이미지 대체텍스트|모든.?것|상세히 알려|School Bus Guide|근 거|^경남대학교',line)]
        words=[w for w in re.findall('[가-힣]{2,}',question) if w not in {'어떻게','신청','방법','알려줘','알려주세요','학교','경남대','경남대학교'} and w not in doc['title']]
        synonyms={'얼마나':'휴학기간','현금':'현금','카드':'카드','시간':'시간','어디':'위치','언제':'시기'}
        words += [v for k,v in synonyms.items() if k in question]
        scored=[(sum(w in lines[i] for w in words),i) for i in useful]
        best=max(scored,default=(0,0),key=lambda x:(x[0],-x[1]))
        if best[0]:
            index=best[1]
        else:
            index=next((i for anchor in anchors for i in useful if anchor in lines[i]),useful[0] if useful else 0)
        start=offsets[index] if offsets else 0
        end=min(len(content),start+1600)
        # Keep a short contiguous extract, so source validation is exact and table rows retain their order.
        limit_index=min(index+7,len(lines))
        end=min(end,offsets[limit_index] if limit_index<len(offsets) else len(content))
        if end<len(content) and '\n' in content[start:end]:
            end=content.rfind('\n',start,end)+1
        return source(doc,content[start:end].strip())
