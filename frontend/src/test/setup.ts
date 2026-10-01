import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// globals: false로 두고 있어 Testing Library의 자동 cleanup이 걸리지 않으므로 직접 등록한다.
afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});
