import { afterEach, describe, expect, it } from "vitest";
import { addOwner, getDb, removeOwner, resetDb } from "../data/db";
import { accountExists, allOwners, getSession, isEmailTaken, isUsernameTaken, login, logout, passwordError, signup, usernameError } from "./auth";

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

  const base = { password: "password1", passwordConfirm: "password1", email: "hong@example.com", emailVerified: true };

  it("회원가입한 아이디·이메일은 다른 가입·사장님 계정 만들기에서 다시 쓸 수 없다", () => {
    expect(signup({ ...base, role: "user", username: "hongildong", name: "홍길동", email: "Hong@Example.com" })).toHaveProperty("session");
    expect(getDb().users[0].email).toBe("hong@example.com"); // 소문자로 저장
    expect(isUsernameTaken("hongildong")).toBe(true);
    expect(usernameError("hongildong")).toBe("이미 있는 아이디예요.");
    expect(signup({ ...base, role: "owner", username: "hongildong", name: "홍", storeId: "c1" })).toEqual({ error: "이미 있는 아이디예요." });
    expect(isEmailTaken("HONG@example.com")).toBe(true);
    expect(signup({ ...base, role: "user", username: "another01", name: "다른 사람" })).toEqual({ error: "이미 가입된 이메일이에요." });
    expect(usernameError("한글아이디")).toMatch(/영문·숫자 8~20자/);
  });

  it("아이디는 8~20자, 비밀번호는 8자 이상이고, 이메일 인증을 마쳐야 가입된다", () => {
    expect(usernameError("short12")).toMatch(/8~20자/); // 7자
    expect(usernameError("abcdefgh")).toBeNull(); // 8자
    expect(usernameError("a".repeat(21))).toMatch(/8~20자/);
    expect(passwordError("1234567")).toBe("비밀번호는 8자 이상이어야 해요.");
    expect(passwordError("12345678")).toBeNull();
    expect(signup({ ...base, role: "user", username: "newuser01", name: "새 사람", emailVerified: false })).toEqual({ error: "이메일 인증을 마쳐 주세요." });
    expect(login("user", "1234")).toMatchObject({ role: "user" }); // 기본 계정은 예전 규칙 그대로 로그인된다
  });

  it("저장된 세션이 손상돼 있으면 로그인 안 된 것으로 본다", () => {
    localStorage.setItem("saylo.session", "{oops");
    expect(getSession()).toBeNull();
    localStorage.setItem("saylo.session", '"user"');
    expect(getSession()).toBeNull();
  });
});
