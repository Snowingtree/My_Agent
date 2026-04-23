import { onMounted, ref } from 'vue'
import {
  detectPrivateAppReachability,
  isPrivateAppHost,
  resolvePrivateAppUrl,
  setRuntimePrivateAppAccess
} from '../utils/privateAccess.js'

export function usePrivateAppAccess() {
  const privateAppAvailable = ref(isPrivateAppHost())
  const privateAppChecking = ref(!privateAppAvailable.value)

  onMounted(async () => {
    const isCurrentHostPrivate = isPrivateAppHost()

    if (privateAppAvailable.value) {
      setRuntimePrivateAppAccess(true)
      privateAppChecking.value = false
      return
    }

    setRuntimePrivateAppAccess(false)
    const reachable = await detectPrivateAppReachability()

    if (
      reachable
      && !isCurrentHostPrivate
      && typeof window !== 'undefined'
    ) {
      const nextLocation = `${window.location.pathname}${window.location.search}${window.location.hash}`
      window.location.replace(resolvePrivateAppUrl(nextLocation))
      return
    }

    privateAppAvailable.value = reachable
    privateAppChecking.value = false
  })

  return {
    privateAppAvailable,
    privateAppChecking
  }
}
