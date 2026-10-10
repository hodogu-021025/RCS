import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './dashboard.css'
import App from './App.tsx'
import { restoreSession } from './auth/auth'
import { followVisualViewport } from './viewport'

// 저장된 로그인 토큰이 있으면 서버에 물어 세션을 되살린다 (응답 전에는 로그인 화면으로 보내지 않는다)
void restoreSession()

// 휴대폰 키보드가 올라오면 앱 높이를 키보드 위 영역에 맞춘다 (가운데 자막이 가려지지 않게)
followVisualViewport()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
