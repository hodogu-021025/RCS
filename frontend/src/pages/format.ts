// 페이지들이 함께 쓰는 날짜 표시
export const formatDateTime = (ms: number) => {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
