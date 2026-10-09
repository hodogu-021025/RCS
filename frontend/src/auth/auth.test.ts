import { afterEach, describe, expect, it } from "vitest";
import { addOwner, removeOwner, resetDb } from "../data/db";
import { accountExists, allOwners, getSession, isUsernameTaken, login, logout } from "./auth";

afterEach(resetDb);

describe("로그인", () => {
  it("데모 계정으로 로그인하면 역할·이름(·매장)이 든 세션이 남고, 로그아웃하면 사라진다", () => {
    expect(getSession()).toBeNull();
    expect(login("owner", "1234")).toMatchObject({ role: "owner", storeId: "h3" });
    expect(getSession()?.name).toBe("청전 치킨공방 사장님");
    logout();
    expect(getSession()).toBeNull();
  });

  it("아이디나 비밀번호가 틀리면 로그인되지 않는다", () => {
    expect(login("owner", "0000")).toBeNull();
    expect(login("nobody", "1234")).toBeNull();
    expect(getSession()).toBeNull();
  });

  it("관리자가 만든 사장님 계정으로도 로그인되고, 목록에서 데모 계정과 구분된다", () => {
    addOwner({ username: "jangrak", password: "pw1234", name: "장락반점 사장님", storeId: "c1" });
    expect(isUsernameTaken("jangrak")).toBe(true);
    expect(isUsernameTaken("admin")).toBe(true);
    expect(login("jangrak", "pw1234")).toMatchObject({ role: "owner", storeId: "c1", name: "장락반점 사장님" });
    expect(allOwners().map((o) => [o.username, o.builtIn])).toEqual([
      ["owner", true],
      ["jangrak", false],
    ]);
  });

  it("관리자가 지운 사장님 계정의 세션은 더 이상 유효하지 않다", () => {
    addOwner({ username: "jangrak", password: "pw1234", name: "장락반점 사장님", storeId: "c1" });
    const session = login("jangrak", "pw1234")!;
    expect(accountExists(session)).toBe(true);
    removeOwner("jangrak");
    expect(accountExists(session)).toBe(false);
    expect(accountExists(login("owner", "1234")!)).toBe(true);
  });

  it("저장된 세션이 손상돼 있으면 로그인 안 된 것으로 본다", () => {
    localStorage.setItem("saylo.session", "{oops");
    expect(getSession()).toBeNull();
    localStorage.setItem("saylo.session", '"user"');
    expect(getSession()).toBeNull();
  });
});
