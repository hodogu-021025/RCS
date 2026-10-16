// testServer.mjs 의 타입 (서버 코드는 JS 라서 테스트가 쓰는 만큼만 적는다)
export const TEST_CODE: string;

export const TEST_BANK: { bank: string; account: string; holder: string };

export interface TestAccount {
  username: string;
  password?: string;
  name?: string;
  role?: "user" | "owner" | "admin";
  storeId?: string;
  email?: string;
  phone?: string;
  address?: string;
  approved?: boolean; // 사장님만: false 면 예전에 직접 가입해 승인을 기다리는 사장님
}

export interface TestDb {
  addOrder(rec: { customer: string; customerName: string; payment: string; storeId: string; order: object; status?: string }): { id: string };
  addReservation(rec: { customer: string; customerName: string; restaurantId: string; restaurantName: string; date: string; time: string; people: number }): { id: string };
  orderById(id: string): { status: string; order: { bank?: object; cancelNote?: string } } | null;
  listOrders(scope?: object): { id: string; status: string; payment: string; createdAt: number }[];
  setBankAccount(storeId: string, account: { bank: string; account: string; holder: string } | null): unknown;
  bankAccount(storeId: string): { bank: string; account: string; holder: string } | null;
  expireUnpaidOrders(cutoff: number): number;
  setOrderStatus(id: string, status: string): boolean;
  reservationById(id: string): { status: string } | null;
  allStoreSettings(): Record<string, { hours?: string; items: Record<string, { price?: number; soldOut?: boolean; discountPct?: number }>; special?: { itemId: string; date: string } }>;
  updateStoreSettings(
    storeId: string,
    patch: { hours?: string; item?: { id: string; patch: { price?: number; soldOut?: boolean; discountPct?: number } }; special?: { itemId: string; date: string } | null },
  ): object;
  deleteUser(username: string): boolean;
  findUser(username: string): { username: string; name: string; role: string; storeId?: string; phone?: string; address?: string } | null;
  // 관리자가 직접 만든 매장
  addStore(store: { name: string; food: string; hours: string; address?: string; signature?: string }): { id: string; name: string };
  storeById(id: string): { id: string; name: string; food: string; hours: string; address?: string; signature?: string; source: "admin" } | null;
  addMenuItem(item: { restaurantId: string; name: string; price: number; unit: string; keywords: string[]; choice?: { label: string; count: number; options: { name: string; extra: number }[] } }): { id: string };
  // 관리자에게 보낸 문의
  listInquiries(filter?: { username?: string }): { id: string; username: string; category: string; body: string; answer?: string }[];
}

export interface TestServer {
  base: string;
  db: TestDb;
  sent: { email: string; code: string }[];
  createAccount(account: TestAccount): { username: string };
  close(): Promise<void>;
}

export function startTestServer(): Promise<TestServer>;
