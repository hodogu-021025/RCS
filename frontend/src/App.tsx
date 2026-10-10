import { Suspense } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { OrderChatbot } from "./components/OrderChatbot";
import { RequireRole } from "./pages/RequireRole";
import { AccountPage, AdminPage, LoginPage, MyOrdersPage, OwnerPage, PrivacyPage, ResetPasswordPage, SignupPage } from "./pages/routes";

// 화면을 받아 오는 동안 잠깐 보이는 빈 틀 (휴대폰 폭 카드 모양을 유지해 화면이 튀지 않게)
const PageLoading = () => <div className="dash dash-mobile" aria-busy="true" />;

// 주소는 #/owner 처럼 해시를 쓴다: 어떤 정적 호스팅이든, 파일을 바로 열어도(saylo.html) 동작한다
export default function App() {
  return (
    <HashRouter>
      <Suspense fallback={<PageLoading />}>
        <Routes>
          {/* 첫 화면은 로그인. 챗봇은 #/chat (로그인 없이도 열 수 있다) */}
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/chat" element={<OrderChatbot />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/reset" element={<ResetPasswordPage />} />
          <Route
            path="/me"
            element={
              <RequireRole roles={["user", "owner", "admin"]}>
                <MyOrdersPage />
              </RequireRole>
            }
          />
          <Route
            path="/account"
            element={
              <RequireRole roles={["user", "owner"]}>
                <AccountPage />
              </RequireRole>
            }
          />
          <Route
            path="/owner"
            element={
              <RequireRole roles={["owner"]}>
                <OwnerPage />
              </RequireRole>
            }
          />
          <Route
            path="/admin"
            element={
              <RequireRole roles={["admin"]}>
                <AdminPage />
              </RequireRole>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </HashRouter>
  );
}
