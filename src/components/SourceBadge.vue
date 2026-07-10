<script setup>
import { computed } from 'vue';
import { sourceMeta } from '../utils/dataSources';

const props = defineProps({
  source: {
    type: String,
    default: ''
  },
  label: {
    type: String,
    default: ''
  },
  type: {
    type: String,
    default: ''
  },
  variant: {
    type: String,
    default: ''
  }
});

const meta = computed(() => {
  const next = sourceMeta(props.source || props.label);
  return {
    ...next,
    label: props.label || next.label,
    type: props.type || next.type
  };
});
</script>

<template>
  <span
    class="source-badge data-source-badge"
    :class="[meta.type, variant ? `source-badge-${variant}` : '']"
    :title="meta.raw || meta.label"
  >
    {{ meta.label }}
  </span>
</template>
