import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { setApiBase, setToken } from "../api/client";
import { login, resetAuth } from "../auth/auth";
import { resetDb } from "../data/db";
import { startTestServer, type TestServer } from "./testServer.mjs";

export { TEST_BANK, TEST_CODE } from "./testServer.mjs";

// 테스트마다 API 서버(메모리 DB)를 새로 띄워서 서로 섞이지 않게 한다. 테스트는 `server` 로 계정·기록을 바로 넣을 수 있다
export let server: TestServer;

beforeEach(async () => {
  // 처음 열 때 뜨는 사용법 안내는 이미 본 것으로 둔다 (안내 자체는 Tutorial.test.tsx 에서 본다)
  localStorage.setItem("saylo.tutorialSeen", "1");
  server = await startTestServer();
  setApiBase(server.base);
});

// 배달 주문은 로그인한 고객님만 한다. 챗봇 테스트는 계정에 배달지·연락처가 있는 고객님으로 로그인해 시작한다
export const CUSTOMER = { username: "customer01", name: "김소비", phone: "010-1234-5678", address: "제천시 장락동 제천빌라 331호" };
export async function loginCustomer() {
  server.createAccount(CUSTOMER);
  const r = await login(CUSTOMER.username, "password1");
  if ("error" in r) throw new Error(r.error);
}

// globals: false로 두고 있어 Testing Library의 자동 cleanup이 걸리지 않으므로 직접 등록한다.
afterEach(async () => {
  cleanup();
  setToken(null);
  resetAuth();
  resetDb();
  localStorage.clear();
  sessionStorage.clear();
  await server.close();
});
