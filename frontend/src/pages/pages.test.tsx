import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { login, logout } from "../auth/auth";
import { DELIVERY_MENU, makeOrder } from "../components/orderChatKnowledge";
import { addOrder, addOwner, addReservation, getDb, removeOwner, resetDb, setMenuItem, setStoreHours } from "../data/db";

// App 은 해시 주소(#/owner)로 페이지를 고른다
function open(path: string) {
  window.location.hash = path;
  return render(<App />);
}

const chicken = DELIVERY_MENU.find((d) => d.name === "간장치킨")!;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  logout();
  resetDb();
  window.location.hash = "";
});

describe("로그인 페이지", () => {
  it("틀리면 안내가 뜨고, 사장님으로 맞게 로그인하면 사장님 페이지로 간다", () => {
    open("#/login");
    fireEvent.change(screen.getByLabelText("아이디"), { target: { value: "owner" } });
    fireEvent.change(screen.getByLabelText("비밀번호"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));
    expect(screen.getByRole("alert")).toHaveTextContent("맞지 않아요");

    fireEvent.click(screen.getByRole("button", { name: "사장님 · owner" })); // 데모 계정 버튼이 채워 준다
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));
    expect(window.location.hash).toBe("#/owner");
    expect(screen.getByText("청전 치킨공방 · 사장님")).toBeInTheDocument();
  });

  it("로그인 없이 사장님·관리자 페이지에 가면 로그인 페이지로 보낸다", () => {
    open("#/admin");
    expect(window.location.hash).toBe("#/login");
    expect(screen.getByRole("heading", { name: "로그인" })).toBeInTheDocument();
  });

  it("역할이 다른 페이지에 가면 안내만 보여 준다", () => {
    login("user", "1234");
    open("#/owner");
    expect(screen.getByText(/사장님 전용이에요/)).toBeInTheDocument();
  });

  it("관리자가 지운 사장님 계정은 로그인 상태였어도 로그인 페이지로 보낸다", () => {
    addOwner({ username: "jangrak", password: "pw1234", name: "장락반점 사장님", storeId: "c1" });
    login("jangrak", "pw1234");
    open("#/owner");
    expect(screen.getByText("장락반점 · 사장님")).toBeInTheDocument();

    act(() => removeOwner("jangrak"));
    expect(window.location.hash).toBe("#/login");
    expect(screen.getByRole("heading", { name: "로그인" })).toBeInTheDocument();
    expect(localStorage.getItem("saylo.session")).toBeNull();
  });
});

describe("사장님 페이지", () => {
  it("내 매장 주문만 보이고, 접수 → 준비 중 → 완료로 바꿀 수 있다", () => {
    addOrder(makeOrder(chicken, 2), "카카오페이", { username: "user", name: "김소비" });
    addOrder(makeOrder(DELIVERY_MENU.find((d) => d.name === "옛날통닭")!, 1), "토스페이"); // 다른 매장(h1)
    login("owner", "1234");
    open("#/owner");

    expect(screen.getByText("간장치킨 2마리")).toBeInTheDocument();
    expect(screen.queryByText(/옛날통닭/)).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /주문·예약/ })).toHaveTextContent("1"); // 접수 배지

    fireEvent.click(screen.getByRole("button", { name: "준비 시작" }));
    expect(getDb().orders.find((o) => o.order.item === "간장치킨")?.status).toBe("준비 중");
    fireEvent.click(screen.getByRole("button", { name: "배달 완료" }));
    expect(getDb().orders.find((o) => o.order.item === "간장치킨")?.status).toBe("완료");
  });

  it("새 주문이 들어오면 알림이 뜨고 잠시 뒤 사라진다", () => {
    login("owner", "1234");
    open("#/owner");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    act(() => {
      addOrder(makeOrder(chicken, 1), "신용카드");
    });
    expect(screen.getByRole("status")).toHaveTextContent("새 주문: 간장치킨 1마리");
    act(() => void vi.advanceTimersByTime(5000));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("매장·메뉴 탭에서 품절·가격·영업시간을 바꿀 수 있다", () => {
    login("owner", "1234");
    open("#/owner");
    fireEvent.click(screen.getByRole("tab", { name: "매장·메뉴" }));

    fireEvent.click(screen.getByRole("checkbox", { name: "품절" }));
    expect(getDb().storeSettings.h3.items?.d2?.soldOut).toBe(true);

    const price = screen.getByRole("spinbutton", { name: "간장치킨 가격" });
    fireEvent.change(price, { target: { value: "23000" } });
    fireEvent.blur(price);
    expect(getDb().storeSettings.h3.items?.d2?.price).toBe(23000);

    fireEvent.change(screen.getByLabelText("닫는 시간"), { target: { value: "23:00" } });
    expect(getDb().storeSettings.h3.hours).toBe("16:00 - 23:00");
  });

  it("자정(24:00)에 닫는 매장은 닫는 시간 칸에 00:00 으로 보인다", () => {
    addOwner({ username: "tongdak", password: "pw1234", name: "옛날통닭 사장님", storeId: "h1" }); // 15:00 - 24:00
    login("tongdak", "pw1234");
    open("#/owner");
    fireEvent.click(screen.getByRole("tab", { name: "매장·메뉴" }));
    expect(screen.getByLabelText("여는 시간")).toHaveValue("15:00");
    expect(screen.getByLabelText("닫는 시간")).toHaveValue("00:00");

    fireEvent.change(screen.getByLabelText("여는 시간"), { target: { value: "16:00" } });
    expect(getDb().storeSettings.h1.hours).toBe("16:00 - 00:00");
  });

  it("예약은 방문 완료로 바꿀 수 있다", () => {
    addReservation({ restaurantId: "h3", restaurantName: "청전 치킨공방", date: new Date(2026, 9, 10), time: "19:00", people: 3 });
    login("owner", "1234");
    open("#/owner");
    expect(screen.getByText(/10월 10일 \(토\) 19:00/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "방문 완료" }));
    expect(getDb().reservations[0].status).toBe("방문 완료");
  });
});

describe("관리자 페이지", () => {
  it("모든 주문·예약이 한 표에 보이고 종류로 거를 수 있다", () => {
    addOrder(makeOrder(chicken, 1), "토스페이");
    addReservation({ restaurantId: "c1", restaurantName: "장락반점", date: new Date(2026, 9, 10), time: "12:00", people: 2 });
    login("admin", "1234");
    open("#/admin");

    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(3); // 머리 + 2
    fireEvent.click(screen.getByRole("button", { name: "식당 예약" }));
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);
    expect(screen.getByText("장락반점")).toBeInTheDocument();
  });

  it("사장님 계정을 만들면 목록에 뜨고 그 계정으로 로그인할 수 있다", () => {
    setStoreHours("c1", "11:00 - 18:00"); // 사장님이 바꾼 영업시간이 표에 보인다
    login("admin", "1234");
    open("#/admin");
    fireEvent.click(screen.getByRole("tab", { name: "매장·사장님" }));
    expect(screen.getByText("11:00 - 18:00")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("아이디"), { target: { value: "jangrak" } });
    fireEvent.change(screen.getByLabelText("비밀번호"), { target: { value: "pw1234" } });
    fireEvent.change(screen.getByLabelText("매장"), { target: { value: "c1" } });
    fireEvent.click(screen.getByRole("button", { name: "계정 만들기" }));

    expect(screen.getByText("jangrak (장락반점 사장님)")).toBeInTheDocument();
    expect(login("jangrak", "pw1234")).toMatchObject({ storeId: "c1" });
  });

  it("통계 탭은 건수와 매출을 보여 준다", () => {
    addOrder(makeOrder(chicken, 2), "토스페이");
    login("admin", "1234");
    open("#/admin");
    fireEvent.click(screen.getByRole("tab", { name: "통계" }));
    expect(screen.getByText("40,000원")).toBeInTheDocument();
    expect(screen.getAllByText("1건").length).toBeGreaterThan(0); // 타일과 막대 모두에 나온다
  });
});

describe("내 주문 페이지", () => {
  it("로그인한 소비자의 주문만 보인다", () => {
    addOrder(makeOrder(chicken, 1), "토스페이", { username: "user", name: "김소비" });
    addOrder(makeOrder(chicken, 3), "토스페이"); // 비회원
    login("user", "1234");
    open("#/me");
    expect(screen.getAllByText("간장치킨 1마리").length).toBeGreaterThan(0); // 제목과 상세 칸
    expect(screen.queryAllByText("간장치킨 3마리")).toHaveLength(0);
  });
});

describe("챗봇과 연결", () => {
  it("품절된 메뉴는 챗봇 배달 버튼에서 빠진다", () => {
    setMenuItem("h3", "d2", { soldOut: true });
    open("#/");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "배달" } });
    fireEvent.click(screen.getByRole("button", { name: "Say 전송" }));
    act(() => void vi.advanceTimersByTime(700));
    expect(screen.getByRole("button", { name: "옛날통닭" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "간장치킨" })).not.toBeInTheDocument();
  });
});
