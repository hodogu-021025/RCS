// 쇼핑: 종류 → 상품 → (사이즈) → 수량 → 배송지 확인 → 주문서 → 결제.
// 상품·브랜드는 화면 확인용 가상 데이터다.
import { ADDRESS, squash, won, withSubjectParticle, withTopicParticle, type BotPrompt, type Choice, type Order } from "./orderChatKnowledge";

export type ShopCategoryKey = "clothes" | "shoes" | "toys" | "cosmetics" | "books";

export interface ShopCategory {
  key: ShopCategoryKey;
  label: string;
  keywords: string[];
  unit: string; // 수량 단위
  sizes?: string[]; // 고를 사이즈가 있는 종류만
}

export interface Product {
  id: string;
  category: ShopCategoryKey;
  name: string;
  brand: string;
  price: number;
  desc: string;
}

export const SHOP_CATEGORIES: ShopCategory[] = [
  { key: "clothes", label: "옷", unit: "벌", sizes: ["S", "M", "L", "XL"], keywords: ["옷", "의류", "티셔츠", "후드", "바지", "팬츠", "셔츠", "니트", "자켓"] },
  { key: "shoes", label: "신발", unit: "켤레", sizes: ["240", "250", "260", "270", "280"], keywords: ["신발", "운동화", "스니커즈", "러닝화", "구두", "부츠", "슬리퍼"] },
  { key: "toys", label: "장난감", unit: "개", keywords: ["장난감", "완구", "블록", "퍼즐", "인형"] },
  { key: "cosmetics", label: "화장품", unit: "개", keywords: ["화장품", "스킨", "토너", "로션", "선크림", "립", "크림"] },
  { key: "books", label: "책", unit: "권", keywords: ["책", "도서", "소설", "에세이", "만화"] },
];

export const PRODUCTS: Product[] = [
  { id: "c1", category: "clothes", name: "베이직 오버핏 후드티", brand: "온데일리", price: 39000, desc: "기모 안감 · 5가지 색" },
  { id: "c2", category: "clothes", name: "와이드 데님 팬츠", brand: "블루라인", price: 45000, desc: "세미 와이드 핏" },
  { id: "c3", category: "clothes", name: "코튼 옥스포드 셔츠", brand: "모노웨어", price: 32000, desc: "구김 적은 면 100%" },
  { id: "s1", category: "shoes", name: "클래식 캔버스 스니커즈", brand: "런앤워크", price: 49000, desc: "가벼운 데일리 운동화" },
  { id: "s2", category: "shoes", name: "에어플로우 러닝화", brand: "스텝업", price: 89000, desc: "쿠션 미드솔 · 통기성 메시" },
  { id: "s3", category: "shoes", name: "데일리 첼시 부츠", brand: "모노웨어", price: 79000, desc: "소가죽 · 사이드 밴딩" },
  { id: "t1", category: "toys", name: "원목 블록 100피스", brand: "토이숲", price: 29000, desc: "3세 이상 · 친환경 도료" },
  { id: "t2", category: "toys", name: "풍경 직소 퍼즐 1000피스", brand: "퍼즐하우스", price: 18000, desc: "완성 크기 50 × 75cm" },
  { id: "t3", category: "toys", name: "말랑 곰돌이 인형 30cm", brand: "포근토이", price: 22000, desc: "세탁기 사용 가능" },
  { id: "m1", category: "cosmetics", name: "수분 진정 토너 200ml", brand: "데일리그린", price: 18000, desc: "민감 피부용 · 무향" },
  { id: "m2", category: "cosmetics", name: "무기자차 선크림 SPF50+", brand: "선데이랩", price: 21000, desc: "백탁 적은 가벼운 제형" },
  { id: "m3", category: "cosmetics", name: "촉촉 립밤 3종 세트", brand: "데일리그린", price: 12000, desc: "무향 · 체리 · 피치" },
  { id: "b1", category: "books", name: "바다를 건너는 법", brand: "푸른숲길", price: 15000, desc: "장편소설 · 320쪽" },
  { id: "b2", category: "books", name: "하루 10분 파이썬", brand: "코드북스", price: 22000, desc: "입문서 · 예제 120개" },
  { id: "b3", category: "books", name: "작은 정원 에세이", brand: "봄날출판", price: 13800, desc: "에세이 · 그림 수록" },
];

// 3만원 이상이면 배송비 무료
export const SHIPPING_FEE = 3000;
export const FREE_SHIPPING_OVER = 30000;
export const MAX_SHOP_QTY = 10;

export const categoryOf = (p: Product) => SHOP_CATEGORIES.find((c) => c.key === p.category)!;

export function matchShopCategory(text: string): ShopCategory | undefined {
  const low = text.toLowerCase();
  return SHOP_CATEGORIES.find((c) => c.keywords.some((k) => low.includes(k)));
}

export const productsOf = (key: ShopCategoryKey) => PRODUCTS.filter((p) => p.category === key);

// 목록 버튼을 누르거나 상품 이름을 입력하면 고른 것으로 본다 (띄어쓰기는 무시)
export function findProduct(text: string, list: Product[]): Product | undefined {
  const typed = squash(text);
  return list.find((p) => typed.includes(squash(p.name)));
}

// 사이즈는 버튼 글자 그대로("M", "260") 오거나 문장 속에 들어 있어도 찾는다
// 음성 인식은 "엠", "엑스엘" 처럼 소리 나는 대로 적어 주므로 글자로 바꿔 준다 (긴 말부터 바꿔야 "엑스엘"이 "엘"로 깨지지 않는다)
const SPOKEN_SIZES: [string, string][] = [
  ["엑스라지", "XL"], ["엑스엘", "XL"], ["라지", "L"], ["미디엄", "M"], ["스몰", "S"], ["에스", "S"], ["엠", "M"], ["엘", "L"],
];

export function findSize(text: string, sizes: string[]): string | undefined {
  let typed = squash(text).toUpperCase();
  for (const [spoken, letter] of SPOKEN_SIZES) typed = typed.replaceAll(spoken, letter);
  return sizes.find((s) => typed === s || new RegExp(`(^|[^0-9A-Z])${s}([^0-9A-Z]|$)`).test(typed));
}

export const SHOP_PROMPT: BotPrompt = {
  text: "어떤 상품을 찾으세요?\n말씀해 주시면 인기 상품을 추천해 드릴게요.",
  say: `어떤 상품을 찾으세요? ${SHOP_CATEGORIES.map((c) => c.label).join(", ")} 모두 있어요. 찾으시는 걸 말씀해 주시면 인기 상품을 추천해 드릴게요!`,
  choices: SHOP_CATEGORIES.map((c): Choice => ({ label: c.label, value: c.label })),
  placeholder: "예) 운동화",
};

export function sizePrompt(product: Product, lead?: string): BotPrompt {
  const sizes = categoryOf(product).sizes ?? [];
  const head = lead ?? `${product.name} (${won(product.price)})`;
  return {
    text: `${head}\n사이즈를 골라 주세요.`,
    say: `${head} 사이즈는 ${withSubjectParticle(sizes.join(", "))} 있어요. 어떤 사이즈로 드릴까요?`,
    choices: sizes.map((s) => ({ label: s, value: s })),
    noDirect: true,
  };
}

export function shopQuantityQuestion(product: Product, size?: string): string {
  const name = size ? `${product.name} ${size}` : product.name;
  return `${withTopicParticle(name)} 1${categoryOf(product).unit}에 ${won(product.price)}이에요.\n몇 ${categoryOf(product).unit} 주문할까요?`;
}

export function addressPrompt(address: string, lead?: string): BotPrompt {
  return {
    text: `${lead ? `${lead}\n` : ""}배송지를 확인해 주세요.\n${address}`,
    say: `${lead ? `${lead} ` : ""}배송지는 ${address}, 이 주소로 보내 드릴까요? 다른 곳에서 받으시려면 주소를 말씀해 주세요.`,
    choices: [{ label: "이 주소로 받기", value: "이 주소로 받을게요" }],
    directLabel: "다른 주소 입력",
    placeholder: "새 배송지 주소를 입력하세요",
  };
}

export const keepsAddress = (text: string) => text.includes("이 주소") || text.includes("그대로");

// 시·군·구·동·읍·면·리·로·길 중 하나가 들어간 6자 이상이면 주소로 본다
export const looksLikeAddress = (text: string) => text.trim().length >= 6 && /[가-힣0-9](시|군|구|동|읍|면|리|로|길)(\s|\d|$)/.test(text);

export function shippingFeeFor(subtotal: number) {
  return subtotal >= FREE_SHIPPING_OVER ? 0 : SHIPPING_FEE;
}

export function makeShopOrder(product: Product, size: string | undefined, qty: number, address = ADDRESS): Order {
  const subtotal = product.price * qty;
  const fee = shippingFeeFor(subtotal);
  return {
    kind: "shop",
    store: { name: product.brand },
    storeId: `brand:${product.brand}`,
    item: product.name,
    option: size,
    qty,
    unit: categoryOf(product).unit,
    price: subtotal + fee,
    shippingFee: fee,
    address,
  };
}
