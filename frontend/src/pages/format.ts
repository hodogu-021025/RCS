// 페이지들이 함께 쓰는 날짜 표시
export const formatDateTime = (ms: number) => {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// 상태 글자의 색 클래스. "준비 중"처럼 띄어 쓴 상태도 클래스 하나가 되게 띄어쓰기를 '-'로 바꾼다 ("s-준비-중")
export const statusClass = (status: string) => "status s-" + status.replace(/\s+/g, "-");
