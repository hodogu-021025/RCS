// 배달 연락처: 숫자만 남겨 한국 전화번호 모양(010-1234-5678, 02-123-4567)으로 맞춘다. 전화번호가 아니면 null.
// 화면(frontend/src/components/delivery.ts)도 같은 규칙으로 미리 검사한다
export function normalizePhone(raw) {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("82")) d = "0" + d.slice(2); // +82 10-…
  if (d.startsWith("02")) {
    if (d.length === 9) return `02-${d.slice(2, 5)}-${d.slice(5)}`;
    if (d.length === 10) return `02-${d.slice(2, 6)}-${d.slice(6)}`;
    return null;
  }
  if (!/^0\d+$/.test(d)) return null;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  return null;
}

export const ADDRESS_MIN = 5;
export const ADDRESS_MAX = 100;
