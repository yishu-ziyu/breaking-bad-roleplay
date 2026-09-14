import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'  // 设计令牌（P0-A 集中管理）
import './index.css'
import App from './App.tsx'
// TEMP SKIN (review only) — Apple-system pass. Delete this import line and
// src/styles/temp-apple-skin.css to revert entirely.
import './styles/temp-apple-skin.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
