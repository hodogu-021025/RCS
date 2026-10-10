# Saylo — 주문 챗봇

채팅·버튼·음성으로 배달 주문과 식당 예약을 끝까지 진행하는 소비자 챗봇에, 로그인으로 나뉘는 사장님·관리자 페이지가 붙어 있습니다.
모바일 기준 웹이라 소비자·사장님·관리자 화면 모두 휴대폰 폭(최대 440px)으로 그리고, PC에서는 가운데 휴대폰 크기 카드로 띄웁니다.

계정·주문·예약·매장 설정은 `server/` API 서버가 SQLite 에 저장합니다. 그래서 손님이 자기 폰에서 주문하면 사장님 폰의 사장님 화면에 몇 초 안에 뜹니다. 결제와 매장·메뉴 목록은 화면 확인용 데모입니다.

- 기술: React 19, TypeScript, Vite, Vitest (테스트), oxlint (린트)
- 공개 도메인: sayloorder.com (도메인·호스팅 연결은 별도 담당자)

## 역할과 페이지

| 주소 | 누가 | 내용 |
|---|---|---|
| `#/` | — | 첫 화면: 로그인으로 이동 |
| `#/chat` | 누구나 | 소비자 챗봇 (로그인 없이 사용 가능, 로그인하면 주문에 이름이 남음) |
| `#/login` | — | 로그인 (아래에 회원가입 버튼) |
| `#/signup` | — | 회원가입: 고객님 또는 사장님(내 매장 선택). 가입하면 바로 로그인 |
| `#/me` | 로그인한 사람 | 내 주문·예약 내역 |
| `#/owner` | 사장님 | 내 매장의 주문·예약 접수(상태 변경, 새 주문 알림), 영업시간·메뉴 가격·품절 관리, 매출 요약 |
| `#/admin` | 관리자 | 전체 주문·예약 현황, 매장별 사장님 계정 관리, 통계, 사용자 목록 |

회원가입으로 고객님·사장님 계정을 만들 수 있고(이메일 인증 필요), 관리자 페이지에서도 사장님 계정을 만들 수 있습니다. 관리자는 가입이 없고 `.env` 의 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 로 서버가 처음 시작할 때 하나 만듭니다 (개발 중에 비워 두면 `adminuser / admin1234`).

로그인은 서버가 판단합니다. 비밀번호는 서버에만 암호화(scrypt)해 저장하고, 브라우저에는 로그인 토큰만 남습니다(30일). 관리자가 사장님 계정을 지우면 그 사장님은 다음 요청 때 바로 로그아웃됩니다.

## 실행

Node 24 이상이 필요합니다. 화면(frontend)과 API 서버(server)를 각각 띄웁니다.

```bash
cp .env.example .env     # 처음 한 번: RESEND_API_KEY, ADMIN_USERNAME / ADMIN_PASSWORD 를 채운다
npm --prefix server run dev        # API     http://localhost:3001  (데이터: server/data/saylo.db)
cd frontend && npm install && npm run dev   # 화면 http://localhost:5173 (/api 는 3001 로 넘어감)
```

### API 서버

외부 패키지 없이 Node 내장 기능(http, node:sqlite, crypto)만 씁니다. 주소 목록과 권한은 `server/app.mjs` 맨 위 주석에 있습니다.

- 데이터: SQLite 파일 하나 (`DATA_DIR`, 기본 `server/data/`, Docker 는 `/data` 볼륨). 지우면 처음 상태로 돌아갑니다.
- 로그인: `Authorization: Bearer <토큰>` 헤더. 토큰은 서버 DB 의 `sessions` 에 있고 30일 뒤 만료됩니다.
- 권한: 손님은 자기 주문·예약만, 사장님은 자기 매장만, 관리자는 전부. 비회원 주문도 됩니다.
- 매장 id 목록은 `server/stores.mjs` 에도 있어서 식당을 추가하면 화면 쪽(`orderChatKnowledge.ts`)과 같이 적습니다.
- 서버 테스트: `npm --prefix server test` (메모리 DB 로 API 전체를 돌려 봅니다)

### 이메일 인증 (Resend)

회원가입할 때 이메일로 6자리 인증번호를 보내고 확인합니다. Resend API 키는 브라우저에 넣으면 누구나 볼 수 있어서 `server/`(외부 패키지 없는 Node 서버)에만 둡니다.

- 저장소 루트 `.env`(git 에 안 올라감)에 `RESEND_API_KEY`, `MAIL_FROM` 을 적습니다. 형식은 `.env.example`.
- **보내는 주소**: Resend 에 도메인을 인증하기 전에는 `onboarding@resend.dev` 만 쓸 수 있고, 이때는 **Resend 계정 주인의 메일로만** 발송됩니다. 아무 주소로나 보내려면 Resend → Domains 에서 `sayloorder.com` 을 추가하고 가비아 DNS 에 안내된 레코드를 넣은 뒤 `MAIL_FROM=Saylo <no-reply@sayloorder.com>` 처럼 바꿉니다.
- 키가 없을 때: 개발 중(`npm run dev`)에는 메일 대신 API 서버 콘솔에 인증번호를 찍고, Docker(운영 모드)에서는 발송을 거절합니다.
- 규칙: 번호 유효 5분, 같은 주소 재발송 1분 뒤, 번호 하나로 5번까지 시도, 한 IP 당 10분에 5통.
- 서버 테스트: `npm --prefix server test`

| 명령 | 하는 일 |
|---|---|
| `npm run dev` | 개발 서버 (저장하면 바로 반영) |
| `npm test` | 테스트 전체 실행 |
| `npm run lint` | 린트 |
| `npm run build` | 타입 검사 후 배포용 빌드 → `frontend/dist/` |
| `npm run build:html` | 로고·영상까지 넣은 **HTML 한 파일** → 저장소 루트의 `saylo.html` (더블클릭으로 열림) |

### Docker로 띄우기 (저장소 루트에서)

화면(nginx)과 API 서버가 함께 뜨고, nginx 가 `/api/` 를 API 서버로 넘깁니다. `.env` 의 Resend 설정을 읽습니다.

```bash
docker compose up -d --build                  # http://localhost:8080
docker compose --profile tunnel up -d         # + 인터넷 임시 주소 (Cloudflare, 주소는 켤 때마다 바뀜)
docker compose logs tunnel | grep trycloudflare
docker compose --profile tunnel down          # 터널까지 모두 중지
```

## 배포

화면은 `npm run build`로 나온 `frontend/dist/` 정적 파일이고, 로그인·주문·예약 저장과 이메일 인증은 `server/` API 서버가 맡습니다. **정적 호스팅(가비아 웹호스팅, Vercel, Cloudflare Pages 등)에 화면만 올리면 로그인·주문 저장·이메일 인증이 모두 동작하지 않습니다.** Docker 가 도는 리눅스 서버 한 대가 필요합니다 (가비아 클라우드, Oracle Cloud 무료 서버 등).

### 서버에 올리기 (Ubuntu 기준, 처음 한 번)

```bash
# 1) Docker 설치
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker

# 2) 저장소 받기 (비공개 저장소라 GitHub 로그인이 필요합니다)
git clone https://github.com/hodogu-021025/RCS.git saylo && cd saylo

# 3) 설정: DOMAIN, ADMIN_USERNAME / ADMIN_PASSWORD, RESEND_API_KEY, MAIL_FROM 을 채운다
cp .env.example .env && nano .env

# 4) 띄우기 (화면 + API + HTTPS)
docker compose -f docker-compose.prod.yml up -d --build
```

- 가비아 DNS 관리에서 `sayloorder.com` 의 **A 레코드를 이 서버의 공인 IP** 로 바꿉니다 (`www` 도 같은 IP). 서버의 **80·443 포트**를 방화벽에서 엽니다. 그러면 Caddy 가 Let's Encrypt 인증서를 자동으로 받아 HTTPS 로 서비스합니다 (`deploy/Caddyfile`).
- 사장님이 회원가입으로 직접 가입하면 관리자 화면(매장·사장님 탭)에서 **승인**해야 매장 주문·예약을 볼 수 있습니다. 관리자가 만든 사장님 계정은 바로 쓸 수 있습니다.
- 관리자 계정은 서버가 처음 시작할 때 `.env` 값으로 한 번 만듭니다. 나중에 바꾸려면 관리자 화면 대신 DB 를 지우고 다시 시작해야 하니 처음에 잘 정합니다.
- 코드를 고친 뒤 다시 올리기: `git pull && docker compose -f docker-compose.prod.yml up -d --build`
- 백업: `docker run --rm -v saylo_saylo-data:/data -v $PWD:/backup alpine cp /data/saylo.db /backup/saylo-$(date +%F).db`
- 로그: `docker compose -f docker-compose.prod.yml logs -f api` (주문·오류), `… logs -f caddy` (인증서)
- 로컬에서 운영 구성을 시험하려면 `DOMAIN=localhost docker compose -f docker-compose.prod.yml up -d --build` 뒤 https://localhost (자체 인증서라 브라우저 경고는 정상).
- 빌드 명령: `npm --prefix frontend run build` (저장소 루트 기준) 또는 `cd frontend && npm run build`
- 결과물: `frontend/dist`
- 페이지 이동은 해시 주소(`#/owner`)를 써서 별도 리라이트 설정이 필요 없습니다.
- `frontend/Dockerfile` + `deploy/nginx.conf`는 같은 결과물을 nginx 이미지로 만듭니다 (빌드 컨텍스트는 저장소 루트).
- 음성 인식은 HTTPS(또는 localhost)에서만 마이크가 열립니다.

## 폴더 구조

```
frontend/
  src/
    components/
      OrderChatbot.tsx        채팅 화면과 대화 흐름(단계) 전체
      orderChatKnowledge.ts   배달 메뉴·식당·예약 규칙, 문장 해석(수량·날짜·시간·결제수단), 주문서 모델
      quickMenu.ts            입력창 + 버튼으로 여는 빠른 메뉴 (배달·식당)
      PaymentSheet.tsx        결제 팝업 (신용카드·카카오페이·토스페이, 데모)
      CalendarPicker.tsx      날짜 달력
      TimePicker.tsx, Wheel.tsx   오전/오후·시·분 휠
      CountPicker.tsx         −/+ 수량·인원 카운터
      Select.tsx              결제 팝업 드롭다운
      useSpeech.ts            음성 입력(말 → 글자)과 읽어 주기(글자 → 말)
      *.test.ts(x)            같은 이름 파일의 테스트
    api/client.ts             API 호출 공통 (토큰 헤더, 오류 처리)
    auth/auth.ts              로그인 상태 (서버 세션을 토큰으로 되살림), 회원가입
    data/db.ts                서버에서 받아 온 주문·예약·매장 설정·계정 (몇 초마다 새로 받음)
    api/emailVerification.ts  이메일 인증 API 호출 (/api/email/…)
    pages/                    LoginPage, SignupPage(회원가입), EmailVerifyField(이메일 인증), PasswordField(눈 버튼),
                              OwnerPage(사장님), AdminPage(관리자), MyOrdersPage(내 주문), RequireRole(역할 검사)
    App.tsx                   주소별 페이지 연결 (HashRouter)
    index.css                 챗봇 스타일 (평면 디자인, 브랜드 파란색 #007cfc)
    dashboard.css             로그인·사장님·관리자 페이지 스타일
    image/                    로고, 배경 영상
  scripts/build-html.mjs      HTML 한 파일 만들기
  Dockerfile
server/
  index.mjs                   서버 시작 (환경변수, DB 열기, 관리자 계정 만들기)
  app.mjs                     API 주소·권한·입력 검사 (맨 위 주석에 주소 목록)
  db.mjs                      SQLite 저장소 (계정·세션·주문·예약·매장 설정)
  auth.mjs                    비밀번호 암호화(scrypt)·토큰·입력 규칙
  stores.mjs                  매장 id 목록, 상태 값
  verification.mjs            인증번호 만들기·확인·재발송 제한
  mail.mjs                    Resend 메일 발송
  *.test.mjs                  서버 테스트 (node --test)
  Dockerfile
deploy/nginx.conf             화면 컨테이너의 nginx 설정 (/api/ → API 서버)
docker-compose.yml            로컬 Docker: 화면 + API (+ 터널) → http://localhost:8080
docker-compose.prod.yml       운영 배포: 화면 + API + Caddy(HTTPS) — 서버에서 이걸로 띄운다
deploy/Caddyfile              HTTPS 앞단 설정 (도메인은 .env 의 DOMAIN)
.env.example                  Resend·관리자 계정 설정 예시 (.env 로 복사해서 사용)
```

## 자주 바꾸는 것

- 매장·메뉴·가격, 식당 목록: `orderChatKnowledge.ts`의 배열을 고치면 화면에 바로 반영됩니다.
- 배달지 기본 주소: `orderChatKnowledge.ts`의 `ADDRESS`
- 관리자 계정: `.env`의 `ADMIN_USERNAME` / `ADMIN_PASSWORD` (서버에 관리자가 없을 때 처음 한 번 만듦)
- 식당을 추가할 때: `orderChatKnowledge.ts`의 `RESTAURANTS`와 `server/stores.mjs`의 `STORE_IDS` 둘 다
- 색·여백: `index.css` 맨 위의 CSS 변수

## 대화 흐름 요약

- 배달: 메뉴 → 수량 → 주문서 확인 → 결제수단 → 결제 팝업 → 주문번호
- 식당: 음식 종류 → 근처 식당 → 날짜 → 시간 → 인원 → 예약 확인 → 예약번호
- 어느 단계든 "취소"라고 하면 그만두고, 헤더의 음성 모드(마이크)로 말해서 진행할 수 있습니다.
- 헤더 버튼: 계정 · 채팅창 끄기/켜기(말풍선 숨김, 배경 구체만 남음) · 소리 끄기/켜기(답 읽어 주기, 기본 켜짐) · 음성 모드

## 브라우저

Chrome, Edge, Safari 최신 버전. 음성 인식은 Chrome·Edge·Safari에서 되고 Firefox는 지원하지 않습니다(버튼이 비활성화됨).
