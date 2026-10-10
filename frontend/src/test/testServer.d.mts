// testServer.mjs 의 타입 (서버 코드는 JS 라서 테스트가 쓰는 만큼만 적는다)
export const TEST_CODE: string;

export interface TestAccount {
  username: string;
  password?: string;
  name?: string;
  role?: "user" | "owner" | "admin";
  storeId?: string;
  email?: string;
}

export interface TestDb {
  addOrder(rec: { customer: string; customerName: string; payment: string; storeId: string; order: object }): { id: string };
  addReservation(rec: { customer: string; customerName: string; restaurantId: string; restaurantName: string; date: string; time: string; people: number }): { id: string };
  orderById(id: string): { status: string } | null;
  reservationById(id: string): { status: string } | null;
  allStoreSettings(): Record<string, { hours?: string; items: Record<string, { price?: number; soldOut?: boolean }> }>;
  updateStoreSettings(storeId: string, patch: { hours?: string; item?: { id: string; patch: { price?: number; soldOut?: boolean } } }): object;
  deleteUser(username: string): boolean;
  findUser(username: string): { username: string; role: string; storeId?: string } | null;
}

export interface TestServer {
  base: string;
  db: TestDb;
  sent: { email: string; code: string }[];
  createAccount(account: TestAccount): { username: string };
  close(): Promise<void>;
}

export function startTestServer(): Promise<TestServer>;
