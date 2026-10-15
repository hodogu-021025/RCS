// 사장님 화면의 "맛 고르기" 편집 칸에서 쓰는 값과 검사. 서버(server/stores.mjs 의 cleanChoice)와 같은 규칙·문장으로 미리 검사하고,
// 서버가 한 번 더 검사한다
import { withObjectParticle, withTopicParticle, type MenuChoice } from "../components/orderChatKnowledge";

export const CHOICE_OPTIONS_MAX = 40;
export const CHOICE_COUNT_MAX = 10;
export const CHOICE_EXTRA_MAX = 100_000;
export const CHOICE_LABEL_MAX = 10;
export const CHOICE_NAME_MAX = 30;

// 입력 칸 그대로의 값 (적는 동안은 문자열). key 는 줄을 빼도 다른 줄의 입력이 섞이지 않게 붙이는 번호
export interface ChoiceRow {
  key: number;
  name: string;
  extra: string;
}
export interface ChoiceDraft {
  label: string;
  count: string;
  options: ChoiceRow[];
}

let nextKey = 1;
export const newRow = (name = "", extra = ""): ChoiceRow => ({ key: nextKey++, name, extra });

// 새로 만들 때: 맛 2가지 고르기, 빈 줄 두 개
export const emptyDraft = (): ChoiceDraft => ({ label: "맛", count: "2", options: [newRow(), newRow()] });

export const draftFromChoice = (choice: MenuChoice): ChoiceDraft => ({
  label: choice.label,
  count: String(choice.count),
  options: choice.options.map((o) => newRow(o.name, o.extra ? String(o.extra) : "")),
});

const squashSpaces = (s: string) => s.trim().replace(/\s+/g, " ");

// 적은 값을 서버에 보낼 맛 고르기로. 이름과 추가금이 모두 빈 줄은 없는 것으로 본다. 문제가 있으면 { error }
export function choiceFromDraft(draft: ChoiceDraft): { choice: MenuChoice } | { error: string } {
  const label = squashSpaces(draft.label) || "맛";
  const count = Number(draft.count);
  const rows = draft.options.filter((o) => o.name.trim() || o.extra.trim());
  const options = rows.map((o) => ({ name: squashSpaces(o.name), extra: o.extra.trim() === "" ? 0 : Number(o.extra.replace(/,/g, "")) }));
  if (label.length > CHOICE_LABEL_MAX) return { error: `고르기 이름은 ${CHOICE_LABEL_MAX}자까지 적을 수 있어요.` };
  if (!Number.isInteger(count) || count < 1 || count > CHOICE_COUNT_MAX) return { error: `1세트에 고를 수는 1~${CHOICE_COUNT_MAX} 사이로 적어 주세요.` };
  if (options.length > CHOICE_OPTIONS_MAX) return { error: `${withTopicParticle(label)} ${CHOICE_OPTIONS_MAX}가지까지 적을 수 있어요.` };
  if (options.length < count) return { error: `${withObjectParticle(label)} 고를 수(${count}가지)만큼은 적어 주세요.` };
  if (options.some((o) => !o.name || o.name.length > CHOICE_NAME_MAX)) return { error: `${label} 이름을 1~${CHOICE_NAME_MAX}자로 적어 주세요.` };
  if (new Set(options.map((o) => o.name)).size !== options.length) return { error: `같은 ${label} 이름이 두 번 있어요.` };
  if (options.some((o) => !Number.isInteger(o.extra) || o.extra < 0 || o.extra > CHOICE_EXTRA_MAX)) {
    return { error: `추가금은 0~${CHOICE_EXTRA_MAX.toLocaleString("ko-KR")}원 사이 정수로 적어 주세요.` };
  }
  return { choice: { label, count, options } };
}

// "여러 개 한 번에 넣기": 쉼표나 줄바꿈으로 나눈 이름들. 이름 뒤에 "+1000" 처럼 적으면 추가금
// 예) "간장 파닭, 양념 파닭\n블랙스완 파닭 +1,000"
export function parseBulk(text: string): ChoiceRow[] {
  return text
    // (쉼표 뒤에 숫자 세 자리가 오면 금액의 천 단위 쉼표로 보고 자르지 않는다: "+2,000")
    .split(/\n|[,，、](?!\d{3}(?!\d))/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = /^(.*?)\s*\+\s*([\d,]+)\s*원?$/.exec(part);
      return m ? newRow(squashSpaces(m[1]), m[2].replace(/,/g, "")) : newRow(squashSpaces(part));
    })
    .filter((row) => row.name);
}

// 메뉴 카드의 한 줄 요약: "맛 2가지 고르기 · 23가지 중"
export const choiceSummary = (choice: MenuChoice) => `${choice.label} ${choice.count}가지 고르기 · ${choice.options.length}가지 중`;
