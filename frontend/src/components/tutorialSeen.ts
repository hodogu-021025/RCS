// 사용법 안내(Tutorial)를 이 브라우저에서 이미 봤는지. 다 보거나 닫으면 다음부터는 처음에 띄우지 않는다
const SEEN_KEY = "saylo.tutorialSeen";

export function tutorialSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false; // 저장소가 막힌 브라우저면 매번 보여 준다
  }
}

export function markTutorialSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // 저장이 막혀도 이번에는 닫힌다
  }
}
