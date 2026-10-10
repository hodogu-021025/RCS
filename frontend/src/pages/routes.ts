import { lazy } from "react";

// 채팅 화면 말고 다른 화면들은 처음 열 때 같이 받지 않고, 그 화면에 갈 때 받는다 (채팅 첫 로딩을 가볍게).
// 테스트(pages.test.tsx)에서는 이 파일을 바로 받는 버전으로 바꿔 끼운다
const page = <T extends object, K extends keyof T>(load: () => Promise<T>, key: K) =>
  lazy(() => load().then((m) => ({ default: m[key] as React.ComponentType })));

export const LoginPage = page(() => import("./LoginPage"), "LoginPage");
export const SignupPage = page(() => import("./SignupPage"), "SignupPage");
export const MyOrdersPage = page(() => import("./MyOrdersPage"), "MyOrdersPage");
export const OwnerPage = page(() => import("./OwnerPage"), "OwnerPage");
export const AdminPage = page(() => import("./AdminPage"), "AdminPage");
export const AccountPage = page(() => import("./AccountPage"), "AccountPage");
export const PrivacyPage = page(() => import("./PrivacyPage"), "PrivacyPage");
