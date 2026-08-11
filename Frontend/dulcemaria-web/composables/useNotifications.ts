import { ref, onMounted, onUnmounted } from 'vue'
import { useApi } from './useApi'

export interface NotificationOrder {
  id: string
  order_no: string
  status: string
  total_clp: number
  created_at: string
  customer_name: string
  customer_phone: string
}

export interface NotificationCakeOrder {
  id: string
  order_number: string
  status: string
  total_price_clp: number
  created_at: string
  customer_name: string
  customer_phone: string
}

export interface NotificationState {
  ok: boolean
  orders: NotificationOrder[]
  cake_orders: NotificationCakeOrder[]
  total: number
}

interface TypedOrder extends NotificationOrder {
  _type: 'order'
}

interface TypedCakeOrder extends NotificationCakeOrder {
  _type: 'cake'
}

type TypedNotification = TypedOrder | TypedCakeOrder

export const useNotifications = () => {
  const { get } = useApi()
  const notifications = ref<NotificationState | null>(null)
  const dismissedIds = ref<Set<string>>(new Set())
  const showToast = ref(false)
  const toastOrder = ref<NotificationOrder | NotificationCakeOrder | null>(null)
  const isCakeOrder = ref(false)
  let pollInterval: ReturnType<typeof setInterval> | null = null
  let soundInterval: ReturnType<typeof setInterval> | null = null
  let audioContext: AudioContext | null = null

  const initAudio = () => {
    if (!audioContext) {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
    }
  }

  const playBeep = () => {
    try {
      initAudio()
      if (!audioContext) return
      const osc = audioContext.createOscillator()
      const gain = audioContext.createGain()
      osc.connect(gain)
      gain.connect(audioContext.destination)
      osc.frequency.value = 880
      osc.type = 'sine'
      gain.gain.setValueAtTime(0.3, audioContext.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3)
      osc.start(audioContext.currentTime)
      osc.stop(audioContext.currentTime + 0.3)

      // Second beep
      const osc2 = audioContext.createOscillator()
      const gain2 = audioContext.createGain()
      osc2.connect(gain2)
      gain2.connect(audioContext.destination)
      osc2.frequency.value = 880
      osc2.type = 'sine'
      gain2.gain.setValueAtTime(0.3, audioContext.currentTime + 0.4)
      gain2.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.7)
      osc2.start(audioContext.currentTime + 0.4)
      osc2.stop(audioContext.currentTime + 0.7)
    } catch (e) {
      console.error('Error playing notification sound:', e)
    }
  }

  const fetchNotifications = async () => {
    try {
      const data = await get<NotificationState>('/admin/orders/pending-notifications')
      if (data.ok) {
        notifications.value = data

        // Find first non-dismissed order
        const allOrders: TypedNotification[] = [
          ...(data.orders || []).map((o: NotificationOrder) => ({ ...o, _type: 'order' as const })),
          ...(data.cake_orders || []).map((o: NotificationCakeOrder) => ({ ...o, _type: 'cake' as const }))
        ]

        const pending = allOrders.find(o => !dismissedIds.value.has(`${o._type}-${o.id}`))
        if (pending && pending._type === 'order') {
          toastOrder.value = pending as unknown as NotificationOrder
          isCakeOrder.value = false
          showToast.value = true
        } else if (pending && pending._type === 'cake') {
          toastOrder.value = pending as unknown as NotificationCakeOrder
          isCakeOrder.value = true
          showToast.value = true
        } else {
          showToast.value = false
          toastOrder.value = null
        }
      }
    } catch (e) {
      console.error('Error fetching notifications:', e)
    }
  }

  const dismissNotification = (id: string) => {
    const key = `${isCakeOrder.value ? 'cake' : 'order'}-${id}`
    dismissedIds.value.add(key)
    showToast.value = false
    toastOrder.value = null
    // After dismissing, check if there are more pending notifications
    setTimeout(() => fetchNotifications(), 500)
  }

  const startPolling = () => {
    if (typeof window !== 'undefined') {
      fetchNotifications()
      pollInterval = setInterval(fetchNotifications, 30000)
      // Sound alert every 2 minutes if there's a pending notification
      soundInterval = setInterval(() => {
        if (showToast.value && toastOrder.value) {
          playBeep()
        }
      }, 120000)
    }
  }

  const stopPolling = () => {
    if (pollInterval) {
      clearInterval(pollInterval)
      pollInterval = null
    }
    if (soundInterval) {
      clearInterval(soundInterval)
      soundInterval = null
    }
  }

  onMounted(() => {
    startPolling()
  })

  onUnmounted(() => {
    stopPolling()
  })

  return {
    notifications,
    showToast,
    toastOrder,
    isCakeOrder,
    dismissNotification,
    fetchNotifications,
    startPolling,
    stopPolling,
    playBeep
  }
}
