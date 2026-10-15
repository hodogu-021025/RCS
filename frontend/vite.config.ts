import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// 테스트는 실제 가게 목록(server/catalog.json) 대신 예시 가게가 여러 곳 든 고정 목록을 쓴다.
// 화면 코드가 읽는 목록과 테스트 서버(server/stores.mjs, SAYLO_CATALOG)가 읽는 목록을 같은 파일로 맞춘다
const testCatalog = fileURLToPath(new URL('../server/test/catalog.fixture.json', import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // 개발 중에는 이메일 인증 API(server/, :3001)로 넘긴다. 배포에서는 nginx 가 같은 일을 한다
  server: {
    proxy: { '/api': 'http://localhost:3001' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    alias: [{ find: /^(\.\.\/)+server\/catalog\.json$/, replacement: testCatalog }],
    env: { SAYLO_CATALOG: testCatalog },
  },
})
