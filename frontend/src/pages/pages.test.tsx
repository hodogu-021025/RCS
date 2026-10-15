import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { login, logout } from "../auth/auth";
import { getToken } from "../api/client";
import { deliveryMenu, makeOrder } from "../components/orderChatKnowledge";
import { getDb, refresh } from "../data/db";
import { server, TEST_BANK, TEST_CODE } from "../test/setup";
import { formatDateTime } from "./format";

// 실제 앱은 화면을 그 화면에 갈 때 받지만(routes.ts 의 lazy), 테스트에서는 바로 받아 동기로 그린다
vi.mock("./routes", async () => {
  const [login, signup, me, owner, admin, privacy, account, reset, app, inquiry] = await Promise.all([
    import("./LoginPage"),
    import("./SignupPage"),
    import("./MyOrdersPage"),
    import("./OwnerPage"),
    import("./AdminPage"),
    import("./PrivacyPage"),
    import("./AccountPage"),
    import("./ResetPasswordPage"),
    import("./AppDownloadPage"),
    import("./InquiryPage"),
  ]);
  return {
    LoginPage: login.LoginPage,
    SignupPage: signup.SignupPage,
    MyOrdersPage: me.MyOrdersPage,
    OwnerPage: owner.OwnerPage,
    AdminPage: admin.AdminPage,
    PrivacyPage: privacy.PrivacyPage,
    AccountPage: account.AccountPage,
    ResetPasswordPage: reset.ResetPasswordPage,
    AppDownloadPage: app.AppDownloadPage,
    InquiryPage: inquiry.InquiryPage,
  };
});

// App 은 해시 주소(#/owner)로 페이지를 고른다
function open(path: string) {
  window.location.hash = path;
  return render(<App />);
}

const chicken = deliveryMenu().find((d) => d.name === "간장치킨")!;
const tongdak = deliveryMenu().find((d) => d.name === "옛날통닭")!;
const loginAs = async (username: string) => {
  const r = await login(username, "password1");
  if ("error" in r) throw new Error(r.error);
};
// 테스트 서버의 DB 에 기록을 바로 넣는다
// status: 실제 주문은 "입금 대기"로 들어온다. 입금 확인 뒤의 화면을 보는 테스트가 많아 기본은 "접수"
const seedOrder = (customer: { username: string; name: string }, item = chicken, qty = 1, status = "접수") =>
  server.db.addOrder({ customer: customer.username, customerName: customer.name, payment: "계좌이체", storeId: item.restaurantId, order: makeOrder(item, qty, TEST_DELIVERY), status });
const TEST_DELIVERY = { address: "제천시 장락동 제천빌라 331호", phone: "010-1234-5678" };
const GUEST = { username: "guest", name: "비회원" };
const KIM = { username: "customer01", name: "김소비" };

// 로그인 화면: 아이디·비밀번호를 넣고 로그인 버튼
function typeLogin(username: string, password: string) {
  fireEvent.change(screen.getByLabelText("아이디"), { target: { value: username } });
  fireEvent.change(screen.getByLabelText("비밀번호"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "로그인" }));
}
const fill = (fields: Record<string, string>) => {
  for (const [label, value] of Object.entries(fields)) fireEvent.change(screen.getByLabelText(label), { target: { value } });
};
const click = (name: string | RegExp) => act(async () => void fireEvent.click(screen.getByRole("button", { name })));
// 드롭다운(Select.tsx): 라벨로 찾아 펼치고 항목을 누른다
const choose = (label: string, option: string) => {
  const root = screen.getByText(label, { selector: ".select-label" }).closest<HTMLElement>(".select")!;
  fireEvent.click(within(root).getByRole("button"));
  fireEvent.click(within(root).getByRole("option", { name: option }));
};

afterEach(() => {
  vi.useRealTimers();
  window.location.hash = "";
});

describe("첫 화면과 로그인", () => {
  it("주소 없이 열면 로그인 화면이 나오고, 로고·회원가입·'로그인 없이 챗봇 쓰기' 링크가 있다", () => {
    open("");
    expect(window.location.hash).toBe("#/login");
    expect(screen.getByRole("heading", { name: "로그인" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Saylo" })).toHaveAttribute("href", "#/login");
    expect(screen.getByRole("link", { name: "회원가입" })).toHaveAttribute("href", "#/signup");
    expect(screen.getByRole("link", { name: "로그인 없이 챗봇 쓰기" })).toHaveAttribute("href", "#/chat");
    expect(screen.queryByText(/데모 계정/)).not.toBeInTheDocument();
  });

  it("틀리면 서버의 안내가 뜨고, 고객님으로 맞게 로그인하면 챗봇으로 간다", async () => {
    server.createAccount({ ...KIM, email: "kim@example.com" });
    open("#/login");
    typeLogin("customer01", "wrong1234");
    expect(await screen.findByRole("alert")).toHaveTextContent("맞지 않아요");

    fireEvent.change(screen.getByLabelText("비밀번호"), { target: { value: "password1" } });
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));
    await waitFor(() => expect(window.location.hash).toBe("#/chat"));
    expect(await screen.findByRole("button", { name: "Say 전송" })).toBeInTheDocument();
    expect(localStorage.getItem("saylo.token")).toBeTruthy();
  });

  it("사장님으로 로그인하면 내 매장 사장님 페이지로 가고, 새로고침해도 로그인이 유지된다", async () => {
    server.createAccount({ username: "chickenboss", name: "치킨 사장", role: "owner", storeId: "h3" });
    const first = open("#/login");
    typeLogin("chickenboss", "password1");
    await waitFor(() => expect(window.location.hash).toBe("#/owner"));
    expect(await screen.findByText("청전 치킨공방 사장님")).toBeInTheDocument();

    // 새로고침: 토큰은 남아 있고 세션은 서버에 다시 물어본다
    first.unmount();
    const { restoreSession } = await import("../auth/auth");
    await restoreSession();
    open("#/owner");
    expect(await screen.findByText("청전 치킨공방 사장님")).toBeInTheDocument();
  });

  it("로그인 없이 사장님·관리자 페이지에 가면 로그인 페이지로 보내고, 역할이 다르면 안내만 보여 준다", async () => {
    open("#/admin");
    expect(window.location.hash).toBe("#/login");

    server.createAccount({ ...KIM });
    await loginAs("customer01");
    window.location.hash = "#/owner";
    expect(await screen.findByText(/사장님 전용이에요/)).toBeInTheDocument();
  });

  it("관리자가 지운 사장님 계정은 다음 요청 때 로그아웃되어 로그인 페이지로 간다", async () => {
    server.createAccount({ username: "jangrakboss", name: "장락반점 사장님", role: "owner", storeId: "c1" });
    await loginAs("jangrakboss");
    open("#/owner");
    expect(await screen.findByText("장락반점 사장님")).toBeInTheDocument();

    server.db.deleteUser("jangrakboss"); // 세션도 같이 지워진다
    await act(() => refresh(["records"])); // 화면이 몇 초마다 하는 새로 받기
    expect(await screen.findByRole("heading", { name: "로그인" })).toBeInTheDocument();
    expect(localStorage.getItem("saylo.token")).toBeNull();
  });
});

describe("회원가입", () => {
  const consentBox = () => screen.getByRole("checkbox", { name: /개인정보 수집·이용에 동의합니다/ });
  const agree = () => fireEvent.click(consentBox());

  async function verifyEmail(email: string) {
    fill({ 이메일: email });
    await click("인증번호 받기");
    await screen.findByLabelText("인증번호");
    fill({ 인증번호: TEST_CODE });
    await click("확인");
    await screen.findByText("인증 완료");
  }

  it("고객님으로 가입하면 서버에 계정이 생기고 바로 로그인돼 챗봇으로 간다", async () => {
    open("#/signup");
    expect(screen.queryByLabelText("매장")).not.toBeInTheDocument();
    fill({ 아이디: "hongildong", 이름: "홍길동", "휴대폰 번호": "01012345678", 비밀번호: "password1", "비밀번호 확인": "password1" });
    agree();
    await verifyEmail("Hong@Example.com");
    await click("가입하기");

    await waitFor(() => expect(window.location.hash).toBe("#/chat"));
    // 숫자만 적어도 하이픈을 넣은 모양으로 저장된다
    expect(server.db.findUser("hongildong")).toMatchObject({ role: "user", phone: "010-1234-5678" });
    expect(server.sent).toEqual([{ email: "hong@example.com", code: TEST_CODE }]);
  });

  it("휴대폰 번호는 적는 동안 하이픈이 들어가고, 번호 모양이 아니면 가입되지 않는다", async () => {
    open("#/signup");
    const phone = screen.getByLabelText("휴대폰 번호");
    fill({ "휴대폰 번호": "010-12ab34" });
    expect(phone).toHaveValue("010-1234");
    fill({ "휴대폰 번호": "0101234567899" });
    expect(phone).toHaveValue("010-1234-5678"); // 11자리 뒤는 버린다
    fill({ "휴대폰 번호": "021234567" });
    expect(phone).toHaveValue("02-123-4567");

    fill({ 아이디: "hongildong", 이름: "홍길동", "휴대폰 번호": "0101234", 비밀번호: "password1", "비밀번호 확인": "password1" });
    fireEvent.blur(phone);
    expect(phone).toHaveAttribute("aria-invalid", "true");
    agree();
    await verifyEmail("hong@example.com");
    await click("가입하기");
    expect(await screen.findByRole("alert")).toHaveTextContent("010-1234-5678 형식");
    expect(server.db.findUser("hongildong")).toBeNull();
  });

  it("회원가입은 고객님만 하고, 사장님 계정은 관리자가 만든다고 안내한다", () => {
    open("#/signup");
    expect(screen.getByText(/사장님 계정은 관리자가 만들어 드려요/)).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.queryByText("매장")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "가입하기" })).toBeInTheDocument();
  });

  it("예전에 직접 가입해 승인을 기다리는 사장님은 대기 안내를 보다가, 승인되면 매장 화면이 열린다", async () => {
    server.createAccount({ username: "banjeom01", name: "김사장", role: "owner", storeId: "c1", approved: false });
    await loginAs("banjeom01");
    open("#/owner");
    expect(await screen.findByText("장락반점 사장님")).toBeInTheDocument();
    expect(screen.getByText("관리자 승인을 기다리고 있어요")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /주문·예약/ })).not.toBeInTheDocument();

    // 관리자가 승인한 뒤 "승인됐는지 확인"을 누르면 매장 화면이 열린다
    (server.db as unknown as { approveOwner(u: string): boolean }).approveOwner("banjeom01");
    await click("승인됐는지 확인");
    expect(await screen.findByRole("tab", { name: /주문·예약/ })).toBeInTheDocument();
  });

  it("이메일 인증: 번호를 받으면 5분 타이머가 돌고, 틀리면 안내, 맞으면 인증 완료, 변경하면 다시 인증", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    open("#/signup");
    fill({ 아이디: "hongildong", 이름: "홍길동", "휴대폰 번호": "01012345678", 비밀번호: "password1", "비밀번호 확인": "password1" });
    await click("가입하기");
    expect(await screen.findByRole("alert")).toHaveTextContent("이메일 인증을 마쳐 주세요");

    fill({ 이메일: "hong@example.com" });
    await click("인증번호 받기");
    expect(await screen.findByText("5:00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 받기 60초" })).toBeDisabled();
    // 화면이 그려진 뒤 1초 타이머가 걸릴 때까지 기다렸다가 시간을 넘긴다 (먼저 넘기면 타이머가 한 번도 안 돌아 5:00 그대로다)
    await act(async () => {});
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    // 시계가 실제 시간과 같이 흐르는 설정이라 몇 초 차이는 둔다
    await waitFor(() => expect(screen.getByLabelText("남은 시간")).toHaveTextContent(/^(4:00|3:5[0-9])$/));
    expect(screen.getByRole("button", { name: "다시 받기" })).toBeEnabled();

    fill({ 인증번호: "000000" });
    await click("확인");
    expect(await screen.findByText(/인증번호가 맞지 않아요/)).toBeInTheDocument();

    fill({ 인증번호: TEST_CODE });
    await click("확인");
    expect(await screen.findByText("인증 완료")).toBeInTheDocument();
    expect(screen.getByLabelText("이메일")).toHaveAttribute("readonly");

    fireEvent.click(screen.getByRole("button", { name: "변경" }));
    expect(screen.getByLabelText("이메일")).not.toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "인증번호 받기" })).toBeInTheDocument();
  });

  it("이미 가입된 이메일로는 인증번호를 보내지 않고, 아이디·비밀번호 규칙은 서버가 다시 거른다", async () => {
    server.createAccount({ username: "takenuser", email: "taken@example.com" });
    open("#/signup");
    fill({ 이메일: "TAKEN@example.com" });
    await click("인증번호 받기");
    expect(await screen.findByText("이미 가입된 이메일이에요.")).toBeInTheDocument();
    expect(server.sent).toEqual([]);

    fill({ 아이디: "short", 이름: "누구", "휴대폰 번호": "01012345678", 비밀번호: "password1", "비밀번호 확인": "password1" });
    agree();
    await verifyEmail("new@example.com");
    await click("가입하기");
    expect(await screen.findByRole("alert")).toHaveTextContent("영문·숫자 6~20자");
    fill({ 아이디: "takenuser" });
    await click("가입하기"); // 이번엔 서버가 거른다 (안내가 바뀔 때까지 기다린다)
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("이미 있는 아이디예요"));
    expect(server.db.findUser("short")).toBeNull();
  });

  it("개인정보 수집·이용에 동의해야 가입되고, 요약과 전체 방침(새 탭)을 볼 수 있다", async () => {
    open("#/signup");
    expect(consentBox()).not.toBeChecked();
    fill({ 아이디: "hongildong", 이름: "홍길동", "휴대폰 번호": "01012345678", 비밀번호: "password1", "비밀번호 확인": "password1" });
    await verifyEmail("hong@example.com");
    await click("가입하기");
    expect(await screen.findByRole("alert")).toHaveTextContent("개인정보 수집·이용에 동의해 주세요");
    expect(server.db.findUser("hongildong")).toBeNull();

    fireEvent.click(screen.getByText("내용 보기"));
    expect(screen.getByText("수집 항목")).toBeInTheDocument();
    expect(screen.getByText(/동의하지 않으면 회원가입을 할 수 없어요/)).toBeInTheDocument();
    const full = screen.getByRole("link", { name: "개인정보 처리방침 전체 보기" });
    expect(full).toHaveAttribute("href", "#/privacy");
    expect(full).toHaveAttribute("target", "_blank");

    agree();
    await click("가입하기");
    await waitFor(() => expect(window.location.hash).toBe("#/chat"));
  });

  it("비밀번호 눈 버튼", () => {
    open("#/signup");
    const pw = screen.getByLabelText("비밀번호");
    expect(pw).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "비밀번호 보기" }));
    expect(pw).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("비밀번호 확인")).toHaveAttribute("type", "password"); // 칸마다 따로
  });
});

describe("로고와 첫 화면", () => {
  it("사장님은 로고가 사장님 화면으로 가고, 챗봇 주소로 들어와도 사장님 화면으로 돌아간다", async () => {
    server.createAccount({ username: "chickenboss", name: "치킨 사장", role: "owner", storeId: "h3" });
    await loginAs("chickenboss");
    open("#/owner");
    expect(await screen.findByRole("link", { name: "내 첫 화면으로" })).toHaveAttribute("href", "#/owner");
    cleanup();
    open("#/chat");
    await waitFor(() => expect(window.location.hash).toBe("#/owner"));
  });

  it("관리자는 로고가 관리자 화면으로 가고, 챗봇의 계정 버튼도 관리자 화면으로 간다", async () => {
    server.createAccount({ username: "adminuser", name: "관리자", role: "admin" });
    await loginAs("adminuser");
    open("#/admin");
    expect(await screen.findByRole("link", { name: "내 첫 화면으로" })).toHaveAttribute("href", "#/admin");
    cleanup();
    open("#/chat");
    expect(await screen.findByRole("link", { name: "관리자 · 관리자 화면" })).toHaveAttribute("href", "#/admin");
  });

  it("고객님은 로고가 챗봇으로 간다", async () => {
    server.createAccount({ ...KIM });
    await loginAs(KIM.username);
    open("#/me");
    expect(await screen.findByRole("link", { name: "챗봇으로" })).toHaveAttribute("href", "#/chat");
  });
});

describe("사장님 페이지", () => {
  const boss = { username: "chickenboss", name: "치킨 사장", role: "owner" as const, storeId: "h3" };

  it("내 매장 주문만 보이고, 입금 확인 → 준비 중 → 완료로 바꾸면 서버에 저장된다", async () => {
    server.createAccount(boss);
    server.createAccount({ ...KIM });
    const mine = seedOrder(KIM, chicken, 2, "입금 대기");
    seedOrder(GUEST, tongdak, 1); // 다른 매장(h1)
    await loginAs("chickenboss");
    open("#/owner");

    expect(await screen.findByText("간장치킨 2마리")).toBeInTheDocument();
    // 손님 연락처가 보이고, 누르면 전화를 건다
    expect(screen.getByRole("link", { name: "010-1234-5678" })).toHaveAttribute("href", "tel:01012345678");
    expect(screen.queryByText(/옛날통닭/)).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /주문·예약/ })).toHaveTextContent("1"); // 손쓸 주문 배지
    expect(screen.getByText("입금 대기", { selector: ".status" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "준비 시작" })).not.toBeInTheDocument(); // 입금 확인 전에는 준비를 시작하지 않는다

    await click("입금 확인");
    await waitFor(() => expect(server.db.orderById(mine.id)?.status).toBe("접수"));
    await click("준비 시작");
    await waitFor(() => expect(server.db.orderById(mine.id)?.status).toBe("준비 중"));
    await click("배달 완료");
    await waitFor(() => expect(server.db.orderById(mine.id)?.status).toBe("완료"));
    await waitFor(() => expect(screen.getByText("완료", { selector: ".status" })).toBeInTheDocument());
  });

  it("다른 기기에서 새 주문이 들어오면 몇 초 안에 알림이 뜬다 (처음 열 때 있던 주문은 아니다)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.createAccount(boss);
    seedOrder(GUEST, chicken, 3); // 열기 전부터 있던 주문
    await loginAs("chickenboss");
    open("#/owner");
    expect(await screen.findByText("간장치킨 3마리")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    seedOrder(GUEST, chicken, 1, "입금 대기"); // 손님 폰에서 주문이 들어온 것과 같다
    act(() => void vi.advanceTimersByTime(5000)); // 화면이 몇 초마다 새로 받는다
    expect(await screen.findByRole("status")).toHaveTextContent("새 주문: 간장치킨 1마리");
    expect(screen.getByRole("status")).toHaveTextContent("입금을 확인해 주세요");
  });

  it("메뉴 탭에서 품절·가격을, 매장 탭에서 영업시간을 바꾸면 서버에 저장된다", async () => {
    server.createAccount(boss);
    await loginAs("chickenboss");
    open("#/owner");
    fireEvent.click(await screen.findByRole("tab", { name: "메뉴" }));

    const soldOut = screen.getByRole("button", { name: "간장치킨 품절" });
    expect(soldOut).toHaveAttribute("aria-pressed", "false");
    await act(async () => void fireEvent.click(soldOut));
    await waitFor(() => expect(server.db.allStoreSettings().h3?.items.d2?.soldOut).toBe(true));
    // 켜진 품절 버튼은 눌린 상태로 보이고, 다시 누르면 풀린다
    await waitFor(() => expect(screen.getByRole("button", { name: "간장치킨 품절" })).toHaveAttribute("aria-pressed", "true"));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "간장치킨 품절" })));
    await waitFor(() => expect(server.db.allStoreSettings().h3?.items.d2?.soldOut).toBe(false));
    const price = screen.getByRole("spinbutton", { name: "간장치킨 가격" });
    expect(screen.getByLabelText("간장치킨 판매가")).toHaveValue("20,000원");
    fireEvent.change(price, { target: { value: "23000" } });
    // 판매가는 칸을 벗어나기 전에도 적는 대로 바뀐다
    expect(screen.getByLabelText("간장치킨 판매가")).toHaveValue("23,000원");
    fireEvent.blur(price);
    await waitFor(() => expect(server.db.allStoreSettings().h3?.items.d2?.price).toBe(23000));
    fireEvent.click(screen.getByRole("tab", { name: "매장" }));
    fireEvent.change(screen.getByLabelText("닫는 시간"), { target: { value: "23:00" } });
    await waitFor(() => expect(server.db.allStoreSettings().h3?.hours).toBe("16:00 - 23:00"));
  });

  it("메뉴 탭에서 메뉴를 추가하면 바로 판매되고, 판매 중지하면 아래로 내려가 다시 판매할 수 있다", async () => {
    server.createAccount(boss);
    await loginAs("chickenboss");
    open("#/owner");
    fireEvent.click(await screen.findByRole("tab", { name: "메뉴" }));
    fireEvent.click(screen.getByRole("tab", { name: "메뉴 추가" }));

    // 화면에서 먼저 거르는 입력
    fill({ "메뉴 이름": "양념치킨", "가격 (원)": "50" });
    await click("메뉴 추가");
    expect(await screen.findByRole("alert")).toHaveTextContent("가격은 100원부터");

    fill({ "메뉴 이름": "양념치킨", "가격 (원)": "21000", "손님이 부를 다른 이름 (선택, 쉼표로 구분)": "양념, 양념통닭" });
    await click("메뉴 추가");
    expect(await screen.findByRole("status")).toHaveTextContent("양념치킨 메뉴를 추가했어요");
    const added = (server.db as unknown as { listMenu(): { id: string; name: string; price: number; keywords: string[]; active: boolean }[] }).listMenu().find((d) => d.name === "양념치킨")!;
    expect(added).toMatchObject({ price: 21000, active: true });
    expect(added.keywords).toEqual(["양념", "양념통닭", "치킨"]);
    // 세부 메뉴: 판매 중 → 판매 중지 → 판매 중
    fireEvent.click(screen.getByRole("tab", { name: "판매 중" }));
    expect(await screen.findByRole("spinbutton", { name: "양념치킨 가격" })).toHaveValue(21000);

    await click("양념치킨 판매 중지");
    await waitFor(() => expect(screen.queryByRole("spinbutton", { name: "양념치킨 가격" })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: "판매 중지" }));
    expect(await screen.findByText("판매 중지한 메뉴 (1)")).toBeInTheDocument();
    await click("양념치킨 다시 판매");
    expect(await screen.findByText("판매 중지한 메뉴 (0)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "판매 중" }));
    expect(await screen.findByRole("spinbutton", { name: "양념치킨 가격" })).toBeInTheDocument();
    // 목록 제목만 찾는다 (안내 문장에도 "판매 중지한 메뉴"가 들어 있다)
    expect(screen.queryByText(/^판매 중지한 메뉴 \(\d+\)$/)).not.toBeInTheDocument();
  });

  it("메뉴 탭에서 오늘의 메뉴를 고르고 메뉴별 할인율을 정하면 서버에 저장된다", async () => {
    server.createAccount(boss);
    await loginAs("chickenboss");
    open("#/owner");
    fireEvent.click(await screen.findByRole("tab", { name: "메뉴" }));

    choose("오늘의 메뉴", "간장치킨");
    await waitFor(() => expect(server.db.allStoreSettings().h3 as unknown as { special?: { itemId: string } }).toMatchObject({ special: { itemId: "d2" } }));
    expect(await screen.findByText("오늘의 메뉴", { selector: ".badge-special" })).toBeInTheDocument();

    const pct = screen.getByRole("spinbutton", { name: "간장치킨 할인율" });
    fireEvent.change(pct, { target: { value: "95" } });
    fireEvent.blur(pct);
    expect(await screen.findByRole("alert")).toHaveTextContent("할인율은 0~90%");
    fireEvent.change(pct, { target: { value: "25" } });
    expect(screen.getByLabelText("간장치킨 판매가")).toHaveValue("15,000원"); // 저장 전에도 할인을 반영해 보여 준다
    fireEvent.blur(pct);
    await waitFor(() => expect(server.db.allStoreSettings().h3?.items.d2 as { discountPct?: number }).toMatchObject({ discountPct: 25 }));
    await waitFor(() => expect(screen.getByLabelText("간장치킨 판매가")).toHaveValue("15,000원"));
    expect(screen.getByLabelText("간장치킨 판매가")).toHaveClass("discounted");

    choose("오늘의 메뉴", "없음");
    await waitFor(() => expect((server.db.allStoreSettings().h3 as unknown as { special?: unknown }).special).toBeUndefined());
  });

  it("예약은 방문 완료로 바꿀 수 있고, 자정(24:00)에 닫는 매장은 닫는 시간이 00:00 으로 보인다", async () => {
    server.createAccount({ username: "tongdakboss", name: "옛날통닭 사장님", role: "owner", storeId: "h1" }); // 15:00 - 24:00
    const rsv = server.db.addReservation({ ...GUEST, customer: "guest", customerName: "비회원", restaurantId: "h1", restaurantName: "장락 옛날통닭", date: "2026-10-10", time: "19:00", people: 3 });
    await loginAs("tongdakboss");
    open("#/owner");
    fireEvent.click(await screen.findByRole("tab", { name: "식당 예약" }));
    expect(await screen.findByText(/10월 10일 \(토\) 19:00/)).toBeInTheDocument();
    await click("방문 완료");
    await waitFor(() => expect(server.db.reservationById(rsv.id)?.status).toBe("방문 완료"));

    fireEvent.click(screen.getByRole("tab", { name: "매장" }));
    expect(screen.getByLabelText("여는 시간")).toHaveValue("15:00");
    expect(screen.getByLabelText("닫는 시간")).toHaveValue("00:00");
  });
});

describe("세트 메뉴 맛 고르기 (사장님 화면)", () => {
  const boss = { username: "chickenboss", name: "치킨 사장", role: "owner" as const, storeId: "h3" };
  type Choice = { label: string; count: number; options: { name: string; extra: number }[] };
  type MenuRow = { id: string; name: string; restaurantId: string; choice?: Choice };
  const menuRows = () => (server.db as unknown as { listMenu(): MenuRow[] }).listMenu();
  const openMenuTab = async () => {
    server.createAccount(boss);
    await loginAs("chickenboss");
    open("#/owner");
    fireEvent.click(await screen.findByRole("tab", { name: "메뉴" }));
  };

  it("메뉴 추가에서 세트 메뉴를 켜고 맛 이름·추가금 줄을 넣고 빼면, 맛 고르기가 붙은 메뉴로 저장된다", async () => {
    await openMenuTab();
    fireEvent.click(screen.getByRole("tab", { name: "메뉴 추가" }));
    fill({ "메뉴 이름": "2마리 치킨 세트", "가격 (원)": "26000" });
    choose("단위", "세트");
    expect(screen.queryByRole("group", { name: "맛 고르기 편집" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /세트 메뉴예요/ }));
    expect(screen.getByRole("group", { name: "맛 고르기 편집" })).toBeInTheDocument();
    expect(screen.getByLabelText("1세트에 고를 수")).toHaveValue(2);

    // 빈 줄 두 개로 시작한다. 하나만 적으면 고를 수(2가지)보다 적어 화면에서 먼저 거른다
    fill({ "맛 1 이름": "간장 파닭" });
    await click("메뉴 추가");
    expect(await screen.findByRole("alert")).toHaveTextContent("맛을 고를 수(2가지)만큼은 적어 주세요.");
    // 같은 이름은 안 된다
    fill({ "맛 2 이름": "간장 파닭" });
    await click("메뉴 추가");
    expect(await screen.findByRole("alert")).toHaveTextContent("같은 맛 이름이 두 번 있어요.");
    fill({ "맛 2 이름": "양념 파닭" });

    // 한 줄 추가 → 추가금 적기, 그리고 한 줄 빼기
    fireEvent.click(screen.getByRole("button", { name: "맛 한 줄 추가" }));
    fill({ "맛 3 이름": "블랙스완 파닭", "맛 3 추가금": "1000" });
    fireEvent.click(screen.getByRole("button", { name: "맛 한 줄 추가" }));
    fill({ "맛 4 이름": "뺄 맛" });
    fireEvent.click(screen.getByRole("button", { name: "맛 4 빼기" }));
    expect(screen.queryByLabelText("맛 4 이름")).not.toBeInTheDocument();

    // 여러 개 한 번에 넣기: 쉼표·줄바꿈, 이름 뒤 +금액은 추가금. 이미 있는 이름은 건너뛴다
    fireEvent.change(screen.getByLabelText("맛 여러 개 한 번에 넣기"), { target: { value: "굽는 불닭 +2,000\n간장 파닭, 핫간장 파닭" } });
    fireEvent.click(screen.getByRole("button", { name: "목록에 넣기" }));
    expect(screen.getByLabelText("맛 4 이름")).toHaveValue("굽는 불닭");
    expect(screen.getByLabelText("맛 4 추가금")).toHaveValue(2000);
    expect(screen.getByLabelText("맛 5 이름")).toHaveValue("핫간장 파닭");
    expect(screen.queryByLabelText("맛 6 이름")).not.toBeInTheDocument();

    await click("메뉴 추가");
    expect(await screen.findByRole("status")).toHaveTextContent("2마리 치킨 세트 메뉴를 추가했어요");
    const added = menuRows().find((d) => d.name === "2마리 치킨 세트")!;
    expect(added.choice).toEqual({
      label: "맛",
      count: 2,
      options: [
        { name: "간장 파닭", extra: 0 },
        { name: "양념 파닭", extra: 0 },
        { name: "블랙스완 파닭", extra: 1000 },
        { name: "굽는 불닭", extra: 2000 },
        { name: "핫간장 파닭", extra: 0 },
      ],
    });
    // 폼은 비워지고 맛 고르기 칸도 닫힌다
    expect(screen.queryByRole("group", { name: "맛 고르기 편집" })).not.toBeInTheDocument();

    // 판매 중 카드에 한 줄 요약이 보인다
    fireEvent.click(screen.getByRole("tab", { name: "판매 중" }));
    expect(await screen.findByText("맛 2가지 고르기 · 5가지 중")).toBeInTheDocument();
  });

  it("판매 중인 세트의 맛 목록을 고치고 없앨 수 있고, 지난 주문에 남은 고른 맛은 그대로다", async () => {
    const set = server.db.addMenuItem({
      restaurantId: "h3", name: "2마리 치킨 세트", price: 26000, unit: "세트", keywords: ["세트"],
      choice: { label: "맛", count: 2, options: [{ name: "간장 파닭", extra: 0 }, { name: "양념 파닭", extra: 0 }, { name: "블랙스완 파닭", extra: 1000 }] },
    });
    const item = { ...chicken, id: set.id, name: "2마리 치킨 세트", price: 26000, unit: "세트" as typeof chicken.unit, keywords: [] };
    const old = server.db.addOrder({
      customer: KIM.username, customerName: KIM.name, payment: "계좌이체", storeId: "h3", status: "완료",
      order: makeOrder(item, 1, TEST_DELIVERY, [{ name: "간장 파닭", extra: 0 }, { name: "블랙스완 파닭", extra: 1000 }]),
    });
    await openMenuTab();
    expect(await screen.findByText("맛 2가지 고르기 · 3가지 중")).toBeInTheDocument();
    // 맛 고르기가 없는 메뉴는 "넣기"
    expect(screen.getByRole("button", { name: "간장치킨 맛 고르기 넣기" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "2마리 치킨 세트 맛 고르기 고치기" }));
    expect(screen.getByLabelText("맛 3 이름")).toHaveValue("블랙스완 파닭");
    expect(screen.getByLabelText("맛 3 추가금")).toHaveValue(1000);
    // 잘못 적으면 저장하지 않고 이유를 보여 준다
    fill({ "1세트에 고를 수": "11" });
    await click("2마리 치킨 세트 맛 고르기 저장");
    expect(await screen.findByRole("alert")).toHaveTextContent("1세트에 고를 수는 1~10 사이로 적어 주세요.");
    // 블랙스완을 빼고 새 맛을 넣어 3가지 고르기로
    fill({ "1세트에 고를 수": "3" });
    fireEvent.click(screen.getByRole("button", { name: "맛 3 빼기" }));
    fireEvent.click(screen.getByRole("button", { name: "맛 한 줄 추가" }));
    fill({ "맛 3 이름": "굽는 불닭", "맛 3 추가금": "2000" });
    await click("2마리 치킨 세트 맛 고르기 저장");
    await waitFor(() =>
      expect(menuRows().find((d) => d.id === set.id)?.choice).toEqual({ label: "맛", count: 3, options: [{ name: "간장 파닭", extra: 0 }, { name: "양념 파닭", extra: 0 }, { name: "굽는 불닭", extra: 2000 }] }),
    );
    expect(await screen.findByText("맛 3가지 고르기 · 3가지 중")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "맛 고르기 편집" })).not.toBeInTheDocument();

    // 없애면 보통 메뉴
    fireEvent.click(screen.getByRole("button", { name: "2마리 치킨 세트 맛 고르기 고치기" }));
    await click("2마리 치킨 세트 맛 고르기 없애기");
    await waitFor(() => expect(menuRows().find((d) => d.id === set.id)?.choice).toBeUndefined());
    expect(await screen.findByRole("button", { name: "2마리 치킨 세트 맛 고르기 넣기" })).toBeInTheDocument();

    // 지난 주문은 주문할 때의 맛 그대로
    const kept = server.db.orderById(old.id) as unknown as { order: { choices: { name: string; extra: number }[]; price: number } };
    expect(kept.order.choices).toEqual([{ name: "간장 파닭", extra: 0 }, { name: "블랙스완 파닭", extra: 1000 }]);
    expect(kept.order.price).toBe(27000);
    fireEvent.click(screen.getByRole("tab", { name: "주문·예약" }));
    expect(await screen.findByText("간장 파닭, 블랙스완 파닭(+1,000원)")).toBeInTheDocument();
  });

  it("사장님이 화면에서 넣은 맛 목록으로 챗봇이 맛 표를 띄운다", async () => {
    await openMenuTab();
    fireEvent.click(screen.getByRole("tab", { name: "메뉴 추가" }));
    fill({ "메뉴 이름": "2마리 치킨 세트", "가격 (원)": "26000" });
    choose("단위", "세트");
    fireEvent.click(screen.getByRole("checkbox", { name: /세트 메뉴예요/ }));
    fill({ "맛 1 이름": "간장 파닭", "맛 2 이름": "양념 파닭" });
    fireEvent.click(screen.getByRole("button", { name: "맛 한 줄 추가" }));
    fill({ "맛 3 이름": "블랙스완 파닭", "맛 3 추가금": "1000" });
    await click("메뉴 추가");
    expect(await screen.findByRole("status")).toHaveTextContent("메뉴를 추가했어요");
    cleanup();
    await act(async () => void (await logout()));

    server.createAccount({ ...KIM, ...TEST_DELIVERY });
    await loginAs(KIM.username);
    open("#/chat");
    await act(() => refresh(["settings", "popular", "menu"]));
    fireEvent.click(screen.getByRole("button", { name: "채팅창 켜기" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "2마리 치킨 세트 1세트" } });
    fireEvent.click(screen.getByRole("button", { name: "Say 전송" }));
    expect((await screen.findAllByText(/맛을 2가지 골라 주세요/, {}, { timeout: 3000 })).length).toBeGreaterThan(0);
    const picker = screen.getByRole("group", { name: "맛 고르기" });
    expect(within(picker).getByRole("button", { name: "블랙스완 파닭" })).toBeInTheDocument();
    expect(within(picker).getByText("1,000원 추가")).toBeInTheDocument();
  });
});

describe("관리자 페이지", () => {
  const admin = { username: "adminuser", name: "관리자", role: "admin" as const };

  it("모든 주문·예약이 카드로 보이고 종류로 거를 수 있다", async () => {
    server.createAccount(admin);
    seedOrder(GUEST);
    server.db.addReservation({ customer: "guest", customerName: "비회원", restaurantId: "c1", restaurantName: "장락반점", date: "2026-10-10", time: "12:00", people: 2 });
    await loginAs("adminuser");
    open("#/admin");

    const cards = () => document.querySelectorAll(".record-list .record");
    await waitFor(() => expect(cards()).toHaveLength(2));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    // 종류는 위 탭 아래 붙은 두 번째 탭 줄(세부 메뉴)로 거른다
    expect(screen.getByRole("tablist", { name: "세부 메뉴" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "식당 예약" }));
    expect(cards()).toHaveLength(1);
    expect(within(cards()[0] as HTMLElement).getByText("장락반점")).toBeInTheDocument();
    expect(document.querySelector(".dash")).toHaveClass("dash-mobile");
  });

  it("매장 정보를 입력해 새 매장과 그 사장님 계정을 함께 만들면 목록에 뜨고, 지우면 계정이 사라진다", async () => {
    server.createAccount(admin);
    server.db.updateStoreSettings("c1", { hours: "11:00 - 18:00" });
    await loginAs("adminuser");
    open("#/admin");
    fireEvent.click(await screen.findByRole("tab", { name: "매장·사장님" }));
    expect(await screen.findByText("11:00 - 18:00")).toBeInTheDocument(); // 사장님이 바꾼 영업시간이 보인다 (세부 메뉴는 매장 목록부터)
    expect(screen.queryByRole("button", { name: "계정 만들기" })).not.toBeInTheDocument();

    // 매장을 고르는 칸·이름 칸·대표 메뉴 칸 없이 매장 정보 입력칸이 바로 보인다
    fireEvent.click(screen.getByRole("tab", { name: "계정 만들기" }));
    expect(screen.getByLabelText("매장 이름")).toBeInTheDocument();
    expect(screen.queryByText("매장", { selector: ".select-label" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^이름/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/대표 메뉴/)).not.toBeInTheDocument();

    // 매장 이름·음식 종류가 비어 있으면 보내지 않는다
    fill({ 아이디: "newstoreboss", 비밀번호: "password1" });
    await click("계정 만들기");
    expect(await screen.findByRole("alert")).toHaveTextContent("매장 이름을 적어 주세요");
    fill({ "매장 이름": "  하소   닭강정 ", "주소 (선택)": "제천시 하소동 1-2" });
    await click("계정 만들기");
    expect(await screen.findByRole("alert")).toHaveTextContent("음식 종류를 골라 주세요");
    choose("음식 종류", "치킨");
    // 매장 전화번호도 꼭 적는다 (주문한 손님에게 가게 전화번호로 보인다)
    await click("계정 만들기");
    expect(await screen.findByRole("alert")).toHaveTextContent("매장 전화번호를 적어 주세요");
    fill({ "매장 전화번호": "12345" });
    await click("계정 만들기");
    expect(await screen.findByRole("alert")).toHaveTextContent("010-1234-5678 형식");
    fill({ "매장 전화번호": "0431234567" });
    await click("계정 만들기");
    expect(await screen.findByRole("status")).toHaveTextContent('newstoreboss 계정과 하소 닭강정 매장을 만들었어요. 사장님 이름은 "하소 닭강정 사장님"이에요.');
    const owner = server.db.findUser("newstoreboss")!;
    expect(owner).toMatchObject({ role: "owner", name: "하소 닭강정 사장님", phone: "043-123-4567" });
    expect(server.db.storeById(owner.storeId!)).toMatchObject({ name: "하소 닭강정", food: "chicken", hours: "11:00 - 21:00", address: "제천시 하소동 1-2" });
    // 입력칸은 비워진다
    expect(screen.getByLabelText("매장 이름")).toHaveValue("");

    // 이미 있는 아이디, 이미 있는 매장 이름(띄어쓰기 차이도 같은 이름)은 서버가 거절한다
    fill({ 아이디: "newstoreboss", 비밀번호: "password1", "매장 이름": "다른 가게", "매장 전화번호": "010-2222-3333" });
    choose("음식 종류", "한식");
    await click("계정 만들기");
    expect(await screen.findByRole("alert")).toHaveTextContent("이미 있는 아이디예요");
    fill({ 아이디: "newstoreboss2", "매장 이름": "청전치킨공방" });
    await click("계정 만들기");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("같은 이름의 매장이 이미 있어요"));

    fireEvent.click(screen.getByRole("tab", { name: "매장 목록" }));
    expect(await screen.findByText("newstoreboss (하소 닭강정 사장님)")).toBeInTheDocument();
    expect(screen.getByText("043-123-4567")).toBeInTheDocument(); // 매장 전화
    await click("newstoreboss 삭제");
    await waitFor(() => expect(server.db.findUser("newstoreboss")).toBeNull());
  });

  it("관리자가 만든 매장의 사장님은 사장님 화면에서 자기 매장을 본다 (주소·대표 메뉴가 없으면 그 줄을 뺀다)", async () => {
    const store = server.db.addStore({ name: "하소 닭강정", food: "chicken", hours: "12:00 - 22:00" });
    server.createAccount({ username: "newstoreboss", name: "닭강정 사장", role: "owner", storeId: store.id });
    await loginAs("newstoreboss");
    open("#/owner");
    expect(await screen.findByText("하소 닭강정 사장님")).toBeInTheDocument();
    expect(screen.queryByText("매장 정보를 찾을 수 없어요")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "매장" }));
    fireEvent.click(screen.getByRole("tab", { name: "매장 정보" }));
    expect(await screen.findByText("매장 이름")).toBeInTheDocument();
    expect(screen.queryByText("대표 메뉴", { selector: "dt" })).not.toBeInTheDocument();
    expect(screen.queryByText("주소", { selector: "dt" })).not.toBeInTheDocument();
  });

  it("통계 탭은 건수와 매출을, 사용자 탭은 가입한 고객님을 보여 준다", async () => {
    server.createAccount(admin);
    server.createAccount({ ...KIM, email: "kim@example.com", phone: "010-5555-6666" });
    seedOrder(KIM, chicken, 2);
    await loginAs("adminuser");
    open("#/admin");
    fireEvent.click(await screen.findByRole("tab", { name: "통계" }));
    expect(await screen.findByText("40,000원")).toBeInTheDocument();
    expect(screen.getAllByText("1건").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("tab", { name: "사용자" }));
    expect(await screen.findByText("kim@example.com")).toBeInTheDocument();
    expect(screen.getByText("010-5555-6666")).toBeInTheDocument(); // 가입 회원의 전화번호
    fireEvent.click(screen.getByRole("tab", { name: "이용 내역" }));
    expect(await screen.findByText("이용 내역 (1)")).toBeInTheDocument();
    expect(screen.queryByText("kim@example.com")).not.toBeInTheDocument(); // 세부 메뉴마다 한 화면씩
    expect(screen.getAllByText("customer01").length).toBeGreaterThan(0);
  });
});

describe("계좌이체 (사장님·관리자·내 주문)", () => {
  const boss = { username: "chickenboss", name: "치킨 사장", role: "owner" as const, storeId: "h3" };

  it("사장님은 매장 탭에서 입금 계좌를 바꾸고, 지우면 배달 주문을 받지 못한다는 띠가 뜬다", async () => {
    server.createAccount(boss);
    await loginAs("chickenboss");
    open("#/owner");
    fireEvent.click(await screen.findByRole("tab", { name: "매장" }));
    fireEvent.click(screen.getByRole("tab", { name: "입금 계좌" }));
    expect(await screen.findByText(TEST_BANK.account)).toBeInTheDocument();
    expect(screen.getByText(/고객님이 주문하면 이 계좌로 입금 안내를 받아요/)).toBeInTheDocument();

    await click("계좌 바꾸기");
    choose("은행", "신한은행");
    fill({ 계좌번호: "110-12", 예금주: "치킨 사장" });
    await click("바꾼 계좌 저장");
    expect(await screen.findByRole("alert")).toHaveTextContent("숫자 8~16자리");
    fill({ 계좌번호: "110-123-456789" });
    await click("바꾼 계좌 저장");
    expect(await screen.findByText("110-123-456789")).toBeInTheDocument();
    expect(server.db.bankAccount("h3")).toMatchObject({ bank: "신한은행", account: "110-123-456789", holder: "치킨 사장" });

    await click("지우기 (배달 주문 중지)");
    expect(await screen.findByText(/계좌를 등록해야 배달 주문을 받을 수 있어요/)).toBeInTheDocument();
    expect(server.db.bankAccount("h3")).toBeNull();
    // 다른 탭에서는 위에 띠로 알리고, 띠의 버튼이 매장 탭으로 데려간다
    fireEvent.click(screen.getByRole("tab", { name: /주문·예약/ }));
    expect(await screen.findByText(/입금 계좌가 없어 배달 주문을 받지 못하고 있어요/)).toBeInTheDocument();
    await click("계좌 등록");
    expect(await screen.findByRole("tab", { name: "매장" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "입금 계좌" })).toHaveAttribute("aria-selected", "true"); // 세부 메뉴까지 입금 계좌로
    expect(screen.getByRole("button", { name: "계좌 등록" })).toBeInTheDocument(); // 등록 폼
  });

  it("관리자는 매장 목록에서 계좌 등록 여부를, 전체 현황 → 거래 내역에서 입금 상태를 본다", async () => {
    server.createAccount({ username: "adminuser", name: "관리자", role: "admin" });
    server.createAccount({ ...KIM });
    server.db.setBankAccount("h3", { bank: "우리은행", account: "1002-123-456789", holder: "치킨 사장" });
    server.db.setBankAccount("h1", null);
    const paidAt = Date.now() - 60_000;
    const base = { customer: KIM.username, customerName: KIM.name, payment: "계좌이체", storeId: "h3" };
    server.db.addOrder({ ...base, order: { ...makeOrder(chicken, 1, TEST_DELIVERY), bank: TEST_BANK, depositor: KIM.name, payBy: Date.now() + 30 * 60_000 }, status: "입금 대기" });
    server.db.addOrder({ ...base, order: { ...makeOrder(chicken, 2, TEST_DELIVERY), bank: TEST_BANK, depositor: KIM.name, paidAt }, status: "준비 중" });
    await loginAs("adminuser");
    open("#/admin");

    fireEvent.click(await screen.findByRole("tab", { name: "거래 내역" }));
    expect(await screen.findByText("확인된 입금액")).toBeInTheDocument();
    expect(await screen.findByText("40,000원", { selector: ".tile b" })).toBeInTheDocument(); // 입금 확인된 2마리만 (주문 목록은 한 박자 뒤에 온다)
    expect(screen.getByText(formatDateTime(paidAt))).toBeInTheDocument(); // 입금 확인 시각
    expect(screen.getAllByText(`${TEST_BANK.bank} ${TEST_BANK.account} · ${TEST_BANK.holder}`)).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "입금 대기" }));
    expect(document.querySelectorAll(".record-list .record")).toHaveLength(1);

    fireEvent.click(screen.getByRole("tab", { name: /매장·사장님/ }));
    expect(await screen.findByText("우리은행 1002-123-456789 · 치킨 사장")).toBeInTheDocument();
    expect(screen.getAllByText("없음 · 배달 주문 못 받음").length).toBeGreaterThan(0);
    expect(screen.queryByRole("tab", { name: "입금 계좌" })).not.toBeInTheDocument(); // 관리자 기본 계좌는 없다
  });

  it("내 주문: 입금 대기 주문에 입금 계좌·기한을 보여 주고 취소할 수 있으며, 자동 취소되면 이유를 보여 준다", async () => {
    server.createAccount({ ...KIM });
    const payBy = Date.now() + 30 * 60_000;
    const waiting = server.db.addOrder({
      customer: KIM.username,
      customerName: KIM.name,
      payment: "계좌이체",
      storeId: "h3",
      order: { ...makeOrder(chicken, 1, TEST_DELIVERY), bank: TEST_BANK, depositor: KIM.name, payBy, storePhone: "043-111-2222" },
      status: "입금 대기",
    });
    const expired = server.db.addOrder({
      customer: KIM.username,
      customerName: KIM.name,
      payment: "계좌이체",
      storeId: "h3",
      order: { ...makeOrder(chicken, 2, TEST_DELIVERY), cancelNote: "입금 기한이 지나 자동으로 취소됐어요." },
      status: "취소",
    });
    void expired;
    await loginAs(KIM.username);
    open("#/me");
    expect(await screen.findByText(`${TEST_BANK.bank} ${TEST_BANK.account}`, { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "계좌번호 복사: 00000000000" })).toBeInTheDocument();
    expect(screen.getByText(/까지 \(지나면 자동 취소\)/)).toBeInTheDocument();
    expect(screen.getByText("입금 기한이 지나 자동으로 취소됐어요.")).toBeInTheDocument();
    // 가게 전화번호는 누르면 전화를 거는 링크 (번호가 없는 주문에는 그 줄이 없다)
    expect(screen.getByRole("link", { name: "043-111-2222" })).toHaveAttribute("href", "tel:0431112222");
    expect(screen.getAllByText("가게 전화")).toHaveLength(1);

    await click("주문 취소");
    await waitFor(() => expect(server.db.orderById(waiting.id)?.status).toBe("취소"));
  });
});

describe("내 주문 페이지", () => {
  it("로그인한 사람의 주문만 보인다", async () => {
    server.createAccount({ ...KIM });
    seedOrder(KIM, chicken, 1);
    seedOrder(GUEST, chicken, 3);
    await loginAs("customer01");
    open("#/me");
    expect((await screen.findAllByText("간장치킨 1마리")).length).toBeGreaterThan(0);
    expect(screen.queryAllByText("간장치킨 3마리")).toHaveLength(0);
  });
});

describe("챗봇과 연결", () => {
  it("사장님이 품절시킨 메뉴는 챗봇 배달 버튼에서 빠지고, 챗봇의 주문은 서버에 남는다", async () => {
    server.db.updateStoreSettings("h3", { item: { id: "d2", patch: { soldOut: true } } });
    server.createAccount({ ...KIM, ...TEST_DELIVERY });
    await loginAs(KIM.username); // 배달 주문은 로그인한 고객님만
    open("#/chat");
    await waitFor(() => expect(getDb().storeSettings.h3?.items?.d2?.soldOut).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "채팅창 켜기" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "배달" } });
    fireEvent.click(screen.getByRole("button", { name: "Say 전송" }));
    expect(await screen.findByRole("button", { name: "옛날통닭" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "간장치킨" })).not.toBeInTheDocument();
  });
});

describe("개인정보 처리방침", () => {
  it("로그인 화면 아래 링크로 열 수 있고, 로그인 없이 볼 수 있다", async () => {
    open("#/login");
    expect(screen.getByRole("link", { name: "개인정보 처리방침" })).toHaveAttribute("href", "#/privacy");
    cleanup();
    open("#/privacy");
    expect(await screen.findByRole("heading", { name: "1. 수집하는 개인정보" })).toBeInTheDocument();
    expect(screen.getByText("Resend, Inc. (미국)")).toBeInTheDocument();
    expect(screen.getByText(/2026년 10월 16일부터 적용돼요/)).toBeInTheDocument();
  });
});

describe("계정 관리·회원 탈퇴", () => {
  it("고객님: 내 주문에서 계정 관리로 가서 비밀번호를 확인하고 탈퇴하면, 주문 기록은 이름을 지운 채 남는다", async () => {
    server.createAccount({ ...KIM });
    const order = seedOrder(KIM, chicken, 1);
    await loginAs(KIM.username);
    open("#/me");
    const link = await screen.findByRole("link", { name: "계정 관리 · 회원 탈퇴" });
    expect(link).toHaveAttribute("href", "#/account");
    cleanup();
    open("#/account");

    expect(await screen.findByText(KIM.username)).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "회원 탈퇴" });
    expect(submit).toBeDisabled();
    fill({ "비밀번호 확인": "wrongpass1" });
    fireEvent.click(screen.getByRole("checkbox", { name: "위 내용을 확인했고, 탈퇴할게요" }));
    await click("회원 탈퇴");
    expect(await screen.findByRole("alert")).toHaveTextContent("비밀번호가 맞지 않아요");
    expect(server.db.findUser(KIM.username)).not.toBeNull();

    fill({ "비밀번호 확인": "password1" });
    await click("회원 탈퇴");
    await waitFor(() => expect(window.location.hash).toBe("#/login"));
    expect(await screen.findByRole("status")).toHaveTextContent("탈퇴가 완료됐어요");
    expect(server.db.findUser(KIM.username)).toBeNull();
    expect(getToken()).toBeNull();
    const kept = server.db.orderById(order.id) as unknown as { customerName: string };
    expect(kept.customerName).toBe("탈퇴한 회원");
  });

  it("사장님에게는 매장 기록이 남는다는 안내가 보이고, 관리자 화면에는 탈퇴 링크가 없다", async () => {
    server.createAccount({ username: "chickenboss", name: "치킨 사장", role: "owner", storeId: "h3" });
    await loginAs("chickenboss");
    open("#/account");
    expect(await screen.findByText("청전 치킨공방")).toBeInTheDocument();
    expect(screen.getByText(/매장에 들어온 주문·예약과 영업시간·메뉴 설정은 그대로 남아요/)).toBeInTheDocument();
    cleanup();

    server.createAccount({ username: "adminuser", name: "관리자", role: "admin" });
    await loginAs("adminuser");
    open("#/admin");
    await screen.findByText("관리자");
    expect(screen.queryByRole("link", { name: "계정 관리 · 회원 탈퇴" })).not.toBeInTheDocument();
  });

  it("로그아웃하면 서버의 로그인 세션도 지워진다", async () => {
    server.createAccount({ ...KIM });
    await loginAs(KIM.username);
    const token = getToken()!;
    await logout();
    const res = await fetch(server.base + "/api/auth/me", { headers: { Authorization: `Bearer ${token}` } });
    expect((await res.json()).session).toBeNull();
  });
});

describe("점검에서 찾은 사장님·관리자 화면 문제", () => {
  const boss = { username: "chickenboss", name: "치킨 사장", role: "owner" as const, storeId: "h3" };
  type MenuDb = { addMenuItem(i: object): { id: string }; allStoreSettings(): Record<string, { items: Record<string, { price?: number; soldOut?: boolean }> }> };

  it("사장님이 추가한 메뉴(긴 id)의 가격·품절이 저장되고, 할인된 주문은 금액 옆에 할인율이 보인다", async () => {
    server.createAccount(boss);
    const added = (server.db as unknown as MenuDb).addMenuItem({ restaurantId: "h3", name: "마늘치킨", price: 22000, unit: "마리", keywords: [] });
    seedOrder(GUEST, chicken, 2);
    server.db.addOrder({ customer: "guest", customerName: "비회원", payment: "계좌이체", storeId: "h3", order: { ...makeOrder(chicken, 1, TEST_DELIVERY), price: 16000, discountPct: 20, listPrice: 20000 } });
    await loginAs("chickenboss");
    open("#/owner");
    expect(await screen.findByText("16,000원 (20% 할인)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "메뉴" }));
    await act(async () => void fireEvent.click(await screen.findByRole("button", { name: "마늘치킨 품절" })));
    await waitFor(() => expect((server.db as unknown as MenuDb).allStoreSettings().h3?.items[added.id]?.soldOut).toBe(true));
    const price = await screen.findByRole("spinbutton", { name: "마늘치킨 가격" });
    fireEvent.change(price, { target: { value: "24000" } });
    fireEvent.blur(price);
    await waitFor(() => expect((server.db as unknown as MenuDb).allStoreSettings().h3?.items[added.id]?.price).toBe(24000));
  });

  it("같은 기기에서 다른 사장님으로 로그인하면 전 계정의 주문이 새 주문 알림 기준이 되지 않는다", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.createAccount(boss);
    server.createAccount({ username: "tongdakboss", name: "통닭 사장", role: "owner", storeId: "h1" });
    seedOrder(GUEST, chicken, 3); // h3 의 주문
    seedOrder(GUEST, tongdak, 1); // h1 의 오래된 접수 주문
    await loginAs("chickenboss");
    open("#/owner");
    expect(await screen.findByText("간장치킨 3마리")).toBeInTheDocument();
    await click("로그아웃");
    await waitFor(() => expect(window.location.hash).toBe("#/login"));
    cleanup();

    await loginAs("tongdakboss");
    open("#/owner");
    expect(await screen.findByText("옛날통닭 1마리")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(5000));
    await act(async () => void (await Promise.resolve()));
    expect(screen.queryByRole("status")).not.toBeInTheDocument(); // 열기 전부터 있던 주문이라 알리지 않는다
  });

  it("아직 오지 않은 날짜의 예약은 방문 완료를 누를 수 없다", async () => {
    server.createAccount(boss);
    server.db.addReservation({ customer: "guest", customerName: "비회원", restaurantId: "h3", restaurantName: "청전 치킨공방", date: "2099-01-01", time: "19:00", people: 2 });
    await loginAs("chickenboss");
    open("#/owner");
    fireEvent.click(await screen.findByRole("tab", { name: "식당 예약" }));
    expect(await screen.findByRole("button", { name: "방문 완료" })).toBeDisabled();
  });

  it("관리자 이용 내역은 이름이 아니라 아이디로 묶고, 매장이 사라진 사장님은 따로 보여 준다", async () => {
    server.createAccount({ username: "adminuser", name: "관리자", role: "admin" });
    server.createAccount({ username: "kim00001", name: "김소비", email: "a@example.com" });
    server.createAccount({ username: "kim00002", name: "김소비", email: "b@example.com" });
    server.createAccount({ username: "lostboss01", name: "사라진 매장 사장", role: "owner", storeId: "zz9" });
    seedOrder({ username: "kim00001", name: "김소비" }, chicken, 1);
    seedOrder({ username: "kim00002", name: "김소비" }, chicken, 2);
    await loginAs("adminuser");
    open("#/admin");
    fireEvent.click(await screen.findByRole("tab", { name: "사용자" }));
    // 가입 목록과 이용 내역 양쪽에 아이디가 보인다 (이름이 같은 두 사람이 한 줄로 합쳐지지 않는다)
    expect(await screen.findByText("kim00001")).toBeInTheDocument();
    expect(screen.getByText("kim00002")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "이용 내역" }));
    expect(await screen.findByText("이용 내역 (2)")).toBeInTheDocument();
    expect(screen.getByText("kim00001")).toBeInTheDocument();
    expect(screen.getByText("kim00002")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /매장·사장님/ }));
    expect(await screen.findByText("매장을 찾을 수 없는 사장님 (1)")).toBeInTheDocument();
    await click("lostboss01 삭제");
    await waitFor(() => expect(server.db.findUser("lostboss01")).toBeNull());
  });
});

describe("사장님 승인 (관리자)", () => {
  it("승인 대기 사장님이 탭 배지와 목록에 보이고, 승인하면 서버에 반영된다", async () => {
    server.createAccount({ username: "adminuser", name: "관리자", role: "admin" });
    const db = server.db as unknown as { createUser(u: object): unknown; findUser(u: string): { approved?: boolean } | null };
    db.createUser({ username: "waitboss1", passwordHash: "x", name: "대기 사장", email: "wait@example.com", role: "owner", storeId: "p2", approved: false });
    await loginAs("adminuser");
    open("#/admin");

    fireEvent.click(await screen.findByRole("tab", { name: /매장·사장님/ }));
    // 기다리는 사장님이 있으면 세부 메뉴 "승인 대기"부터 열린다
    expect(await screen.findByText("승인 대기 (1)")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "승인 대기1" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("wait@example.com")).toBeInTheDocument();
    await click("승인");
    await waitFor(() => expect(db.findUser("waitboss1")?.approved).toBe(true));
    // 다 처리하면 "승인 대기" 세부 메뉴가 사라지고 매장 목록으로 돌아간다
    expect(await screen.findByText("매장과 사장님 계정")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /승인 대기/ })).not.toBeInTheDocument();
  });
});

describe("로그인 틀린 횟수", () => {
  it("틀릴 때마다 오류 문구 옆에 횟수를 붙이고, 여러 번 틀려도 막지 않는다. 다른 아이디면 1부터 센다", async () => {
    server.createAccount({ ...KIM });
    open("#/login");
    for (let i = 1; i <= 6; i++) {
      await screen.findByRole("button", { name: "로그인" }); // 앞 시도가 끝나 버튼이 돌아온 뒤에
      typeLogin(KIM.username, "wrongpass" + i);
      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(`아이디 또는 비밀번호가 맞지 않아요. (${i})`));
    }
    await screen.findByRole("button", { name: "로그인" });
    typeLogin("someoneelse", "wrongpass");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("아이디 또는 비밀번호가 맞지 않아요. (1)"));
    await screen.findByRole("button", { name: "로그인" });
    typeLogin(KIM.username, "password1");
    await waitFor(() => expect(window.location.hash).toBe("#/chat"));
  });
});

describe("비밀번호 찾기", () => {
  it("로그인 화면에서 들어가 가입한 이메일로 인증하면 새 비밀번호로 바뀌고 아이디를 알려 준다", async () => {
    server.createAccount({ ...KIM, email: "kim@example.com" });
    open("#/login");
    expect(screen.getByRole("link", { name: "아이디·비밀번호를 잊으셨나요?" })).toHaveAttribute("href", "#/reset");
    cleanup();
    open("#/reset");

    fill({ 이메일: "nobody@example.com" });
    await click("인증번호 받기");
    expect(await screen.findByText(/가입된 이메일이 아니에요/)).toBeInTheDocument();

    fill({ 이메일: "KIM@example.com" });
    await click("인증번호 받기");
    await screen.findByLabelText("인증번호");
    fill({ 인증번호: TEST_CODE });
    await click("확인");
    await screen.findByText("인증 완료");
    fill({ "새 비밀번호": "brandnew1", "새 비밀번호 확인": "brandnew1" });
    await click("비밀번호 바꾸기");

    expect(await screen.findByRole("status")).toHaveTextContent(`아이디는 ${KIM.username}이에요`);
    expect("error" in (await login(KIM.username, "password1"))).toBe(true);
    expect("session" in (await login(KIM.username, "brandnew1"))).toBe(true);
  });
});

describe("로그인한 고객님의 연락처·배달지", () => {
  const findBot = (re: RegExp) => screen.findAllByText(re, {}, { timeout: 3000 });
  const inCard = (text: string) => screen.queryAllByText(text).some((el) => el.tagName === "DD");
  // 챗봇은 채팅창이 꺼진 채로 열리므로 켜고 말한다
  function openChat() {
    open("#/chat");
    fireEvent.click(screen.getByRole("button", { name: "채팅창 켜기" }));
  }
  function sayInChat(text: string) {
    fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: "Say 전송" }));
  }

  it("로그인하지 않은 손님은 로그인 화면으로 보내고, 로그인하면 챗봇으로 돌아와 고르던 주문을 이어 간다", async () => {
    server.createAccount({ ...KIM, ...TEST_DELIVERY });
    openChat();
    sayInChat("간장치킨 2마리");
    expect(await findBot(/배달 주문은 로그인한 뒤에 할 수 있어요/)).toBeTruthy();
    await waitFor(() => expect(window.location.hash).toBe("#/login"), { timeout: 6000 }); // 잠시 뒤 저절로 넘어간다

    await screen.findByLabelText("아이디"); // 로그인 화면은 따로 받아 온다
    typeLogin(KIM.username, "password1");
    await waitFor(() => expect(window.location.hash).toBe("#/chat"));
    fireEvent.click(await screen.findByRole("button", { name: "채팅창 켜기" }));
    expect(await findBot(/김소비님, 고르시던 배달 주문을 이어서 도와드릴게요/)).toBeTruthy();
    await waitFor(() => expect(inCard(TEST_DELIVERY.address)).toBe(true), { timeout: 3000 });
    expect(inCard("간장치킨 2마리")).toBe(true);
  }, 15_000); // 로그인 화면으로 넘어가기 전 3초를 실제로 기다린다

  it("배달지가 없으면 계정 관리로 보내고, 등록하고 돌아오면 고르던 메뉴·수량으로 주문서를 만든다", async () => {
    server.createAccount({ ...KIM, phone: "010-1234-5678" });
    await loginAs(KIM.username);
    openChat();
    sayInChat("간장치킨 2마리");
    expect(await findBot(/아직 계정에 배달지가 없어요\.\s*배달지를 등록해주세요\./)).toBeTruthy();
    // 주소를 챗봇에서 묻지 않고, 주문서로도 넘어가지 않는다
    expect(screen.queryByText(/배달 받을 주소를 알려 주세요/)).not.toBeInTheDocument();
    expect(screen.queryByText("주문 내역을 확인해 주세요.")).not.toBeInTheDocument();

    // 버튼 없이 3초 뒤에 계정 관리로 저절로 넘어간다 (바로 넘어가지 않는다)
    expect(screen.queryByRole("button", { name: "계정 관리로 가기" })).not.toBeInTheDocument();
    expect(window.location.hash).not.toBe("#/account");
    await waitFor(() => expect(window.location.hash).toBe("#/account"), { timeout: 5000 });
    expect(await screen.findByText("배달지를 등록해야 배달 주문을 할 수 있어요.")).toBeInTheDocument();
    expect(screen.getByLabelText("휴대폰 번호")).toHaveValue("010-1234-5678");
    fill({ 배달지: "제천" });
    await click("저장");
    expect(await screen.findByRole("alert")).toHaveTextContent("동·호수까지");

    fill({ 배달지: "제천시 하소동 행복아파트 101동 202호" });
    await click("저장");
    expect(await screen.findByRole("link", { name: "챗봇으로 돌아가 주문 이어 가기" })).toHaveAttribute("href", "#/chat");
    expect(server.db.findUser(KIM.username)).toMatchObject({ address: "제천시 하소동 행복아파트 101동 202호" });

    cleanup();
    openChat();
    expect(await findBot(/고르시던 배달 주문을 이어서 도와드릴게요/)).toBeTruthy();
    await waitFor(() => expect(inCard("제천시 하소동 행복아파트 101동 202호")).toBe(true), { timeout: 3000 });
    expect(inCard("010-1234-5678")).toBe(true);
    expect(inCard("간장치킨 2마리")).toBe(true);
  }, 15_000); // 계정 관리로 넘어가기 전 3초를 실제로 기다린다

  it("배달을 고르는 순간 막고, 배달지가 있으면 묻지 않고 계정의 배달지로 주문서를 만든다", async () => {
    server.createAccount({ ...KIM, phone: "010-1234-5678" });
    await loginAs(KIM.username);
    openChat();
    sayInChat("배달");
    expect(await findBot(/아직 계정에 배달지가 없어요/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "간장치킨" })).not.toBeInTheDocument();
    cleanup();

    server.createAccount({ username: "customer02", phone: "010-2222-3333", address: "제천시 청전동 푸른빌 5호" });
    await loginAs("customer02");
    openChat();
    sayInChat("간장치킨 1마리");
    await waitFor(() => expect(inCard("제천시 청전동 푸른빌 5호")).toBe(true), { timeout: 3000 });
    expect(inCard("010-2222-3333")).toBe(true);

    // 주문서의 배달지 변경은 계정 관리로 보낸다
    fireEvent.click(screen.getByRole("button", { name: "배달지 변경" }));
    expect(await findBot(/배달지는 계정 관리에서 바꿀 수 있어요/)).toBeTruthy();
  });

  it("전화번호가 없는 예전 계정은 연락처부터 등록하게 하고, 사장님은 연락처만 바꾼다", async () => {
    server.createAccount({ ...KIM, address: "제천시 장락동 제천빌라 331호" });
    await loginAs(KIM.username);
    openChat();
    sayInChat("간장치킨 2마리");
    expect(await findBot(/아직 계정에 연락처가 없어요/)).toBeTruthy();
    cleanup();

    server.createAccount({ username: "chickenboss", name: "치킨 사장", role: "owner", storeId: "h3" });
    await loginAs("chickenboss");
    open("#/account");
    expect(await screen.findByRole("heading", { name: "연락처" })).toBeInTheDocument();
    expect(screen.queryByLabelText("배달지")).not.toBeInTheDocument();
    // 사장님의 번호는 매장 전화번호 (주문한 손님에게 보인다)
    expect(screen.getByText(/주문한 손님에게 가게 전화번호로 보이고/)).toBeInTheDocument();
    fill({ "매장 전화번호": "01055556666" });
    await click("저장");
    expect(await screen.findByRole("status")).toHaveTextContent("저장했어요");
    expect(server.db.findUser("chickenboss")).toMatchObject({ phone: "010-5555-6666" });
  });
});

describe("매장 일시 중지 (사장님·관리자 화면)", () => {
  const onServer = () => server.db.allStoreSettings().h3 as unknown as { pausedFrom?: number; pausedUntil?: number } | undefined;
  const pad = (n: number) => String(n).padStart(2, "0");
  const hhmm = (ms: number) => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`;
  // 오늘이 아닌 날의 시각은 "내일 00:25"처럼 보인다 (밤 9시 넘어 2~3시간 뒤를 잡으면 자정을 넘는다)
  const atText = (ms: number) => `${new Date(ms).toDateString() !== new Date().toDateString() ? "내일 " : ""}${hhmm(ms)}`;
  async function openStoreTab() {
    server.createAccount({ username: "chickenboss", name: "치킨 사장", role: "owner", storeId: "h3" });
    await loginAs("chickenboss");
    open("#/owner");
    fireEvent.click(await screen.findByRole("tab", { name: "매장" }));
    expect(await screen.findByRole("heading", { name: "일시 중지" })).toBeInTheDocument();
  }

  it("시작은 지금, 종료 시간을 고르면 그때까지 멈추고 타이머가 남은 시간을 보여 주며, 다른 탭의 띠로 바로 풀 수 있다", async () => {
    await openStoreTab();
    // 태그·설명·빠른 버튼 없이 시작·종료 두 칸
    expect(screen.queryByText("주문 받는 중")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /30분/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("시작 시간")).toHaveValue(hhmm(Date.now()));
    expect(screen.getByRole("button", { name: "일시 중지" })).toBeDisabled(); // 종료 시간을 고르기 전

    const end = Date.now() + 2 * 60 * 60_000;
    fireEvent.change(screen.getByLabelText("종료 시간"), { target: { value: hhmm(end) } });
    await click("일시 중지");
    await waitFor(() => expect(onServer()?.pausedUntil).toBeDefined());
    expect(hhmm(onServer()!.pausedUntil!)).toBe(hhmm(end));
    expect(onServer()!.pausedFrom).toBeLessThanOrEqual(Date.now()); // 바로 시작

    const timer = await screen.findByRole("timer");
    expect(timer).toHaveTextContent("다시 받기까지");
    expect(timer).toHaveTextContent(/1:5\d:\d\d|2:00:00/);
    expect(timer).not.toHaveTextContent("저절로 다시 주문을 받아요");

    fireEvent.click(screen.getByRole("tab", { name: "주문·예약" }));
    expect(screen.getByText(/^새 주문을 잠시 받지 않고 있어요 · (내일 )?\d{2}:\d{2}까지$/)).toBeInTheDocument();
    await click("다시 받기");
    await waitFor(() => expect(onServer()?.pausedUntil).toBeUndefined());
    await waitFor(() => expect(document.querySelector(".pause-banner")).toBeNull());
  });

  it("시작 시간을 앞으로 잡으면 미리 정해 두고, 시작까지 남은 시간을 보여 주며, 취소할 수 있다", async () => {
    await openStoreTab();
    const from = Date.now() + 2 * 60 * 60_000;
    const until = Date.now() + 3 * 60 * 60_000;
    fireEvent.change(screen.getByLabelText("시작 시간"), { target: { value: hhmm(from) } });
    fireEvent.change(screen.getByLabelText("종료 시간"), { target: { value: hhmm(until) } });
    await click("일시 중지");
    await waitFor(() => expect(onServer()?.pausedFrom).toBeGreaterThan(Date.now()));
    expect(hhmm(onServer()!.pausedFrom!)).toBe(hhmm(from));

    const timer = await screen.findByRole("timer");
    expect(timer).toHaveTextContent("일시 중지 시작까지");
    expect(timer).toHaveTextContent(`${atText(from)}부터 ${atText(until)}까지 멈춰요.`);
    // 아직 시작 전이라 주문은 받는다
    fireEvent.click(screen.getByRole("tab", { name: "메뉴" }));
    expect(screen.getByText(/일시 중지 예정이에요$/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "매장" }));

    await click("일시 중지 취소");
    await waitFor(() => expect(onServer()?.pausedUntil).toBeUndefined());
    await waitFor(() => expect(screen.queryByRole("timer")).not.toBeInTheDocument());
  });

  it("멈춘 동안 종료 시간을 바꿀 수 있다 (바꾸지 않으면 시간 바꾸기 버튼은 꺼져 있다)", async () => {
    await openStoreTab();
    fireEvent.change(screen.getByLabelText("종료 시간"), { target: { value: hhmm(Date.now() + 60 * 60_000) } });
    await click("일시 중지");
    expect(await screen.findByRole("button", { name: "시간 바꾸기" })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("button", { name: "지금 다시 받기" })).toBeEnabled());
    const later = Date.now() + 3 * 60 * 60_000;
    fireEvent.change(screen.getByLabelText("종료 시간"), { target: { value: hhmm(later) } });
    await click("시간 바꾸기");
    await waitFor(() => expect(hhmm(onServer()!.pausedUntil!)).toBe(hhmm(later)));
    await click("지금 다시 받기");
    await waitFor(() => expect(onServer()?.pausedUntil).toBeUndefined());
  });

  it("관리자 매장 목록에 일시 중지와 예정이 보인다", async () => {
    server.createAccount({ username: "adminuser", name: "관리자", role: "admin" });
    server.db.updateStoreSettings("h3", { pausedUntil: Date.now() + 60 * 60_000 } as never);
    server.db.updateStoreSettings("h1", { pausedFrom: Date.now() + 60 * 60_000, pausedUntil: Date.now() + 2 * 60 * 60_000 } as never);
    await loginAs("adminuser");
    open("#/admin");
    fireEvent.click(await screen.findByRole("tab", { name: "매장·사장님" }));
    expect(await screen.findByText(/^일시 중지 · (내일 )?\d{2}:\d{2}까지$/)).toBeInTheDocument();
    expect(screen.getByText(/^일시 중지 예정 · (내일 )?\d{2}:\d{2}~(내일 )?\d{2}:\d{2}$/)).toBeInTheDocument();
  });
});

describe("관리자에게 문의", () => {
  const ADMIN = { username: "adminuser", name: "관리자", role: "admin" as const };

  it("고객님이 문의를 보내면 내 문의에 '답변 대기'로 쌓이고, 관리자가 문의 탭에서 답하면 고객님이 답을 본다", async () => {
    server.createAccount({ ...KIM, email: "kim@example.com" });
    server.createAccount(ADMIN);
    await loginAs(KIM.username);
    open("#/inquiry");
    expect(await screen.findByRole("heading", { name: "문의 보내기" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "관리자에게 문의" })).not.toBeInTheDocument(); // 이 화면에서는 아래 링크를 감춘다
    expect(await screen.findByText("아직 보낸 문의가 없어요.")).toBeInTheDocument();

    // 분류와 5자 이상 내용이 있어야 보낸다
    fireEvent.click(screen.getByRole("button", { name: "문의 보내기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("문의 분류를 골라 주세요");
    fireEvent.click(screen.getByRole("radio", { name: "결제·환불" }));
    fireEvent.change(screen.getByLabelText("문의 내용"), { target: { value: "입금" } });
    fireEvent.click(screen.getByRole("button", { name: "문의 보내기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("5자 이상");
    fireEvent.change(screen.getByLabelText("문의 내용"), { target: { value: "입금했는데 아직 입금 대기로 나와요." } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "문의 보내기" })));
    expect(await screen.findByRole("status")).toHaveTextContent("문의를 보냈어요");
    expect(await screen.findByText("입금했는데 아직 입금 대기로 나와요.")).toBeInTheDocument();
    expect(screen.getByText("답변 대기")).toBeInTheDocument();
    expect(screen.getByLabelText("문의 내용")).toHaveValue("");
    cleanup();

    // 관리자: 문의 탭에 답변 대기 수가 뜨고, 카드에서 답한다
    await logout();
    await loginAs(ADMIN.username);
    open("#/admin");
    const tab = await screen.findByRole("tab", { name: /문의/ });
    await waitFor(() => expect(tab).toHaveTextContent("문의1"));
    fireEvent.click(tab);
    expect(await screen.findByText("김소비 · 고객님 · customer01")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("답변"), { target: { value: "가게에 확인했어요. 곧 접수돼요." } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "답변 보내기" })));
    expect(await screen.findByText("답변을 기다리는 문의가 없어요.")).toBeInTheDocument();
    expect(server.db.listInquiries({ username: KIM.username })[0].answer).toBe("가게에 확인했어요. 곧 접수돼요.");
    cleanup();

    await logout();
    await loginAs(KIM.username);
    open("#/inquiry");
    expect(await screen.findByText("가게에 확인했어요. 곧 접수돼요.")).toBeInTheDocument();
    expect(screen.getByText("답변 완료")).toBeInTheDocument();
  });

  it("사장님은 사장님 화면 아래 링크와 계정 관리에서 문의 화면으로 간다", async () => {
    server.createAccount({ username: "chickenboss", name: "치킨 사장", role: "owner", storeId: "h3" });
    await loginAs("chickenboss");
    open("#/owner");
    expect(await screen.findByRole("link", { name: "관리자에게 문의" })).toHaveAttribute("href", "#/inquiry");
    cleanup();
    open("#/account");
    expect(await screen.findByRole("heading", { name: "관리자에게 문의" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "문의하기" })).toHaveAttribute("href", "#/inquiry");
  });
});
