/**
 * LocalStorage Persistence Hooks (P0-E)
 *
 * 用法：
 *   const [character, setCharacter] = usePersistedState<CharacterId>('character', 'walter')
 *   const [relations, setRelations] = useDebouncedPersistedState('relations', {}, 500)
 *
 * 自动加 abq_ 前缀。失败静默（console.warn），不阻塞 UI。
 */

import { useEffect, useRef, useState } from 'react'

const PREFIX = 'abq_'

function readFromStorage<T>(fullKey: string, initialValue: T): T {
  if (typeof window === 'undefined') return initialValue
  try {
    const stored = window.localStorage.getItem(fullKey)
    if (stored === null) return initialValue
    return JSON.parse(stored) as T
  } catch (err) {
    console.warn(`[persistedState] Failed to read ${fullKey}:`, err)
    return initialValue
  }
}

function writeToStorage<T>(fullKey: string, value: T): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(fullKey, JSON.stringify(value))
  } catch (err) {
    console.warn(`[persistedState] Failed to write ${fullKey}:`, err)
  }
}

export function usePersistedState<T>(
  key: string,
  initialValue: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const fullKey = PREFIX + key
  const [state, setState] = useState<T>(() => readFromStorage(fullKey, initialValue))
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      writeToStorage(fullKey, state)
    }, 300)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [fullKey, state])

  return [state, setState]
}

/**
 * 带 debounce 写入的版本（用于关系状态等频繁更新的数据）
 */
export function useDebouncedPersistedState<T>(
  key: string,
  initialValue: T,
  delay: number = 500,
): [T, (value: T | ((prev: T) => T)) => void] {
  const fullKey = PREFIX + key
  const [state, setState] = useState<T>(() => readFromStorage(fullKey, initialValue))
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      writeToStorage(fullKey, state)
    }, delay)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [fullKey, state, delay])

  return [state, setState]
}

/**
 * 清理某个 key 的持久化数据
 */
export function clearPersistedState(key: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(PREFIX + key)
  } catch (err) {
    console.warn(`[persistedState] Failed to clear ${key}:`, err)
  }
}
