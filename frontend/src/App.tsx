import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { OrderChatbot } from "./components/OrderChatbot";
import { AdminPage } from "./pages/AdminPage";
import { LoginPage } from "./pages/LoginPage";
import { MyOrdersPage } from "./pages/MyOrdersPage";
import { OwnerPage } from "./pages/OwnerPage";
import { RequireRole } from "./pages/RequireRole";

// 주소는 #/owner 처럼 해시를 쓴다: 어떤 정적 호스팅이든, 파일을 바로 열어도(saylo.html) 동작한다
export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<OrderChatbot />} />
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/me"
          element={
            <RequireRole roles={["user", "owner", "admin"]}>
              <MyOrdersPage />
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
    </HashRouter>
  );
}
