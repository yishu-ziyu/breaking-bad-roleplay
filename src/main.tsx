import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'  // 设计令牌（P0-A 集中管理）
import './index.css'
import App from './App.tsx'
import GameKernelApp from './game/GameKernelApp.tsx'

const useLegacyLab = new URLSearchParams(window.location.search).has('legacy')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {useLegacyLab ? <App /> : <GameKernelApp />}
  </StrictMode>,
)
