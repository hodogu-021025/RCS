// 관리자에게 문의 (서버 GET/POST /api/inquiries). 고객님·사장님은 자기 문의를, 관리자는 전부 받는다.
// 분류와 글자 수 규칙은 서버(server/app.mjs 의 INQUIRY_*)와 같다
import { useEffect, useState } from "react";
import { api } from "../api/client";

export const INQUIRY_CATEGORIES = ["주문·배달", "결제·환불", "가게·메뉴", "계정", "기타"] as const;
export const INQUIRY_BODY_MIN = 5;
export const INQUIRY_TEXT_MAX = 1000;

export interface Inquiry {
  id: string;
  createdAt: number;
  username: string;
  role: "user" | "owner";
  name: string;
  storeId?: string;
  category: string;
  body: string;
  answer?: string;
  answeredAt?: number;
}

export const fetchInquiries = () => api<Inquiry[]>("GET", "/api/inquiries");
export const sendInquiry = (input: { category: string; body: string }) => api<Inquiry>("POST", "/api/inquiries", input);
export const answerInquiry = (id: string, answer: string) => api<Inquiry>("POST", `/api/inquiries/${encodeURIComponent(id)}/answer`, { answer });

// 화면에서 쓰는 문의 목록: 처음 열 때 받고, 보내거나 답한 뒤 reload() 로 다시 받는다
export function useInquiries() {
  const [list, setList] = useState<Inquiry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    fetchInquiries()
      .then((l) => alive && (setList(l), setError(null)))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : "문의를 불러오지 못했어요."));
    return () => {
      alive = false;
    };
  }, [version]);
  return { list, error, reload: () => setVersion((v) => v + 1) };
}
