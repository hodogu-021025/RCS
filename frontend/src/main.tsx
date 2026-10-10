import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './dashboard.css'
import App from './App.tsx'
import { restoreSession } from './auth/auth'

// 저장된 로그인 토큰이 있으면 서버에 물어 세션을 되살린다 (응답 전에는 로그인 화면으로 보내지 않는다)
void restoreSession()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
