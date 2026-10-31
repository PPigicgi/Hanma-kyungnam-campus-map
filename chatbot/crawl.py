"""Authorized public Kyungnam corpus collector. No login, model, or cloud service."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
import sqlite3
import time
import urllib.error
import urllib.parse as U
import urllib.request as R
import urllib.robotparser
import zlib
from datetime import datetime, timezone, timedelta
from pathlib import Path

from lxml import html, etree

BASE = "https://www.kyungnam.ac.kr"
ROOT = Path(__file__).resolve().parent
UA = "KyungnamChatbotCorpus/1.0 (authorized public academic information collection)"
KST = timezone(timedelta(hours=9))
SELECTED = {"ko", "cge", "dorm", "international"}
ASSET = re.compile(r"\.(pdf|hwp|hwpx|docx?|xlsx?|pptx?|zip)(?:$|\?)", re.I)


def now():
    return datetime.now(KST).isoformat(timespec="seconds")


def clean(s):
    return re.sub(r"\s+", " ", s or "").strip()


def normalized_date(value):
    if not value:
        return None
    match=re.search(r'(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})',value)
    if match:
        y,m,d=map(int,match.groups())
        return f'{y:04d}-{m:02d}-{d:02d}'
    return value


def canonical(url, parent=BASE):
    url = U.urljoin(parent, (url or "").strip())
    p = U.urlsplit(url)
    if p.scheme not in {"http", "https"} or p.hostname != "www.kyungnam.ac.kr":
        return None
    path = U.quote(re.sub(r"\.{2,}(?=do$)", ".", p.path), safe="/%:@-._~")
    params = U.parse_qs(p.query)
    if params.get("enc"):
        try:
            raw = base64.b64decode(params["enc"][0]).decode("utf8")
            decoded = U.unquote(raw.split("|@@|")[-1])
            if re.match(r"/bbs/[^/]+/\d+/\d+/artclView.do", decoded):
                return canonical(decoded)
        except (ValueError, UnicodeError):
            pass
    if "artclView.do" in path:
        query = ""
    elif re.search(r'/subview.do$|/artclList.do$|/schdulmanage/',path):
        keep = {k: v for k, v in params.items() if k in {"page", "year", "month", "kind"}}
        query = U.urlencode(sorted((k, v[0]) for k, v in keep.items()))
    else:
        query = U.urlencode(sorted((k, value) for k, values in params.items() if not k.startswith('utm_') for value in values))
    return U.urlunsplit(("https", "www.kyungnam.ac.kr", path, query, ""))


def cls(name):
    return f'contains(concat(" ", normalize-space(@class), " "), " {name} ")'


def select_first(tree, expressions):
    for exp in expressions:
        found = tree.xpath(exp)
        if found:
            return found[0]
    return None


def body_text(node):
    node = html.fromstring(etree.tostring(node, encoding="unicode"))
    for el in node.xpath('//script|//style|//noscript|//nav|//header|//footer|//input|//select|//textarea|//svg|//comment()'):
        if el.getparent() is not None:
            el.getparent().remove(el)
    # K2Web debugging markers are emitted in hidden template elements.
    for el in node.xpath('//*[@hidden or @aria-hidden="true" or contains(@style,"display:none") or contains(@style,"display: none") or @class="hidden"]'):
        if el.getparent() is not None:
            el.getparent().remove(el)
    for table in reversed(node.xpath('.//table')):
        rows = []
        for tr in table.xpath('.//tr'):
            cells = [clean(td.text_content()) for td in tr.xpath('./th|./td')]
            if cells:
                rows.append(' | '.join(cells))
        if rows and table.getparent() is not None:
            replacement = etree.Element('pre')
            replacement.text = '\n' + '\n'.join(rows) + '\n'
            replacement.tail = table.tail
            table.getparent().replace(table, replacement)
    for img in node.xpath('.//img[@alt]'):
        alt = clean(img.get("alt"))
        if len(alt) > 5 and not re.search(r"로고|logo|아이콘|새창", alt, re.I):
            img.tail = " [이미지 대체텍스트: " + alt + "] " + (img.tail or "")
    blocks = {"p", "div", "section", "article", "li", "ul", "ol", "dl", "dt", "dd", "h1", "h2", "h3", "h4", "h5", "table", "tr", "br"}
    parts = []

    def walk(el):
        if not isinstance(el.tag, str):
            return
        if el.tag in blocks:
            parts.append("\n")
        if el.text:
            parts.append(el.text)
        for child in el:
            walk(child)
            if child.tail:
                parts.append(child.tail)
        if el.tag in {"td", "th"}:
            parts.append(" | ")
        if el.tag in blocks:
            parts.append("\n")
    walk(node)
    lines = []
    for line in "".join(parts).splitlines():
        line = clean(line).strip(" |")
        if not line or re.match(r"fnctId=|/WEB-INF/|\w+_JW_MS_K2WT|컨텐츠영역$", line):
            continue
        if not lines or line != lines[-1]:
            lines.append(line)
    return "\n".join(lines)


def parse_page(data, url, hint=""):
    tree = html.fromstring(data, parser=html.HTMLParser(encoding="utf-8"))
    kind = "article" if "artclView.do" in url else "page"
    node = select_first(tree, [f'//*[{cls("view-con")}]', '//*[@id="contentsEditHtml"]', f'//*[{cls("contents")}]', '//main', '//body'])
    if node is None:
        node = tree
    article_title = tree.xpath(f'//*[{cls("view-title")}]/text()')
    title = clean(" ".join(article_title or tree.xpath('//title/text()'))) or hint
    if kind == "article" and not article_title:
        raise ValueError("article body/title missing: inaccessible, removed or unsupported")
    dates = {}
    for dl in tree.xpath(f'//*[{cls("view-detail")}]//dl'):
        label = clean(" ".join(dl.xpath('./dt//text()')))
        value = clean(" ".join(dl.xpath('./dd//text()')))
        dates[label] = value
    links = []
    for a in node.xpath('.//a[@href]'):
        href = a.get("href", "")
        if href.startswith(("#", "javascript:", "mailto:", "tel:")):
            continue
        absolute = U.urljoin(url, href)
        links.append({"url": absolute, "title": clean(a.text_content()), "attachment": bool(ASSET.search(absolute) or "/download.do" in absolute)})
    for a in tree.xpath(f'//*[{cls("view-file")}]//a[@href]'):
        links.append({"url": U.urljoin(url, a.get("href")), "title": clean(a.text_content()), "attachment": True})
    # PDFObject embeds the handbook file in script data, not an anchor tag.
    selected_label = clean(' '.join(node.xpath('.//option[@selected]/text()')))
    for script in node.xpath('.//script/text()'):
        for embedded in re.findall(r'''PDFObject\.embed\(\s*["']([^"']+)["']''', script):
            if re.search(r'\.pdf(?:$|[?#])', embedded, re.I):
                links.append({"url": U.urljoin(url, embedded), "title": title + ' ' + selected_label + '.pdf', "attachment": True})
    for embedded in node.xpath('.//iframe/@src|.//embed/@src|.//object/@data'):
        if re.search(r'\.pdf(?:$|[?#])',embedded,re.I):
            links.append({"url":U.urljoin(url,embedded),"title":title+'.pdf',"attachment":True})
    forms = tree.xpath('//form[contains(@action,"artclList.do")]/@action')
    if kind != "article" and forms:
        kind = "listing"
    if "/sites/" in url and kind == "page":
        kind = "homepage"
        # Homepages are retained as link directories; excluded from default retrieval.
        title = title or hint
        items = []
        seen = set()
        for a in tree.xpath('//a[@href]'):
            label, href = clean(a.text_content()), U.urljoin(url, a.get("href"))
            if label and href.startswith("http") and (label, href) not in seen:
                items.append(label + " — " + href)
                seen.add((label, href))
        text = "\n".join(items)
    else:
        text = body_text(node)
    contact = tree.xpath(f'//*[{cls("contentsWrap")}]')
    if contact and kind == "page":
        text += "\n" + body_text(contact[0])
    modified = dates.get("수정일")
    if not modified:
        match = re.search(r"최종수정일\s*:\s*(\d{4}\.\d{2}\.\d{2})", text)
        modified = match.group(1).replace(".", "-") if match else None
    images = [U.urljoin(url, x) for x in node.xpath('.//img/@src')]
    flags = []
    if images:
        flags.append('has_images_not_ocr')
    if '/schdulmanage/' in url:
        query = U.parse_qs(U.urlsplit(url).query)
        year = query.get('year', [''])[0]
        month = query.get('month', [''])[0]
        if 'yearSchdul.do' in url:
            kind = 'calendar_index'
            flags.append('year_view_missing_event_titles_use_month_views')
            title = f'{year}년 학사일정 연간 색인'
        elif 'monthSchdul.do' in url:
            kind = 'calendar'
            title = f'{year}년 {month}월 학사일정'
            events = select_first(tree, [f'//*[{cls("sche-comt")}]'])
            if events is not None:
                text = body_text(events)
            text = title + '\n' + text
            if not re.search(r'\d{2}\.\d{2}|\d{2}-\d{2}', text):
                flags.append('no_calendar_events_published')
    if len(text) < 100 and images:
        flags.append("image_content_not_ocr")
    if re.search(r"ignore (all |previous )?instructions|system prompt|이전.{0,8}지시.{0,8}무시", text, re.I):
        flags.append("possible_prompt_injection_review")
    return dict(title=title or hint or url, content=text, kind=kind, published_at=normalized_date(dates.get("작성일")), modified_at=normalized_date(modified),
                author=dates.get("작성자"), links=links, images=images, flags=flags, board_forms=forms, tree=tree)


def schema(db):
    db.executescript('''
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS documents(
      id INTEGER PRIMARY KEY, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
      category TEXT NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL,
      published_at TEXT, modified_at TEXT, author TEXT, fetched_at TEXT NOT NULL,
      content_sha256 TEXT NOT NULL, duplicate_of INTEGER REFERENCES documents(id),
      flags_json TEXT NOT NULL, images_json TEXT NOT NULL, raw_zlib BLOB);
    CREATE INDEX IF NOT EXISTS documents_hash ON documents(content_sha256);
    CREATE TABLE IF NOT EXISTS links(document_id INTEGER REFERENCES documents(id), url TEXT, title TEXT, is_attachment INTEGER,
      PRIMARY KEY(document_id,url));
    CREATE TABLE IF NOT EXISTS attachments(url TEXT PRIMARY KEY, title TEXT, parent_document_id INTEGER REFERENCES documents(id),
      status TEXT NOT NULL, document_id INTEGER REFERENCES documents(id), detail TEXT);
    CREATE TABLE IF NOT EXISTS crawl_log(url TEXT PRIMARY KEY,status TEXT NOT NULL,http_status INTEGER,detail TEXT,fetched_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS frontier(url TEXT PRIMARY KEY,title TEXT,category TEXT,kind TEXT,parent_url TEXT,status TEXT NOT NULL DEFAULT 'pending');
    CREATE TABLE IF NOT EXISTS chunks(id INTEGER PRIMARY KEY,document_id INTEGER NOT NULL REFERENCES documents(id),
      chunk_index INTEGER NOT NULL,start_char INTEGER NOT NULL,end_char INTEGER NOT NULL,content TEXT NOT NULL,
      UNIQUE(document_id,chunk_index));
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(title,content,tokens,tokenize='unicode61');
    ''')


def grams(text):
    words = re.findall(r"[가-힣]+|[a-zA-Z0-9]+", text.lower())
    out = []
    for word in words:
        out.append(word)
        if re.search("[가-힣]", word):
            out.extend(word[i:i+2] for i in range(len(word)-1))
    return " ".join(out)


def extract_pdf(data, title):
    import pypdfium2 as pdfium
    if not data.startswith(b'%PDF'):
        raise ValueError('attachment response is not a PDF')
    parts=[]
    with pdfium.PdfDocument(data) as pdf:
        for i in range(len(pdf)):
            page=pdf[i]
            textpage=page.get_textpage()
            text=textpage.get_text_bounded()
            textpage.close();page.close()
            text='\n'.join(clean(line) for line in text.splitlines() if clean(line))
            parts.append(f'[PDF {i+1}쪽]\n'+text)
    content='\n\n'.join(parts)
    meaningful=len(re.sub(r'\[PDF \d+쪽\]|\s','',content))
    flags=[] if meaningful>=80 else ['scanned_pdf_not_ocr']
    return dict(title=title,content=content if meaningful>=80 else '',kind='pdf',flags=flags)


def store_document(db, url, category, doc, raw):
    digest = hashlib.sha256(doc["content"].encode()).hexdigest()
    duplicate = db.execute('SELECT id FROM documents WHERE content_sha256=? AND duplicate_of IS NULL AND url<>?', (digest, url)).fetchone()
    existing = db.execute('SELECT id FROM documents WHERE url=?', (url,)).fetchone()
    values = (url, doc["title"], category, doc["kind"], doc["content"], doc.get("published_at"), doc.get("modified_at"), doc.get("author"), now(), digest,
              duplicate[0] if duplicate else None, json.dumps(doc.get("flags", []), ensure_ascii=False), json.dumps(doc.get("images", []), ensure_ascii=False), zlib.compress(raw))
    if existing:
        doc_id = existing[0]
        db.execute('UPDATE documents SET url=?,title=?,category=?,kind=?,content=?,published_at=?,modified_at=?,author=?,fetched_at=?,content_sha256=?,duplicate_of=?,flags_json=?,images_json=?,raw_zlib=? WHERE id=?', values+(doc_id,))
        db.execute('DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE document_id=?)', (doc_id,))
        db.execute('DELETE FROM chunks WHERE document_id=?', (doc_id,))
        db.execute('DELETE FROM links WHERE document_id=?', (doc_id,))
    else:
        doc_id = db.execute('INSERT INTO documents(url,title,category,kind,content,published_at,modified_at,author,fetched_at,content_sha256,duplicate_of,flags_json,images_json,raw_zlib) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', values).lastrowid
    for link in doc.get("links", []):
        db.execute('INSERT OR REPLACE INTO links VALUES(?,?,?,?)', (doc_id, canonical(link["url"]) or link["url"], link["title"], int(link["attachment"])))
    if not duplicate and doc["kind"] not in {"listing", "homepage", "calendar_index"} and 'no_calendar_events_published' not in doc.get('flags', []) and len(doc["content"]) >= 50:
        start, index, content = 0, 0, doc["content"]
        while start < len(content):
            end = min(start + 1400, len(content))
            if end < len(content):
                boundary = content.rfind("\n", start+700, end)
                if boundary >= 0:
                    end = boundary + 1
            chunk = content[start:end]
            cid = db.execute('INSERT INTO chunks(document_id,chunk_index,start_char,end_char,content) VALUES(?,?,?,?,?)', (doc_id,index,start,end,chunk)).lastrowid
            db.execute('INSERT INTO chunks_fts(rowid,title,content,tokens) VALUES(?,?,?,?)', (cid,doc["title"],chunk,grams(doc["title"]+" "+chunk)))
            if end == len(content):
                break
            start = max(start+1,end-180)
            index += 1
    return doc_id


class Collector:
    def __init__(self, db, config):
        self.db, self.config = db, config
        self.last = 0
        self.count = 0

    def enqueue(self, url, title, category, kind, parent=""):
        url = canonical(url, parent or BASE)
        if url:
            self.db.execute('INSERT OR IGNORE INTO frontier(url,title,category,kind,parent_url) VALUES(?,?,?,?,?)', (url,title,category,kind,parent))

    def fetch(self, url):
        # Older resumed queue rows may still carry unescaped Korean file names.
        url = canonical(url) or url
        # Keep redirects restricted to the configured origin; never follow to a login provider.
        class SameOrigin(R.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                if U.urlsplit(newurl).hostname != "www.kyungnam.ac.kr":
                    raise ValueError("off-origin redirect excluded: " + newurl)
                return super().redirect_request(req, fp, code, msg, headers, newurl)
        for attempt in range(3):
            time.sleep(max(0,self.config["request_interval_seconds"]-(time.monotonic()-self.last)))
            self.last = time.monotonic()
            try:
                with R.build_opener(SameOrigin()).open(R.Request(url, headers={"User-Agent":UA}), timeout=30) as r:
                    cap = self.config.get('max_curriculum_bytes',self.config['max_response_bytes']) if '/atchmnfl/curriculum/' in url else self.config["max_response_bytes"]
                    data = r.read(cap+1)
                    if len(data)>cap:
                        raise ValueError("response exceeds configured byte limit")
                    return data, r.headers.get_content_type(), r.status
            except urllib.error.HTTPError as e:
                if e.code in {429,500,502,503,504} and attempt<2:
                    time.sleep(min(30,int(e.headers.get("Retry-After","5")) if e.headers.get("Retry-After","").isdigit() else 5*(attempt+1)))
                    continue
                raise
            except (TimeoutError, urllib.error.URLError):
                if attempt == 2:
                    raise
                time.sleep(3*(attempt+1))

    def seed(self, data):
        doc = parse_page(data, self.config["start_url"])
        tree = doc["tree"]
        self.enqueue(self.config["start_url"], "경남대학교 대표", "대학소개", "html")
        # Menu links, including explicitly linked department landing pages only.
        for a in tree.xpath('//a[@href]'):
            url = canonical(a.get("href"))
            title = clean(a.text_content())
            if not url or not title or re.search(r"로그인|개인정보|이메일무단|정보주체|Q&A|정보공개|자유게시판", title):
                continue
            path = U.urlsplit(url).path
            if re.fullmatch(r'/(?:ko|cge|international|dorm)/\d+/subview.do',path) or re.fullmatch(r'/sites/[a-zA-Z0-9_-]+/index.do',path):
                if re.search(r'/sites/(en|ch)/', path):
                    continue
                self.enqueue(url,title,title,"html",self.config["start_url"])
            elif re.fullmatch(r'/bbs/ko/\d+/\d+/artclView.do',path):
                self.enqueue(url,title,"메인 공지","html",self.config["start_url"])
        self.db.commit()

    def discover(self, url, doc, category, doc_id):
        path = U.urlsplit(url).path
        for form in set(doc["board_forms"]):
            match = re.search(r'/bbs/([^/]+)/(\d+)/artclList.do',form)
            if not match:
                continue
            site, board = match.groups()
            board_label = doc["title"] + " " + category
            pages = self.config["core_board_pages"] if site=="ko" and ("학사공지" in board_label or "장학" in board_label or "일반공지" in board_label) and "(구)" not in board_label else 1
            for page in range(2,pages+1):
                self.enqueue(form+"?page="+str(page),doc["title"],category,"html",url)
        if doc["kind"] == "homepage":
            site_match = re.search(r'/sites/([^/]+)/',path)
            if site_match and site_match.group(1) in SELECTED-{"ko"}:
                for a in doc["tree"].xpath('//a[@href]'):
                    link = canonical(a.get("href"),url)
                    if link and re.fullmatch(r'/'+site_match.group(1)+r'/\d+/subview.do',U.urlsplit(link).path):
                        title = clean(a.text_content())
                        if not re.search(r'로그인|개인정보|Q&A|상담|자유게시판',title):
                            self.enqueue(link,title,category+" / "+title,"html",url)
        for link in doc["links"]:
            u = canonical(link["url"],url)
            if not u:
                continue
            p = U.urlsplit(u).path
            if link["attachment"]:
                name = link["title"] or U.unquote(p.split('/')[-1])
                pdf = bool(re.search(r'\.pdf(?:$|\b)',name,re.I) or re.search(r'\.pdf$',p,re.I))
                status = "queued" if pdf else "link_only_unsupported_format"
                self.db.execute('INSERT OR IGNORE INTO attachments VALUES(?,?,?,?,NULL,?)',(u,name,doc_id,status,"" if pdf else "PDF 외 첨부파일: 링크만 저장, 본문 미추출"))
                if pdf:
                    self.enqueue(u,name,category,"pdf",url)
            elif doc["kind"] == "listing" and re.fullmatch(r'/bbs/(?:ko|cge|dorm|international)/\d+/\d+/artclView.do',p):
                self.enqueue(u,link["title"],category,"html",url)
            elif doc["kind"] == "page" and re.fullmatch(r'/ko/\d+/subview.do',p) and not re.search(r'로그인|개인정보|Q&A',link["title"]):
                self.enqueue(u,link["title"],category,"html",url)
        if path=="/ko/4293/subview.do":
            vals = {x.get("id"):x.get("value") for x in doc["tree"].xpath('//input[@id]')}
            if vals.get("siteId")=="ko" and vals.get("fnctNo"):
                for year in self.config["calendar_years"]:
                    self.enqueue(f'/schdulmanage/ko/{vals["fnctNo"]}/yearSchdul.do?year={year}',f'{year}년 학사일정',"학사일정","calendar",url)
                    for month in range(1,13):
                        self.enqueue(f'/schdulmanage/ko/{vals["fnctNo"]}/monthSchdul.do?year={year}&month={month}',f'{year}년 {month}월 학사일정',"학사일정","calendar",url)

    def one(self, row):
        url,title,category,kind,parent,_ = row
        code = None
        try:
            data, mime, code = self.fetch(url)
            if kind=="pdf":
                doc=extract_pdf(data,title)
            else:
                if mime not in {"text/html", "application/xhtml+xml"}:
                    raise ValueError("unsupported content type: "+mime)
                doc=parse_page(data,url,title)
                if any(x in doc["title"] for x in ["오류발생","에러페이지","ERROR"]):
                    raise ValueError("website returned error page")
                if len(doc["content"])<10:
                    if doc['images'] or any(link['attachment'] for link in doc['links']):
                        doc['flags'].append('no_text_body_not_indexed')
                    else:
                        raise ValueError("no usable text extracted")
            doc_id=store_document(self.db,url,category,doc,data)
            if kind=="pdf":
                self.db.execute('UPDATE attachments SET status=?,document_id=?,detail=? WHERE url=?',("extracted" if doc["content"] else "needs_ocr",doc_id,json.dumps(doc["flags"]),url))
            else:
                self.discover(url,doc,category,doc_id)
            self.db.execute('INSERT OR REPLACE INTO crawl_log VALUES(?,?,?,?,?)',(url,"ok",code,"",now()))
            self.db.execute('UPDATE frontier SET status="done" WHERE url=?',(url,))
        except Exception as e:
            self.db.rollback()
            code=getattr(e,"code",code)
            self.db.execute('INSERT OR REPLACE INTO crawl_log VALUES(?,?,?,?,?)',(url,"error",code,f'{type(e).__name__}: {e}',now()))
            self.db.execute('UPDATE frontier SET status="error" WHERE url=?',(url,))
            if kind=="pdf":
                self.db.execute('UPDATE attachments SET status="error",detail=? WHERE url=?',(str(e),url))
            print(json.dumps({"error":url,"detail":str(e)},ensure_ascii=False),flush=True)
        self.db.commit()
        self.count+=1
        if self.count%20==0:
            print(json.dumps(stats(self.db),ensure_ascii=False),flush=True)


def stats(db):
    return dict(time=now(),documents=db.execute('SELECT count(*) FROM documents').fetchone()[0],chunks=db.execute('SELECT count(*) FROM chunks').fetchone()[0],
                searchable_documents=db.execute('SELECT count(DISTINCT document_id) FROM chunks').fetchone()[0],
                queue=dict(db.execute('SELECT status,count(*) FROM frontier GROUP BY status')),kinds=dict(db.execute('SELECT kind,count(*) FROM documents GROUP BY kind')),
                attachments=dict(db.execute('SELECT status,count(*) FROM attachments GROUP BY status')))


def export(db, config):
    db.row_factory=sqlite3.Row
    with (ROOT/'chunks.jsonl').open('w',encoding='utf8') as f:
        for row in db.execute('SELECT c.id AS chunk_id,c.document_id,c.chunk_index,c.start_char,c.end_char,c.content,d.title,d.url,d.category,d.kind,d.published_at,d.modified_at,d.fetched_at,d.content_sha256,d.flags_json FROM chunks c JOIN documents d ON d.id=c.document_id ORDER BY c.id'):
            f.write(json.dumps(dict(row),ensure_ascii=False)+'\n')
    with (ROOT/'documents.jsonl').open('w',encoding='utf8') as f:
        for row in db.execute('SELECT id,url,title,category,kind,content,published_at,modified_at,author,fetched_at,content_sha256,duplicate_of,flags_json FROM documents ORDER BY id'):
            f.write(json.dumps(dict(row),ensure_ascii=False)+'\n')
    report=stats(db)
    report.update(config=config,errors=[dict(x) for x in db.execute('SELECT * FROM crawl_log WHERE status="error"')],
                  integrity_check=db.execute('PRAGMA integrity_check').fetchone()[0],
                  limitations=["전체 학교 도메인·게시판 전체 과거 기록을 수집한 DB가 아님", "학사·장학·일반 공지 최신 설정 페이지 수, 기타 게시판 첫 페이지", "로그인·외부 도메인 제외", "이미지 및 스캔 PDF OCR 미수행", "HWP/HWPX/Office/ZIP 첨부파일은 링크만 보존", "임베딩 미생성: FTS5 한국어 2글자 검색 및 임베딩 입력용 JSONL 제공"])
    (ROOT/'crawl_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    return report


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--export-only',action='store_true')
    p.add_argument('--retry-errors',action='store_true')
    p.add_argument('--refresh',action='store_true',help='Re-fetch existing frontier; crawl scope stays configured')
    p.add_argument('--reprocess',action='store_true',help='Reparse cached HTML, rebuild affected chunks and discover missing links without re-fetching it')
    p.add_argument('--reprocess-pdf',action='store_true',help='Re-extract cached PDFs using the installed PDFium parser')
    args=p.parse_args()
    config=json.loads((ROOT/'config.json').read_text(encoding='utf8'))
    db=sqlite3.connect(ROOT/'kyungnam.db',timeout=60)
    db.execute('PRAGMA journal_mode=WAL')
    schema(db)
    if args.reprocess_pdf:
        for doc_id,url,title,category,fetched_at,raw in db.execute('SELECT id,url,title,category,fetched_at,raw_zlib FROM documents WHERE kind="pdf" ORDER BY id').fetchall():
            data=zlib.decompress(raw)
            doc=extract_pdf(data,title)
            store_document(db,url,category,doc,data)
            db.execute('UPDATE documents SET fetched_at=? WHERE id=?',(fetched_at,doc_id))
            db.execute('UPDATE attachments SET status=?,detail=? WHERE url=?',('extracted' if doc['content'] else 'needs_ocr',json.dumps(doc['flags']),url))
        db.commit()
    if args.reprocess:
        collector=Collector(db,config)
        rows=db.execute('SELECT id,url,title,category,fetched_at,raw_zlib FROM documents WHERE kind<>"pdf" ORDER BY id').fetchall()
        for doc_id,url,title,category,fetched_at,raw in rows:
            data=zlib.decompress(raw)
            doc=parse_page(data,url,title)
            store_document(db,url,category,doc,data)
            db.execute('UPDATE documents SET fetched_at=? WHERE id=?',(fetched_at,doc_id))
            collector.discover(url,doc,category,doc_id)
        db.commit()
    if not args.export_only:
        collector=Collector(db,config)
        robots,_,_=collector.fetch(BASE+'/robots.txt')
        rp=urllib.robotparser.RobotFileParser();rp.parse(robots.decode().splitlines())
        allowed=rp.can_fetch(UA,config['start_url'])
        if not allowed and not config.get('site_owner_permission_confirmed'):
            raise SystemExit('robots.txt disallows collection; site-owner permission is required in config.json')
        db.execute('INSERT OR REPLACE INTO metadata VALUES(?,?)',('robots_txt',robots.decode()))
        db.execute('INSERT OR REPLACE INTO metadata VALUES(?,?)',('config',json.dumps(config,ensure_ascii=False)))
        db.execute('INSERT OR REPLACE INTO metadata VALUES(?,?)',('last_run_started_at',now()))
        if args.refresh:
            db.execute('UPDATE frontier SET status="pending"')
        if args.retry_errors:
            db.execute('UPDATE frontier SET status="pending" WHERE status="error"')
        if not db.execute('SELECT 1 FROM frontier LIMIT 1').fetchone():
            data,_,_=collector.fetch(config['start_url']);collector.seed(data)
        db.commit()
        while collector.count < config['max_fetches_per_run']:
            row=db.execute('SELECT * FROM frontier WHERE status="pending" ORDER BY CASE kind WHEN "calendar" THEN 0 WHEN "html" THEN 1 ELSE 2 END,rowid LIMIT 1').fetchone()
            if not row:
                break
            collector.one(row)
    report=export(db,config)
    db.execute('INSERT OR REPLACE INTO metadata VALUES(?,?)',('last_exported_at',now()))
    db.commit();db.close()
    print(json.dumps({k:v for k,v in report.items() if k not in {'config','errors','limitations'}},ensure_ascii=False),flush=True)


if __name__=='__main__':
    main()
