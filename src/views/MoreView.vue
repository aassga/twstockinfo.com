<script setup>
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { IconDots } from '@tabler/icons-vue';
import { moreNavItems } from '../router/navItems';

const router = useRouter();
const showLowFrequency = ref(false);

const groups = computed(() => [
  {
    title: '常用工具',
    description: '平常最常用的行情、分析與持股管理。',
    items: moreNavItems.filter(item => ['/hot100', '/top-volume', '/chart', '/fundamental', '/institutional', '/margin', '/backtest', '/favorites', '/alerts'].includes(item.path))
  },
  {
    title: '低頻 / 系統',
    description: '偶爾才需要的 AI、資料健康與設定。',
    lowFrequency: true,
    items: moreNavItems.filter(item => ['/ai', '/data-health', '/settings'].includes(item.path))
  }
]);

function open(path) {
  router.push(path);
}
</script>

<template>
  <section class="tab-content active more-view">
    <div class="page-title">
      <IconDots class="title-icon" :stroke-width="2" />
      更多功能
    </div>
    <div class="page-purpose">
      這裡集中放不適合塞在底部導覽的工具。常用功能在上方，低頻與系統工具預設收合。
    </div>

    <div class="more-groups">
      <section v-for="group in groups" :key="group.title" class="more-group">
        <div class="section-title more-section-title">
          <span>{{ group.title }}</span>
          <button
            v-if="group.lowFrequency"
            class="btn xs"
            type="button"
            @click="showLowFrequency = !showLowFrequency"
          >
            {{ showLowFrequency ? '收合' : '展開' }}
          </button>
        </div>
        <p class="more-group-description">{{ group.description }}</p>
        <div v-if="!group.lowFrequency || showLowFrequency" class="more-grid">
          <button
            v-for="item in group.items"
            :key="item.path"
            class="more-card"
            type="button"
            @click="open(item.path)"
          >
            <component :is="item.icon" class="more-card-icon" :stroke-width="2" />
            <span>
              <strong>{{ item.label }}</strong>
              <em>{{ item.description }}</em>
            </span>
          </button>
        </div>
      </section>
    </div>
  </section>
</template>
