<script setup>
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconClock,
  IconInfoCircle
} from '@tabler/icons-vue';
import SourceBadge from './SourceBadge.vue';

defineProps({
  items: {
    type: Array,
    default: () => []
  }
});

function statusIcon(status) {
  if (status === 'done') return IconCircleCheck;
  if (status === 'loading') return IconClock;
  if (status === 'error') return IconAlertTriangle;
  return IconInfoCircle;
}
</script>

<template>
  <div class="data-status-grid">
    <div
      v-for="item in items"
      :key="item.key || item.label"
      class="data-status-card"
      :class="item.status"
    >
      <component :is="statusIcon(item.status)" class="inline-icon" :stroke-width="2" />
      <div>
        <strong>{{ item.label }}</strong>
        <span>{{ item.message || item.value }}</span>
        <SourceBadge v-if="item.source" :source="item.source" />
      </div>
    </div>
  </div>
</template>
