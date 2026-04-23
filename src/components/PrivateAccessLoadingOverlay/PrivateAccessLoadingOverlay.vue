<template>
  <section
    class="private-access-loading panel-card"
    :class="`is-${state}`"
    role="status"
    aria-live="polite"
    :aria-busy="String(state === 'checking')"
  >
    <div class="private-access-loading__visual" aria-hidden="true">
      <span class="private-access-loading__halo private-access-loading__halo--outer"></span>
      <span class="private-access-loading__halo private-access-loading__halo--middle"></span>
      <span class="private-access-loading__halo private-access-loading__halo--inner"></span>
      <span class="private-access-loading__core">
        <span></span>
        <span></span>
        <span></span>
      </span>
    </div>

    <div class="private-access-loading__content">
      <p class="private-access-loading__eyebrow">{{ eyebrow }}</p>
      <h1>{{ title }}</h1>
      <p class="private-access-loading__copy">{{ copy }}</p>
      <div v-if="state === 'checking'" class="private-access-loading__meter" aria-hidden="true">
        <span></span>
      </div>
      <p v-else class="private-access-loading__hint">请连接 Tailscale 后重试</p>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  state: {
    type: String,
    default: 'checking'
  }
})

const isDenied = computed(() => props.state === 'denied')
const eyebrow = computed(() => (isDenied.value ? 'Private Network Only' : 'Private Network Relay'))
const title = computed(() => (isDenied.value ? '当前页面无法访问' : '正在连接私有网络'))
const copy = computed(() =>
  isDenied.value
    ? '当前设备尚未通过私有网络访问此页面，因此无法继续打开 Agent。'
    : '正在验证当前设备是否已接入 Tailscale，请稍候片刻。'
)
</script>

<style scoped>
.private-access-loading {
  width: min(560px, 100%);
  margin: 0 auto;
  padding: 34px 30px 30px;
  border-radius: 30px;
  text-align: center;
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(circle at top, rgba(138, 226, 255, 0.3), transparent 42%),
    linear-gradient(160deg, rgba(255, 255, 255, 0.9), rgba(228, 247, 255, 0.82));
}

.private-access-loading::before {
  content: "";
  position: absolute;
  inset: 14px;
  border-radius: 24px;
  border: 1px solid rgba(79, 165, 220, 0.18);
  pointer-events: none;
}

.private-access-loading__visual {
  position: relative;
  width: 168px;
  height: 168px;
  margin: 0 auto 18px;
  display: grid;
  place-items: center;
}

.private-access-loading__halo {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1px solid rgba(58, 149, 213, 0.2);
  background: radial-gradient(circle, rgba(110, 208, 255, 0.16), transparent 68%);
}

.private-access-loading__halo--outer {
  animation: loading-orbit 4.2s linear infinite;
}

.private-access-loading__halo--middle {
  inset: 16px;
  animation: loading-orbit-reverse 3.4s linear infinite;
}

.private-access-loading__halo--inner {
  inset: 34px;
  animation: loading-pulse 1.9s ease-in-out infinite;
}

.private-access-loading__core {
  position: relative;
  width: 74px;
  height: 74px;
  border-radius: 24px;
  background: linear-gradient(150deg, #2f8cff, #72d6ff);
  box-shadow:
    0 18px 36px rgba(56, 146, 208, 0.28),
    inset 0 1px 0 rgba(255, 255, 255, 0.38);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.private-access-loading__core span {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  animation: loading-dots 1.2s ease-in-out infinite;
}

.private-access-loading__core span:nth-child(2) {
  animation-delay: 0.14s;
}

.private-access-loading__core span:nth-child(3) {
  animation-delay: 0.28s;
}

.private-access-loading.is-denied .private-access-loading__halo--outer,
.private-access-loading.is-denied .private-access-loading__halo--middle,
.private-access-loading.is-denied .private-access-loading__halo--inner {
  animation-duration: 6s;
}

.private-access-loading.is-denied .private-access-loading__core {
  background: linear-gradient(150deg, #5d9ecf, #97d7f2);
  box-shadow:
    0 18px 36px rgba(70, 132, 182, 0.22),
    inset 0 1px 0 rgba(255, 255, 255, 0.38);
}

.private-access-loading__content {
  position: relative;
  z-index: 1;
}

.private-access-loading__eyebrow {
  margin: 0 0 10px;
  color: #2f8bcc;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.private-access-loading h1 {
  margin: 0;
  color: #14344f;
  font-size: clamp(2rem, 4vw, 2.7rem);
  line-height: 1.06;
}

.private-access-loading__copy {
  width: min(360px, 100%);
  margin: 14px auto 0;
  color: #55748e;
  font-size: 1rem;
}

.private-access-loading__meter {
  width: min(280px, 100%);
  height: 8px;
  margin: 22px auto 0;
  padding: 1px;
  border-radius: 999px;
  background: rgba(87, 157, 207, 0.14);
  overflow: hidden;
}

.private-access-loading__meter span {
  display: block;
  width: 42%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #2f89ff, #7ad8ff);
  animation: loading-meter 1.8s ease-in-out infinite;
}

.private-access-loading__hint {
  margin: 20px 0 0;
  color: #2f86c2;
  font-size: 0.96rem;
  font-weight: 600;
  letter-spacing: 0.04em;
}

@keyframes loading-orbit {
  from {
    transform: rotate(0deg) scale(1);
  }

  50% {
    transform: rotate(180deg) scale(1.04);
  }

  to {
    transform: rotate(360deg) scale(1);
  }
}

@keyframes loading-orbit-reverse {
  from {
    transform: rotate(360deg) scale(0.98);
  }

  50% {
    transform: rotate(180deg) scale(1.03);
  }

  to {
    transform: rotate(0deg) scale(0.98);
  }
}

@keyframes loading-pulse {
  0%,
  100% {
    transform: scale(0.96);
    opacity: 0.58;
  }

  50% {
    transform: scale(1.04);
    opacity: 0.92;
  }
}

@keyframes loading-dots {
  0%,
  80%,
  100% {
    transform: translateY(0);
    opacity: 0.6;
  }

  40% {
    transform: translateY(-5px);
    opacity: 1;
  }
}

@keyframes loading-meter {
  0% {
    transform: translateX(-130%);
  }

  100% {
    transform: translateX(320%);
  }
}

@media (max-width: 640px) {
  .private-access-loading {
    padding: 28px 22px 24px;
    border-radius: 24px;
  }

  .private-access-loading__visual {
    width: 144px;
    height: 144px;
    margin-bottom: 14px;
  }

  .private-access-loading__core {
    width: 66px;
    height: 66px;
    border-radius: 22px;
  }
}
</style>
