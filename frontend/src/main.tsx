import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './dashboard.css'
import App from './App.tsx'
import { seedDemoData } from './data/db'
import { makeDemoRecords } from './data/seed'

// 처음 열면 사장님·관리자 화면용 보기 데이터를 넣는다 (이미 있으면 그대로)
seedDemoData(makeDemoRecords)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
