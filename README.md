# Saylo — 주문 챗봇

채팅·버튼·음성으로 배달 주문과 식당 예약을 끝까지 진행하는 소비자 챗봇에, 로그인으로 나뉘는 사장님·관리자 페이지가 붙어 있습니다.
모바일 기준 웹이라 소비자·사장님·관리자 화면 모두 휴대폰 폭(최대 440px)으로 그리고, PC에서는 가운데 휴대폰 크기 카드로 띄웁니다.

계정·주문·예약·매장 설정은 `server/` API 서버가 SQLite 에 저장합니다. 그래서 손님이 자기 폰에서 주문하면 사장님 폰의 사장님 화면에 몇 초 안에 뜹니다. 결제는 자체 테스트용 모의 결제(신용카드·카카오페이·토스페이, 돈이 오가지 않음)와 계좌이체를 받고(결제 대행 연동 없음), 매장·메뉴 목록은 화면 확인용 데모입니다.

- 기술: React 19, TypeScript, Vite, Vitest (테스트), oxlint (린트)
- 공개 도메인: sayloorder.com (도메인·호스팅 연결은 별도 담당자)

## 역할과 페이지

| 주소 | 누가 | 내용 |
|---|---|---|
| `#/` | — | 첫 화면: 로그인으로 이동 |
| `#/chat` | 누구나 | 소비자 챗봇. 식당 예약은 로그인 없이 되고, 배달 주문은 로그인한 고객님만 (계정의 배달지·연락처로 보냄) |
| `#/login` | — | 로그인 (아래에 회원가입 버튼) |
| `#/signup` | — | 회원가입: 고객님만 (사장님 계정은 관리자가 만듦), 휴대폰 번호 필수(입력하면 010-1234-5678 모양으로 맞춤). 가입하면 바로 로그인 |
| `#/me` | 로그인한 사람 | 내 주문·예약 내역 |
| `#/account` | 고객님·사장님 | 계정 관리: 휴대폰 번호·배달지(고객님만) 바꾸기, 회원 탈퇴 |
| `#/owner` | 사장님 | 탭 4개: **주문·예약**(상태 변경, 새 주문 알림) · **매장**(일시 중지, 입금 계좌, 영업시간, 매장 정보) · **메뉴**(오늘의 메뉴, 가격·할인·품절·판매 중지, 메뉴 추가) · **매출** |
| `#/admin` | 관리자 | 전체 주문·예약 현황과 계좌이체 거래 내역, 매장별 사장님 계정 관리(입금 계좌 등록 여부), 통계, 사용자 목록 |

회원가입으로는 고객님 계정만 만들 수 있고(이메일 인증 필요), 사장님 계정은 관리자 페이지(매장·사장님 → 계정 만들기)에서 만듭니다. 관리자는 가입이 없고 `.env` 의 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 로 서버가 처음 시작할 때 하나 만듭니다 (개발 중에 비워 두면 `adminuser / admin1234`).

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
- 권한: 손님은 자기 주문·예약만, 사장님은 자기 매장만, 관리자는 전부. 배달 주문은 로그인한 고객님만 되고(서버도 막는다), 비회원은 식당 예약만 합니다.
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
- 사장님 계정은 관리자가 만들고, 만든 계정은 바로 쓸 수 있습니다. 예전에 회원가입으로 직접 가입해 승인을 기다리는 사장님이 남아 있으면 관리자 화면(매장·사장님 → 승인 대기)에서 **승인**해야 매장 주문·예약을 볼 수 있습니다.
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
- 앱으로 설치: 배포한 사이트(HTTPS)에서만 서비스 워커(`frontend/public/sw.js`)가 등록됩니다. 채팅 입력창 위에 띠가 뜨는데, 안드로이드는 "앱 받기"(앱 받기 화면 `#/app`으로), 아이폰은 "공유 → 홈 화면에 추가" 안내, 데스크톱 크롬은 "설치"입니다. 닫으면 7일 동안 다시 띄우지 않습니다 (`frontend/src/pwa.ts`). 서비스 워커는 화면·데이터를 저장하지 않고, 인터넷이 끊겼을 때 안내 화면만 보여 줍니다.
- 안드로이드 앱 파일(APK): `android/`는 sayloorder.com 채팅 화면을 주소창 없이 여는 앱(Trusted Web Activity)입니다. 사이트를 고치면 앱에도 바로 반영되므로 앱을 다시 만들 일은 드뭅니다. 만든 파일은 `frontend/public/download/saylo.apk`로 넣어 사이트에서 받게 합니다.
  - 다시 만들기: 안드로이드 SDK(platforms;android-35, build-tools;35.0.0)와 JDK 17이 필요합니다. `android/local.properties`(sdk.dir)와 `android/keystore.properties`(서명 키, git 제외)를 둔 뒤 `android/app/build.gradle.kts`의 `versionCode`를 1 올리고 `cd android && gradle assembleRelease`, 결과 `android/app/build/outputs/apk/release/app-release.apk`를 `frontend/public/download/saylo.apk`로 복사합니다.
  - 서명 키: 이 키로 서명해야 이미 설치한 앱이 업데이트됩니다. 키를 잃어버리면 손님이 앱을 지우고 새로 설치해야 하므로 키 파일과 `keystore.properties`를 따로 안전하게 보관합니다. 키의 SHA-256 지문은 `frontend/public/.well-known/assetlinks.json`에 있어야 앱이 주소창 없이 열립니다.

## 폴더 구조

```
frontend/
  src/
    components/
      OrderChatbot.tsx        채팅 화면과 대화 흐름(단계) 전체
      orderChatKnowledge.ts   배달 메뉴·식당·예약 규칙, 문장 해석(수량·날짜·시간), 주문서·계좌이체 모델
      quickMenu.ts            입력창 + 버튼으로 여는 빠른 메뉴 (배달·식당)
      CopyButton.tsx          계좌번호 "복사" 버튼
      CalendarPicker.tsx      날짜 달력
      TimePicker.tsx, Wheel.tsx   오전/오후·시·분 휠
      CountPicker.tsx         −/+ 수량·인원 카운터
      Select.tsx              드롭다운 (은행·매장 고르기 등)
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
  test/catalog.fixture.json   테스트 전용 가게·메뉴 목록 (예시 가게 여러 곳. 서버·화면 테스트가 함께 쓴다)
  Dockerfile
deploy/nginx.conf             화면 컨테이너의 nginx 설정 (/api/ → API 서버)
docker-compose.yml            로컬 Docker: 화면 + API (+ 터널) → http://localhost:8080
docker-compose.prod.yml       운영 배포: 화면 + API + Caddy(HTTPS) — 서버에서 이걸로 띄운다
deploy/Caddyfile              HTTPS 앞단 설정 (도메인은 .env 의 DOMAIN)
.env.example                  Resend·관리자 계정 설정 예시 (.env 로 복사해서 사용)
```

## 자주 바꾸는 것

- 가게·식당 목록과 처음 배달 메뉴: `server/catalog.json` 하나만 고치면 서버와 화면에 같이 반영됩니다. 지금은 시험용 가게 1곳(맛있는 족발 테스트점)만 있습니다.
  - 목록에서 뺀 가게의 메뉴는 DB에 남아 있어도 화면과 메뉴 API에 나오지 않습니다.
  - 관리자 화면의 "계정 만들기"에서 아이디·비밀번호와 매장 정보(이름·음식 종류·영업시간, 주소는 선택)를 넣으면, 서버 DB에 매장이 생기고 그 매장 사장님 계정이 함께 만들어집니다. 사장님 이름은 "매장 이름 사장님"으로 자동으로 정해집니다. 목록 파일의 매장과 합쳐서 챗봇·사장님·관리자 화면에 똑같이 쓰이고, 거리·평점은 비워 둡니다. `export-catalog.mjs`로 내보내면 이 매장도 목록에 들어갑니다.
  - 테스트는 이 파일 대신 `server/test/catalog.fixture.json`을 읽으므로, 실제 목록을 바꿔도 테스트는 그대로 돕니다.
- 가게의 메뉴를 한꺼번에 넣기: 메뉴를 `server/menus/가게.json`(이름·가격·단위·키워드)으로 정리한 뒤 `import-menu.mjs`로 넣습니다. 기본은 미리 보기이고 `--apply`를 붙여야 넣으며, 이미 판매 중인 같은 이름은 건너뜁니다.
  - 운영 서버: `docker compose -f docker-compose.prod.yml exec -T api node import-menu.mjs --store <매장 id> [--apply] < server/menus/가게.json`
  - 매장 id는 `https://sayloorder.com/api/stores`에서 확인합니다.
- 배달 메뉴 추가·판매 중지: 사장님 화면의 "메뉴" 탭에서 바로 합니다 (추가하면 바로 판매). 서버가 켜질 때 `catalog.json`의 메뉴 중 DB에 없는 것만 채워 넣으므로, 사장님이 바꾼 내용은 그대로 유지됩니다.
- 서버의 지금 메뉴 목록(사장님이 추가한 메뉴 포함)을 `catalog.json`에 되돌려 쓰기:
  - 운영 서버: `docker compose -f docker-compose.prod.yml exec -T api node export-catalog.mjs > server/catalog.new.json` 후 확인하고 `server/catalog.json`으로 바꿔 커밋
  - 로컬 개발: `node server/export-catalog.mjs --out server/catalog.json` (`>` 로 같은 파일에 받으면 파일이 먼저 비워져 목록이 날아갑니다)
- 배달지: 손님이 첫 주문 때 챗봇에 알려 주고, 그 브라우저에 기억됩니다.
- 관리자 계정: `.env`의 `ADMIN_USERNAME` / `ADMIN_PASSWORD` (서버에 관리자가 없을 때 처음 한 번 만듦)
- 관리자에게 문의: 고객님·사장님이 `#/inquiry`(계정 관리·화면 아래 링크, 챗봇에 "문의할래")에서 보내면 관리자 화면의 "문의" 탭에 쌓이고, 거기서 답합니다. 새 문의 알림 메일은 `.env`의 `ADMIN_NOTIFY_EMAIL`로 가고(비우면 안 보냄), 답변 알림은 문의한 분 계정에 이메일이 있으면 그 주소로 갑니다. 탈퇴하면 그 사람의 문의도 지웁니다.
- 색·여백: `index.css` 맨 위의 CSS 변수

## 매장 일시 중지

바쁘거나 재료가 떨어졌을 때 사장님이 **매장 탭 → 일시 중지**에서 잠깐 새 주문을 멈춥니다.

- 영업시간 카드처럼 **시작 시간·종료 시간** 두 칸을 고르고 "일시 중지"를 누릅니다. 시작 시간은 처음에 지금으로 채워져 있고, 앞으로의 시각으로 바꾸면 미리 정해 둡니다(그 전까지는 주문을 받습니다). 종료 시간이 시작보다 이르면 다음 날로 봅니다. 지금부터 24시간 안에서 정할 수 있습니다.
- 정해 두면 아래 **타이머**가 1초마다 "다시 받기까지 1:12:05"(멈춘 중) 또는 "일시 중지 시작까지 …"(예정)를 보여 줍니다. 종료 시간이 지나면 **저절로 다시 받고**, "지금 다시 받기"(예정이면 "일시 중지 취소")로 바로 풀 수 있으며, 시간을 고쳐 "시간 바꾸기"도 됩니다.- 멈추는 것: **새 배달 주문**과 **오늘 예약**. 내일 이후 예약과 이미 들어온 주문은 그대로입니다. 서버가 막으므로 화면을 거치지 않아도 막힙니다.
- 챗봇: 일시 중지한 매장은 메뉴·식당 추천에서 빠집니다. 손님이 그 가게나 메뉴를 콕 집어 말하면 "지금 잠시 주문을 받지 않아요. 15:30부터 다시 받아요"라고 알리고 비슷한 다른 메뉴를 권합니다. 이름으로 예약하면 오늘은 빼고 내일부터 고르게 합니다.
- 사장님 화면의 다른 탭 위에는 안내 띠가 뜨고, 관리자 화면 매장 목록에도 상태가 보입니다.
- 저장: `store_settings.paused_from`·`paused_until` (시작·끝 시각, 밀리초). API 는 `PATCH /api/stores/:id/settings { pause: { from?, until } | null }`.

## 결제: 모의 결제와 계좌이체

결제 대행(PG)을 붙이지 않았습니다. 주문서를 확인하면 결제수단을 고릅니다.

- **모의 결제**(신용카드·카카오페이·토스페이): 자체 테스트용입니다. 아래에서 결제 창(`PaymentSheet.tsx`)이 올라오고, 결제를 누르면 돈이 오가지 않은 채 주문이 바로 **접수**됩니다. 주문 기록의 결제수단은 `카카오페이 (모의 결제)`처럼 남아 사장님·관리자가 진짜 결제와 구분합니다. 입금 계좌가 없는 매장도 받고, 관리자 거래 내역(계좌이체용)에는 나오지 않습니다. 실제 서비스로 열기 전에는 빼야 합니다.
- **계좌이체**: 주문이 **입금 대기**로 들어가고, 챗봇이 입금 계좌·금액·입금자명(회원 이름)·입금 기한을 보여 줍니다. 계좌번호는 복사 버튼으로 숫자만 복사됩니다.
- 입금 계좌는 그 매장 사장님이 매장 탭에서 등록한 계좌입니다(관리자가 `PUT /api/stores/:id/bank` 로 대신 등록할 수도 있습니다). 계좌가 없으면 그 매장은 계좌이체 주문을 받지 않고, 사장님 화면 위에 안내 띠가 뜹니다. 주문에는 그때의 계좌가 그대로 남습니다.
- 관리자는 전체 현황 → 거래 내역에서 주문마다 입금 계좌·입금자명·금액·입금 확인 시각·상태를 보고, 매장 목록에서 어느 매장이 계좌를 등록했는지 봅니다.
- 사장님이 통장을 보고 **입금 확인**을 누르면 접수 → 준비 시작 → 배달 완료로 이어집니다. 매출에는 입금이 확인된 주문만 셉니다.
- 주문 후 30분 안에 입금 확인이 안 되면 서버가 자동으로 취소합니다(`server/stores.mjs` 의 `PAY_WINDOW_MS`, 화면 안내는 `PAY_WINDOW_MIN`).
- 고객님은 입금 대기·접수 상태일 때 챗봇("주문 취소할래")이나 내 주문 화면에서 취소할 수 있습니다. 이미 입금한 주문의 환불은 매장과 직접 해결합니다.

## 대화 흐름 요약

- 배달: 메뉴 → 수량 → 주문서 확인 → 결제수단 → 모의 결제 창에서 결제(바로 접수) 또는 입금 안내(계좌·금액·입금자명·기한, 계좌번호 복사) → 사장님이 입금 확인 → 준비 → 배달 완료
  - 로그인 전이면 로그인 화면으로, 계정에 배달지·연락처가 없으면 계정 관리(`#/account`)로 안내하고, 돌아오면 고르던 메뉴·수량으로 이어 갑니다.
- 식당: 음식 종류 → 근처 식당 → 날짜 → 시간 → 인원 → 예약 확인 → 예약번호
- 어느 단계든 "취소"라고 하면 그만두고, 헤더의 음성 모드(마이크)로 말해서 진행할 수 있습니다.
- 헤더 버튼: 계정 · 채팅창 끄기/켜기(말풍선 숨김, 배경 구체만 남음) · 소리 끄기/켜기(답 읽어 주기, 기본 켜짐) · 음성 모드

## 브라우저

Chrome, Edge, Safari 최신 버전. 음성 인식은 Chrome·Edge·Safari에서 되고 Firefox는 지원하지 않습니다(버튼이 비활성화됨).
