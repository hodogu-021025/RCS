import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { setApiBase, setToken } from "../api/client";
import { resetAuth } from "../auth/auth";
import { resetDb } from "../data/db";
import { startTestServer, type TestServer } from "./testServer.mjs";

export { TEST_CODE } from "./testServer.mjs";

// 테스트마다 API 서버(메모리 DB)를 새로 띄워서 서로 섞이지 않게 한다. 테스트는 `server` 로 계정·기록을 바로 넣을 수 있다
export let server: TestServer;

beforeEach(async () => {
  server = await startTestServer();
  setApiBase(server.base);
});

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
