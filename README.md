# Saylo — 주문 챗봇

채팅·버튼·음성으로 배달 주문, 식당 예약, 쇼핑, 티켓 예매를 끝까지 진행하는 단일 페이지 챗봇입니다.
백엔드 없이 브라우저에서만 동작하는 정적 사이트이고, 결제와 매장·상품 데이터는 모두 화면 확인용 데모입니다.

- 기술: React 19, TypeScript, Vite, Vitest (테스트), oxlint (린트)
- 공개 도메인: sayloorder.com (도메인·호스팅 연결은 별도 담당자)

## 실행

Node 24 이상이 필요합니다.

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

| 명령 | 하는 일 |
|---|---|
| `npm run dev` | 개발 서버 (저장하면 바로 반영) |
| `npm test` | 테스트 전체 실행 |
| `npm run lint` | 린트 |
| `npm run build` | 타입 검사 후 배포용 빌드 → `frontend/dist/` |
| `npm run build:html` | 로고·영상까지 넣은 **HTML 한 파일** → 저장소 루트의 `saylo.html` (더블클릭으로 열림) |

### Docker로 띄우기 (저장소 루트에서)

```bash
docker compose up -d --build                  # http://localhost:8080
docker compose --profile tunnel up -d         # + 인터넷 임시 주소 (Cloudflare, 주소는 켤 때마다 바뀜)
docker compose logs tunnel | grep trycloudflare
docker compose --profile tunnel down          # 터널까지 모두 중지
```

## 배포

정적 사이트라 `npm run build`로 나온 `frontend/dist/` 폴더를 어떤 정적 호스팅(Vercel, Netlify, Cloudflare Pages, nginx 등)에 올리면 됩니다.

- 빌드 명령: `npm --prefix frontend run build` (저장소 루트 기준) 또는 `cd frontend && npm run build`
- 결과물: `frontend/dist`
- 클라이언트 라우팅이 없어서 별도 리라이트 설정은 필요 없습니다.
- `frontend/Dockerfile` + `deploy/nginx.conf`는 같은 결과물을 nginx 이미지로 만듭니다 (빌드 컨텍스트는 저장소 루트).
- 음성 인식은 HTTPS(또는 localhost)에서만 마이크가 열립니다.

## 폴더 구조

```
frontend/
  src/
    components/
      OrderChatbot.tsx        채팅 화면과 대화 흐름(단계) 전체
      orderChatKnowledge.ts   배달 메뉴·식당·예약 규칙, 문장 해석(수량·날짜·시간·결제수단), 주문서 모델
      shoppingKnowledge.ts    쇼핑: 종류·상품·사이즈·배송지·배송비
      ticketKnowledge.ts      예매: 종류·작품·회차·좌석
      quickMenu.ts            입력창 + 버튼으로 여는 빠른 메뉴 (배달·식당·쇼핑·예매)
      PaymentSheet.tsx        결제 팝업 (신용카드·카카오페이·토스페이, 데모)
      CalendarPicker.tsx      날짜 달력
      TimePicker.tsx, Wheel.tsx   오전/오후·시·분 휠
      CountPicker.tsx         −/+ 수량·인원 카운터
      Select.tsx              결제 팝업 드롭다운
      useSpeech.ts            음성 입력(말 → 글자)과 읽어 주기(글자 → 말)
      *.test.ts(x)            같은 이름 파일의 테스트
    index.css                 스타일 전체 (평면 디자인, 브랜드 파란색 #007cfc)
    image/                    로고, 배경 영상
  scripts/build-html.mjs      HTML 한 파일 만들기
  Dockerfile
deploy/nginx.conf             nginx 설정
docker-compose.yml            로컬 Docker (+ 터널)
```

## 자주 바꾸는 것

- 매장·메뉴·가격, 식당 목록, 상품, 작품: 각 `*Knowledge.ts`의 배열을 고치면 화면에 바로 반영됩니다.
- 배달지 기본 주소: `orderChatKnowledge.ts`의 `ADDRESS`
- 색·여백: `index.css` 맨 위의 CSS 변수

## 대화 흐름 요약

- 배달: 메뉴 → 수량 → 주문서 확인 → 결제수단 → 결제 팝업 → 주문번호
- 식당: 음식 종류 → 근처 식당 → 날짜 → 시간 → 인원 → 예약 확인 → 예약번호
- 쇼핑: 종류 → 상품 → (사이즈) → 수량 → 배송지 확인 → 주문서 → 결제
- 예매: 종류 → 작품 → 날짜 → 회차 → 매수 → 예매 확인 → 결제 → 좌석
- 어느 단계든 "취소"라고 하면 그만두고, 헤더의 마이크로 말해서 진행할 수 있습니다.

## 브라우저

Chrome, Edge, Safari 최신 버전. 음성 인식은 Chrome·Edge·Safari에서 되고 Firefox는 지원하지 않습니다(버튼이 비활성화됨).
