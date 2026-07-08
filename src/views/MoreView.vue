<script setup>
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { IconDots } from '@tabler/icons-vue';
import { moreNavItems } from '../router/navItems';

const router = useRouter();

const groups = computed(() => [
  {
    title: '行情與排行',
    items: moreNavItems.filter(item => ['/hot100', '/top-volume', '/chart'].includes(item.path))
  },
  {
    title: '分析工具',
    items: moreNavItems.filter(item => ['/institutional', '/fundamental', '/ai'].includes(item.path))
  },
  {
    title: '個人工具',
    items: moreNavItems.filter(item => ['/favorites', '/alerts', '/settings'].includes(item.path))
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

    <div class="more-groups">
      <section v-for="group in groups" :key="group.title" class="more-group">
        <div class="section-title">{{ group.title }}</div>
        <div class="more-grid">
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
