import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'  // 设计令牌（P0-A 集中管理）
import './index.css'
import App from './App.tsx'
import { GameScreen } from './features/game/GameScreen.tsx'
import './features/game/GameScreen.css'
// TEMP SKIN (review only) — Apple-system pass. Delete this import line and
// src/styles/temp-apple-skin.css to revert entirely.
import './styles/temp-apple-skin.css'

const nightOpen = new URLSearchParams(window.location.search).get('night') === '1'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {nightOpen ? <GameScreen /> : <App />}
  </StrictMode>,
)
