import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'  // 设计令牌（P0-A 集中管理）
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
