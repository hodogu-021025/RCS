# Saylo — 주문 챗봇

채팅·버튼·음성으로 배달 주문과 식당 예약을 끝까지 진행하는 소비자 챗봇에, 로그인으로 나뉘는 사장님·관리자 페이지가 붙어 있습니다.
모바일 기준 웹이라 소비자·사장님·관리자 화면 모두 휴대폰 폭(최대 440px)으로 그리고, PC에서는 가운데 휴대폰 크기 카드로 띄웁니다.

결제·매장 데이터와 로그인 계정은 모두 화면 확인용 데모입니다(회원가입 이메일 인증만 `server/` API 서버를 씁니다).

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

회원가입으로 고객님·사장님 계정을 만들 수 있고, 관리자 페이지에서도 사장님 계정을 만들 수 있습니다. 관리자는 가입이 없고 기본 계정만 있습니다.

기본 계정 (비밀번호는 모두 `1234`, 로그인 화면에 직접 입력): 고객님 `user`, 사장님 `owner`(청전 치킨공방), 관리자 `admin`.

주문·예약 내역, 사장님이 바꾼 매장 설정, 추가한 계정은 **브라우저(localStorage)** 에 저장됩니다. 같은 브라우저 안에서는 소비자가 주문하면 사장님 화면에 바로 뜨지만, 다른 기기와는 공유되지 않습니다(서버를 붙이면 `src/data/db.ts` 하나만 API 호출로 바꾸면 됩니다). 처음 열면 보기용 기록이 몇 건 들어가고, 지우려면 브라우저 저장소를 비우면 됩니다.

## 실행

Node 24 이상이 필요합니다. 화면(frontend)과 이메일 인증 API(server)를 각각 띄웁니다.

```bash
cp .env.example .env     # 처음 한 번: RESEND_API_KEY 를 채운다 (아래 "이메일 인증" 참고)
npm --prefix server run dev        # API     http://localhost:3001
cd frontend && npm install && npm run dev   # 화면 http://localhost:5173 (/api 는 3001 로 넘어감)
```

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

화면은 `npm run build`로 나온 `frontend/dist/` 정적 파일이고, 회원가입 이메일 인증에는 `server/` API 서버가 함께 있어야 합니다. 가장 간단한 방법은 `docker compose up -d --build` 그대로 서버에 올리는 것입니다 (화면과 API 가 같은 주소에서 동작).

- 정적 호스팅(Vercel 등)에 화면만 올리면 회원가입의 인증번호 받기가 동작하지 않습니다. 그때는 API 서버를 따로 띄우고 그 호스팅에서 `/api/*` 를 API 서버로 넘기도록 설정해야 합니다.
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
    auth/auth.ts              데모 로그인·회원가입(계정·세션)
    data/db.ts                주문·예약·매장 설정·계정 저장소 (localStorage)
    data/seed.ts              처음 열 때 넣는 보기용 기록
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
  index.mjs                   API 서버 (/api/email/send-code, /api/email/verify), Resend 로 메일 발송
  verification.mjs            인증번호 만들기·확인·재발송 제한
  verification.test.mjs       서버 테스트 (node --test)
  Dockerfile
deploy/nginx.conf             nginx 설정 (/api/ → API 서버)
docker-compose.yml            로컬 Docker: 화면 + API (+ 터널)
.env.example                  Resend 설정 예시 (.env 로 복사해서 사용)
```

## 자주 바꾸는 것

- 매장·메뉴·가격, 식당 목록: `orderChatKnowledge.ts`의 배열을 고치면 화면에 바로 반영됩니다.
- 배달지 기본 주소: `orderChatKnowledge.ts`의 `ADDRESS`
- 기본 계정: `auth/auth.ts`의 `DEMO_ACCOUNTS` (가입한 계정은 `data/db.ts`의 `users`·`owners`)
- 색·여백: `index.css` 맨 위의 CSS 변수

## 대화 흐름 요약

- 배달: 메뉴 → 수량 → 주문서 확인 → 결제수단 → 결제 팝업 → 주문번호
- 식당: 음식 종류 → 근처 식당 → 날짜 → 시간 → 인원 → 예약 확인 → 예약번호
- 어느 단계든 "취소"라고 하면 그만두고, 헤더의 음성 모드(마이크)로 말해서 진행할 수 있습니다.
- 헤더 버튼: 계정 · 채팅창 끄기/켜기(말풍선 숨김, 배경 구체만 남음) · 소리 끄기/켜기(답 읽어 주기, 기본 켜짐) · 음성 모드

## 브라우저

Chrome, Edge, Safari 최신 버전. 음성 인식은 Chrome·Edge·Safari에서 되고 Firefox는 지원하지 않습니다(버튼이 비활성화됨).
