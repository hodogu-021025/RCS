import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { login, logout } from "../auth/auth";
import { getToken } from "../api/client";
import { DELIVERY_MENU, makeOrder } from "../components/orderChatKnowledge";
import { getDb, refresh } from "../data/db";
import { server, TEST_CODE } from "../test/setup";

// 실제 앱은 화면을 그 화면에 갈 때 받지만(routes.ts 의 lazy), 테스트에서는 바로 받아 동기로 그린다
vi.mock("./routes", async () => {
  const [login, signup, me, owner, admin, privacy, account] = await Promise.all([
    import("./LoginPage"),
    import("./SignupPage"),
    import("./MyOrdersPage"),
    import("./OwnerPage"),
    import("./AdminPage"),
    import("./PrivacyPage"),
    import("./AccountPage"),
  ]);
  return {
    LoginPage: login.LoginPage,
    SignupPage: signup.SignupPage,
    MyOrdersPage: me.MyOrdersPage,
    OwnerPage: owner.OwnerPage,
    AdminPage: admin.AdminPage,
    PrivacyPage: privacy.PrivacyPage,
    AccountPage: account.AccountPage,
  };
});

// App 은 해시 주소(#/owner)로 페이지를 고른다
function open(path: string) {
  window.location.hash = path;
  return render(<App />);
}

const chicken = DELIVERY_MENU.find((d) => d.name === "간장치킨")!;
const tongdak = DELIVERY_MENU.find((d) => d.name === "옛날통닭")!;
const loginAs = async (username: string) => {
  const r = await login(username, "password1");
  if ("error" in r) throw new Error(r.error);
};
// 테스트 서버의 DB 에 기록을 바로 넣는다
const seedOrder = (customer: { username: string; name: string }, item = chicken, qty = 1, payment = "토스페이") =>
  server.db.addOrder({ customer: customer.username, customerName: customer.name, payment, storeId: item.restaurantId, order: makeOrder(item, qty) });
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
    expect(await screen.findByText("청전 치킨공방 · 사장님")).toBeInTheDocument();

    // 새로고침: 토큰은 남아 있고 세션은 서버에 다시 물어본다
    first.unmount();
    const { restoreSession } = await import("../auth/auth");
    await restoreSession();
    open("#/owner");
    expect(await screen.findByText("청전 치킨공방 · 사장님")).toBeInTheDocument();
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
    expect(await screen.findByText("장락반점 · 사장님")).toBeInTheDocument();

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
    expect(screen.getByRole("radio", { name: "고객님" })).toBeChecked();
    expect(screen.queryByLabelText("매장")).not.toBeInTheDocument();
    fill({ 아이디: "hongildong", 이름: "홍길동", 비밀번호: "password1", "비밀번호 확인": "password1" });
    agree();
    await verifyEmail("Hong@Example.com");
    await click("고객님으로 가입하기");

    await waitFor(() => expect(window.location.hash).toBe("#/chat"));
    expect(server.db.findUser("hongildong")).toMatchObject({ role: "user" });
    expect(server.sent).toEqual([{ email: "hong@example.com", code: TEST_CODE }]);
  });

  it("사장님으로 가입하면 매장을 골라야 하고, 가입 후 내 매장의 사장님 페이지로 간다", async () => {
    open("#/signup");
    fireEvent.click(screen.getByRole("radio", { name: "사장님" }));
    fill({ 아이디: "banjeom01", "대표자 이름": "김사장", 비밀번호: "password1", "비밀번호 확인": "password1" });
    agree();
    await verifyEmail("boss@example.com");
    await click("사장님으로 가입하기");
    expect(await screen.findByRole("alert")).toHaveTextContent("매장을 골라 주세요");

    fill({ 매장: "c1" });
    await click("사장님으로 가입하기");
    await waitFor(() => expect(window.location.hash).toBe("#/owner"));
    expect(await screen.findByText("장락반점 · 사장님")).toBeInTheDocument();
    expect(server.db.findUser("banjeom01")).toMatchObject({ role: "owner", storeId: "c1" });
  });

  it("이메일 인증: 번호를 받으면 5분 타이머가 돌고, 틀리면 안내, 맞으면 인증 완료, 변경하면 다시 인증", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    open("#/signup");
    fill({ 아이디: "hongildong", 이름: "홍길동", 비밀번호: "password1", "비밀번호 확인": "password1" });
    await click("고객님으로 가입하기");
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

    fill({ 아이디: "short1", 이름: "누구", 비밀번호: "password1", "비밀번호 확인": "password1" });
    agree();
    await verifyEmail("new@example.com");
    await click("고객님으로 가입하기");
    expect(await screen.findByRole("alert")).toHaveTextContent("영문·숫자 8~20자");
    fill({ 아이디: "takenuser" });
    await click("고객님으로 가입하기"); // 이번엔 서버가 거른다 (안내가 바뀔 때까지 기다린다)
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("이미 있는 아이디예요"));
    expect(server.db.findUser("short1")).toBeNull();
  });

  it("개인정보 수집·이용에 동의해야 가입되고, 요약과 전체 방침(새 탭)을 볼 수 있다", async () => {
    open("#/signup");
    expect(consentBox()).not.toBeChecked();
    fill({ 아이디: "hongildong", 이름: "홍길동", 비밀번호: "password1", "비밀번호 확인": "password1" });
    await verifyEmail("hong@example.com");
    await click("고객님으로 가입하기");
    expect(await screen.findByRole("alert")).toHaveTextContent("개인정보 수집·이용에 동의해 주세요");
    expect(server.db.findUser("hongildong")).toBeNull();

    fireEvent.click(screen.getByText("내용 보기"));
    expect(screen.getByText("수집 항목")).toBeInTheDocument();
    expect(screen.getByText(/동의하지 않으면 회원가입을 할 수 없어요/)).toBeInTheDocument();
    const full = screen.getByRole("link", { name: "개인정보 처리방침 전체 보기" });
    expect(full).toHaveAttribute("href", "#/privacy");
    expect(full).toHaveAttribute("target", "_blank");

    agree();
    await click("고객님으로 가입하기");
    await waitFor(() => expect(window.location.hash).toBe("#/chat"));
  });

  it("비밀번호 눈 버튼과 고객님·사장님 토글", () => {
    open("#/signup");
    const pw = screen.getByLabelText("비밀번호");
    expect(pw).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "비밀번호 보기" }));
    expect(pw).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("비밀번호 확인")).toHaveAttribute("type", "password"); // 칸마다 따로

    const group = screen.getByRole("radiogroup", { name: "가입 유형" });
    expect(group).toHaveAttribute("data-active", "user");
    fireEvent.click(screen.getByRole("radio", { name: "사장님" }));
    expect(group).toHaveAttribute("data-active", "owner");
  });
});

describe("사장님 페이지", () => {
  const boss = { username: "chickenboss", name: "치킨 사장", role: "owner" as const, storeId: "h3" };

  it("내 매장 주문만 보이고, 접수 → 준비 중 → 완료로 바꾸면 서버에 저장된다", async () => {
    server.createAccount(boss);
    server.createAccount({ ...KIM });
    const mine = seedOrder(KIM, chicken, 2, "카카오페이");
    seedOrder(GUEST, tongdak, 1); // 다른 매장(h1)
    await loginAs("chickenboss");
    open("#/owner");

    expect(await screen.findByText("간장치킨 2마리")).toBeInTheDocument();
    expect(screen.queryByText(/옛날통닭/)).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /주문·예약/ })).toHaveTextContent("1"); // 접수 배지

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

    seedOrder(GUEST, chicken, 1, "신용카드"); // 손님 폰에서 주문이 들어온 것과 같다
    act(() => void vi.advanceTimersByTime(5000)); // 화면이 몇 초마다 새로 받는다
    expect(await screen.findByRole("status")).toHaveTextContent("새 주문: 간장치킨 1마리");
  });

  it("매장·메뉴 탭에서 품절·가격·영업시간을 바꾸면 서버에 저장된다", async () => {
    server.createAccount(boss);
    await loginAs("chickenboss");
    open("#/owner");
    fireEvent.click(await screen.findByRole("tab", { name: "매장·메뉴" }));

    await act(async () => void fireEvent.click(screen.getByRole("checkbox", { name: "품절" })));
    await waitFor(() => expect(server.db.allStoreSettings().h3?.items.d2?.soldOut).toBe(true));
    const price = screen.getByRole("spinbutton", { name: "간장치킨 가격" });
    fireEvent.change(price, { target: { value: "23000" } });
    fireEvent.blur(price);
    await waitFor(() => expect(server.db.allStoreSettings().h3?.items.d2?.price).toBe(23000));
    fireEvent.change(screen.getByLabelText("닫는 시간"), { target: { value: "23:00" } });
    await waitFor(() => expect(server.db.allStoreSettings().h3?.hours).toBe("16:00 - 23:00"));
  });

  it("예약은 방문 완료로 바꿀 수 있고, 자정(24:00)에 닫는 매장은 닫는 시간이 00:00 으로 보인다", async () => {
    server.createAccount({ username: "tongdakboss", name: "옛날통닭 사장님", role: "owner", storeId: "h1" }); // 15:00 - 24:00
    const rsv = server.db.addReservation({ ...GUEST, customer: "guest", customerName: "비회원", restaurantId: "h1", restaurantName: "장락 옛날통닭", date: "2026-10-10", time: "19:00", people: 3 });
    await loginAs("tongdakboss");
    open("#/owner");
    expect(await screen.findByText(/10월 10일 \(토\) 19:00/)).toBeInTheDocument();
    await click("방문 완료");
    await waitFor(() => expect(server.db.reservationById(rsv.id)?.status).toBe("방문 완료"));

    fireEvent.click(screen.getByRole("tab", { name: "매장·메뉴" }));
    expect(screen.getByLabelText("여는 시간")).toHaveValue("15:00");
    expect(screen.getByLabelText("닫는 시간")).toHaveValue("00:00");
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
    fireEvent.click(screen.getByRole("button", { name: "식당 예약" }));
    expect(cards()).toHaveLength(1);
    expect(within(cards()[0] as HTMLElement).getByText("장락반점")).toBeInTheDocument();
    expect(document.querySelector(".dash")).toHaveClass("dash-mobile");
  });

  it("사장님 계정을 만들면 목록에 뜨고 그 계정으로 로그인되며, 지우면 사라진다", async () => {
    server.createAccount(admin);
    server.db.updateStoreSettings("c1", { hours: "11:00 - 18:00" });
    await loginAs("adminuser");
    open("#/admin");
    fireEvent.click(await screen.findByRole("tab", { name: "매장·사장님" }));
    expect(await screen.findByText("11:00 - 18:00")).toBeInTheDocument(); // 사장님이 바꾼 영업시간이 보인다

    fill({ 아이디: "jangrakboss", 비밀번호: "password1", 매장: "c1" });
    await click("계정 만들기");
    expect(await screen.findByText("jangrakboss (장락반점 사장님)")).toBeInTheDocument();
    expect(server.db.findUser("jangrakboss")).toMatchObject({ role: "owner", storeId: "c1" });

    fill({ 아이디: "jangrakboss", 비밀번호: "password1" });
    await click("계정 만들기");
    expect(await screen.findByRole("alert")).toHaveTextContent("이미 있는 아이디예요");

    await click("jangrakboss 삭제");
    await waitFor(() => expect(server.db.findUser("jangrakboss")).toBeNull());
  });

  it("통계 탭은 건수와 매출을, 사용자 탭은 가입한 고객님을 보여 준다", async () => {
    server.createAccount(admin);
    server.createAccount({ ...KIM, email: "kim@example.com" });
    seedOrder(KIM, chicken, 2);
    await loginAs("adminuser");
    open("#/admin");
    fireEvent.click(await screen.findByRole("tab", { name: "통계" }));
    expect(await screen.findByText("40,000원")).toBeInTheDocument();
    expect(screen.getAllByText("1건").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("tab", { name: "사용자" }));
    expect(await screen.findByText("kim@example.com")).toBeInTheDocument();
    expect(screen.getByText("customer01")).toBeInTheDocument();
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
    expect(screen.getByText(/2026년 10월 10일부터 적용돼요/)).toBeInTheDocument();
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
