# 지도와 한마를 같은 주소로 연결하기

저장소 루트에서 `node map/public-share.mjs`를 실행하면 `http://127.0.0.1:4318/`에서 모바일 지도를 제공합니다. PC 지도는 `/index.html`, 한마는 `/mobile`입니다. 한마를 사용하려면 별도로 `8765` 포트의 챗봇 서버가 실행되어야 합니다. 지도는 AI와 독립적으로 동작합니다.

게이트웨이는 방문자에게 필요한 지도 파일과 정해진 한마 API만 제공합니다. 질문은 방문자 IP당 분당 5건, 전체 시간당 60건, 동시에 1건으로 제한합니다. 시간이 걸리는 답변은 임시 번호로 조회합니다.

## 임시 외부 공유

Cloudflare의 `cloudflared`가 이미 준비된 환경이라면, 게이트웨이를 실행한 채 별도 터미널에서 다음 명령을 사용할 수 있습니다.

```bash
cloudflared tunnel --url http://127.0.0.1:4318 --protocol http2
```

출력되는 HTTPS 주소에 `/mobile.html` 또는 `/index.html`을 붙입니다. 지도와 터널 프로세스가 실행 중이어야 하며, 재시작하면 주소가 바뀔 수 있습니다. PC를 꺼도 접속되는 고정 서버는 별도 배포가 필요합니다. 참고: [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

실제 휴대전화 GPS는 HTTPS와 사용자의 위치 권한이 필요합니다. GitHub 비공개 저장소 설정은 별도로 공유한 웹사이트의 접속 권한을 제어하지 않습니다.
