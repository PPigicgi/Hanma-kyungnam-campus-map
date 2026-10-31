# 한마 챗봇 실행 안내

`harness/`는 질문을 받아 대학 안내 자료를 검색하고 답하는 AI 서버입니다. 향후 모바일 앱에서 연결할 수 있는 API와 현재 기능 검증용 화면을 제공합니다. `crawl.py`와 `search.py`는 기존 자료 수집·검색 코드입니다. `harness`와 `search.py`의 상대 위치를 유지해야 합니다.

## DB 준비

기존 수집 DB를 이 폴더의 `kyungnam.db`로 복사합니다. 다른 경로라면 서버를 실행할 PowerShell에서 `$env:CAMPUS_DB_PATH='DB의 전체 경로'`를 지정합니다. 이 변수는 `.env`가 아니라 **프로세스 환경변수**로 지정해야 합니다. DB는 서버가 읽기 전용으로 엽니다.

DB는 저장소에 포함하지 않았습니다. 기존 DB 없이 새로 수집하려면 `requirements.txt`의 수집 패키지를 별도 가상환경에 설치하고 다음 절차를 따릅니다.

1. `config.example.json`을 `config.json`으로 복사합니다.
2. 시작 URL, 수집할 연도, 페이지 수와 요청 간격을 확인합니다.
3. 학교 측 허가와 사이트 이용 조건을 확인한 경우에만 `site_owner_permission_confirmed`를 설정합니다. 예제는 기본값이 `false`이며 다른 사용자의 권한을 자동으로 이어받지 않습니다.
4. `python crawl.py`를 실행합니다. 같은 폴더에 DB와 JSONL 내보내기 파일이 생성됩니다. 모두 Git에서 제외됩니다.

새 수집은 네트워크 요청을 수행하고 이 폴더의 DB를 갱신합니다. 공유받은 기존 DB를 유지하려면 별도 복사본에서 작업하세요. 수집 시점이 달라지면 고정 날짜를 사용하는 평가 결과도 달라질 수 있습니다.

## 서버 실행 · Windows PowerShell

```powershell
cd harness
.\setup.ps1 -Dev
Copy-Item .env.example .env
.\start.ps1 -Check
.\start.ps1 -Background
```

`setup.ps1`은 가상환경과 로컬 `.runtime.json`을 생성합니다. 폴더를 옮기면 다시 실행합니다. `-Python`으로 사용할 Python 실행 파일을 지정할 수 있습니다. 기존 `.env`가 있다면 복사 단계는 건너뜁니다.

| 주소 | 용도 |
| --- | --- |
| `http://127.0.0.1:8765/` | 기본 웹 화면 |
| `http://127.0.0.1:8765/mobile` | 모바일 화면 |
| `http://127.0.0.1:8765/docs` | API 문서 |
| `http://127.0.0.1:8765/healthz` | 서버 상태 |

종료는 `.\stop.ps1`, 검사만 실행하려면 `.\verify.ps1`입니다. 기본 검사는 실제 모델을 호출하지 않지만 수집 DB가 필요합니다.

## AI 설정

기본 예제는 `CAMPUS_LLM_MODE=codex`, `CAMPUS_CODEX_MODEL=gpt-6-luna`입니다. 실행하는 PC에 Codex CLI가 설치되어 있고 해당 사용자의 로그인이 준비되어야 합니다. 필요하면 `.env`에 `CAMPUS_CODEX_EXECUTABLE`을 지정합니다. 다른 사람의 로그인 파일을 복사하지 않습니다.

- `codex`: 로컬 Codex CLI와 로그인 사용. 해당 계정의 사용량이 발생합니다.
- `off`: 모델을 호출하지 않는 원문 검색 모드.
- `openai`: 별도 API 모드. `.env`의 `OPENAI_API_KEY`와 사용할 `OPENAI_MODEL`을 직접 설정해야 하며 API 사용량이 발생합니다.

분석과 답변의 전체 처리 한도는 기본 600초입니다. 모델 출력의 인용과 자료 번호를 검사하지만 이것이 모든 답변의 의미적 정확성을 보장하지는 않습니다. 수집된 자료에 없는 내용을 보유한 것처럼 응답하지 않도록 상태와 출처를 함께 반환합니다.

## API 예제

```javascript
const result = await fetch('http://127.0.0.1:8765/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ question: '통학버스는 어떻게 이용해?', history: [] })
}).then(response => response.json());
```

`history`에는 최근 사용자 질문을 최대 4개 전달합니다. 프런트엔드에서 호출할 때는 같은 출처의 `/api/chat` 또는 공유 게이트웨이를 사용합니다. 날짜를 생략하면 한국 시간을 기준으로 처리합니다.

Docker 정의도 원본 그대로 포함했습니다. 해당 이미지에는 Codex CLI와 로그인 설정이 들어 있지 않으므로, Windows의 기본 Codex 실행 절차를 그대로 대체하지 않습니다.
