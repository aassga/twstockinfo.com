<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { IconRefresh } from '@tabler/icons-vue';

const props = defineProps({
  intervalMs: {
    type: Number,
    default: 10000
  },
  loading: {
    type: Boolean,
    default: false
  },
  enabled: {
    type: Boolean,
    default: true
  },
  resetKey: {
    type: [Number, String],
    default: 0
  },
  label: {
    type: String,
    default: '重新整理'
  }
});

const emit = defineEmits(['refresh']);

const remainingMs = ref(props.intervalMs);
let timer = null;
let targetAt = 0;

const seconds = computed(() => Math.max(0, Math.ceil(remainingMs.value / 1000)));
const statusText = computed(() => {
  if (!props.enabled) return '暫停';
  if (props.loading) return '更新中';
  return seconds.value;
});

watch(() => props.intervalMs, resetCountdown);
watch(() => props.resetKey, resetCountdown);
watch(() => props.enabled, enabled => {
  if (enabled) resetCountdown();
});
watch(() => props.loading, loading => {
  if (!loading) resetCountdown();
});

onMounted(() => {
  resetCountdown();
  timer = window.setInterval(tick, 250);
  document.addEventListener('visibilitychange', handleVisibilityChange);
});

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
});

function resetCountdown() {
  remainingMs.value = props.intervalMs;
  targetAt = Date.now() + props.intervalMs;
}

function tick() {
  if (!props.enabled || props.loading || document.hidden) return;

  remainingMs.value = Math.max(0, targetAt - Date.now());
  if (remainingMs.value > 0) return;

  emit('refresh', { manual: false });
  resetCountdown();
}

function handleManualRefresh() {
  if (!props.enabled || props.loading) return;
  emit('refresh', { manual: true });
  resetCountdown();
}

function handleVisibilityChange() {
  if (!document.hidden) resetCountdown();
}
</script>

<template>
  <button
    class="btn auto-refresh-countdown"
    :class="{ 'is-refreshing': loading, 'is-paused': !enabled }"
    type="button"
    :disabled="loading || !enabled"
    @click="handleManualRefresh"
  >
    <IconRefresh class="btn-icon" :stroke-width="2" />
    <span>{{ label }}</span>
    <em>{{ statusText }}</em>
  </button>
</template>
