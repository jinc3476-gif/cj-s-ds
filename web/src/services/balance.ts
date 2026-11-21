import { create } from 'zustand'
import { fetchUserBalance } from './api/client.js'
import type { UserBalanceResponse } from './api/types.js'
import { useSettings } from './settings.js'

type BalanceState = {
  apiKey: string | null
  data: UserBalanceResponse | null
  loading: boolean
  updatedAt: number
}

const STALE_MS = 20_000

export const useBalanceStore = create<BalanceState>(() => ({
  apiKey: null,
  data: null,
  loading: false,
  updatedAt: 0,
}))

let inflight: { apiKey: string; promise: Promise<UserBalanceResponse | null> } | null = null

export const formatCurrencySymbol = (currency: string) =>
  currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : `${currency} `

/** 选取最适合单行展示的主币种（优先 CNY，其次首个非零币种，否则首项） */
export const pickPrimaryBalance = (data: UserBalanceResponse | null) => {
  if (!data || data.balance_infos.length === 0) {
    return null
  }
  const cny = data.balance_infos.find((info) => info.currency === 'CNY')
  if (cny) {
    return cny
  }
  const nonZero = data.balance_infos.find((info) => Number(info.total_balance) > 0)
  return nonZero ?? data.balance_infos[0]
}

/** 查询并缓存 DeepSeek 账户余额；静默处理失败以便状态条无干扰展示。 */
export const refreshBalance = async (force = false): Promise<UserBalanceResponse | null> => {
  const apiKey = useSettings.getState().apiKey
  const current = useBalanceStore.getState()
  if (!apiKey) {
    if (current.apiKey !== null || current.data !== null || current.loading) {
      useBalanceStore.setState({ apiKey: null, data: null, loading: false, updatedAt: 0 })
    }
    return null
  }
  if (current.apiKey !== apiKey) {
    useBalanceStore.setState({ apiKey, data: null, loading: false, updatedAt: 0 })
  } else if (!force && current.data && Date.now() - current.updatedAt < STALE_MS) {
    return current.data
  }
  if (inflight && inflight.apiKey === apiKey) {
    return inflight.promise
  }
  useBalanceStore.setState({ apiKey, loading: true })
  const promise = fetchUserBalance(apiKey)
    .then((data) => {
      if (useSettings.getState().apiKey === apiKey) {
        useBalanceStore.setState({ apiKey, data, loading: false, updatedAt: Date.now() })
      }
      return data
    })
    .catch(() => {
      if (useSettings.getState().apiKey === apiKey) {
        useBalanceStore.setState({ loading: false })
      }
      return null
    })
    .finally(() => {
      if (inflight?.promise === promise) {
        inflight = null
      }
    })
  inflight = { apiKey, promise }
  return promise
}

useSettings.subscribe((state, previous) => {
  if (state.apiKey !== previous.apiKey) {
    useBalanceStore.setState({
      apiKey: state.apiKey,
      data: null,
      loading: false,
      updatedAt: 0,
    })
  }
})
