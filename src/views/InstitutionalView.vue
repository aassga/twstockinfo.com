<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { IconBuildingBank, IconInfoCircle, IconSparkles } from '@tabler/icons-vue';
import { useInstitutionalStore } from '../stores/institutionalStore';
import { formatSigned, moveClass } from '../utils/formatters';

const router = useRouter();
const institutionalStore = useInstitutionalStore();
const showAi = ref(false);
const pageSize = 20;
const currentPage = ref(1);

const totalRows = computed(() => institutionalStore.rows.length);
const totalPages = computed(() => Math.max(1, Math.ceil(totalRows.value / pageSize)));
const pageStart = computed(() => totalRows.value ? (currentPage.value - 1) * pageSize + 1 : 0);
const pageEnd = computed(() => Math.min(currentPage.value * pageSize, totalRows.value));
const pagedRows = computed(() => {
  const start = (currentPage.value - 1) * pageSize;
  return institutionalStore.rows.slice(start, start + pageSize);
});
const visiblePages = computed(() => {
  const pages = [];
  const start = Math.max(1, currentPage.value - 2);
  const end = Math.min(totalPages.value, start + 4);
  const normalizedStart = Math.max(1, end - 4);
  for (let page = normalizedStart; page <= end; page += 1) pages.push(page);
  return pages;
});

onMounted(() => {
  institutionalStore.loadInstitutional();
});

watch(totalPages, pages => {
  if (currentPage.value > pages) currentPage.value = pages;
});

function openQuote(row) {
  router.push({ path: '/quote', query: { code: row.code } });
}

function percent(value, positive = true) {
  const number = Math.min(80, Math.max(20, 50 + Math.abs(Number(value || 0)) * 2));
  return positive ? Math.round(number) : Math.round(100 - number);
}

function setPage(page) {
  currentPage.value = Math.min(totalPages.value, Math.max(1, page));
}
</script>

<template>
  <section class="tab-content active">
    <div class="page-title">
      <IconBuildingBank class="title-icon" :stroke-width="2" />
      三大法人即時動態
    </div>

    <div class="inst-overview">
      <div class="inst-overview-card foreign">
        <div class="inst-ov-label">外資及陸資</div>
        <div class="inst-ov-val" :class="moveClass(institutionalStore.summary.foreign).replace('is-', '')">
          {{ formatSigned(institutionalStore.summary.foreign, 2, '億') }}
        </div>
        <div class="inst-ov-sub">今日淨買超</div>
        <div class="inst-ov-bars">
          <div class="mini-bar-row">
            <span class="mini-bar-label">買</span>
            <div class="mini-bar-track"><div class="mini-bar-fill buy" :style="{ width: `${percent(institutionalStore.summary.foreign)}%` }"></div></div>
            <span class="mini-bar-pct buy">{{ percent(institutionalStore.summary.foreign) }}%</span>
          </div>
          <div class="mini-bar-row">
            <span class="mini-bar-label">賣</span>
            <div class="mini-bar-track"><div class="mini-bar-fill sell" :style="{ width: `${percent(institutionalStore.summary.foreign, false)}%` }"></div></div>
            <span class="mini-bar-pct sell">{{ percent(institutionalStore.summary.foreign, false) }}%</span>
          </div>
        </div>
      </div>

      <div class="inst-overview-card trust">
        <div class="inst-ov-label">投信</div>
        <div class="inst-ov-val" :class="moveClass(institutionalStore.summary.trust).replace('is-', '')">
          {{ formatSigned(institutionalStore.summary.trust, 2, '億') }}
        </div>
        <div class="inst-ov-sub">今日淨買超</div>
        <div class="inst-ov-bars">
          <div class="mini-bar-row">
            <span class="mini-bar-label">買</span>
            <div class="mini-bar-track"><div class="mini-bar-fill buy" :style="{ width: `${percent(institutionalStore.summary.trust)}%` }"></div></div>
            <span class="mini-bar-pct buy">{{ percent(institutionalStore.summary.trust) }}%</span>
          </div>
          <div class="mini-bar-row">
            <span class="mini-bar-label">賣</span>
            <div class="mini-bar-track"><div class="mini-bar-fill sell" :style="{ width: `${percent(institutionalStore.summary.trust, false)}%` }"></div></div>
            <span class="mini-bar-pct sell">{{ percent(institutionalStore.summary.trust, false) }}%</span>
          </div>
        </div>
      </div>

      <div class="inst-overview-card dealer">
        <div class="inst-ov-label">自營商</div>
        <div class="inst-ov-val" :class="moveClass(institutionalStore.summary.dealer).replace('is-', '')">
          {{ formatSigned(institutionalStore.summary.dealer, 2, '億') }}
        </div>
        <div class="inst-ov-sub">今日淨買超</div>
        <div class="inst-ov-bars">
          <div class="mini-bar-row">
            <span class="mini-bar-label">買</span>
            <div class="mini-bar-track"><div class="mini-bar-fill buy" :style="{ width: `${percent(institutionalStore.summary.dealer)}%` }"></div></div>
            <span class="mini-bar-pct buy">{{ percent(institutionalStore.summary.dealer) }}%</span>
          </div>
          <div class="mini-bar-row">
            <span class="mini-bar-label">賣</span>
            <div class="mini-bar-track"><div class="mini-bar-fill sell" :style="{ width: `${percent(institutionalStore.summary.dealer, false)}%` }"></div></div>
            <span class="mini-bar-pct sell">{{ percent(institutionalStore.summary.dealer, false) }}%</span>
          </div>
        </div>
      </div>
    </div>

    <div class="section-title" style="margin-top:1.5rem">法人重點布局個股</div>
    <div class="table-hint">
      <IconInfoCircle class="inline-icon" :stroke-width="2" />
      點擊股票名稱可以看即時報價與走勢圖
    </div>

    <div class="table-wrapper">
      <table class="stock-table">
        <thead>
          <tr>
            <th>代號</th>
            <th>名稱</th>
            <th>外資(張)</th>
            <th>投信(張)</th>
            <th>自營商(張)</th>
            <th>合計(張)</th>
            <th>連續買超</th>
            <th>訊號</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in pagedRows" :key="row.code">
            <td>{{ row.code }}</td>
            <td>
              <button class="stock-link" type="button" @click="openQuote(row)">{{ row.name }}</button>
            </td>
            <td :class="moveClass(row.foreign).replace('is-', '')">{{ formatSigned(row.foreign, 0, '張') }}</td>
            <td :class="moveClass(row.trust).replace('is-', '')">{{ formatSigned(row.trust, 0, '張') }}</td>
            <td :class="moveClass(row.dealer).replace('is-', '')">{{ formatSigned(row.dealer, 0, '張') }}</td>
            <td :class="moveClass(row.total).replace('is-', '')">{{ formatSigned(row.total, 0, '張') }}</td>
            <td>當日</td>
            <td>
              <span class="direction-pill" :class="row.total > 0 ? 'buy' : row.total < 0 ? 'sell' : 'neutral'">
                {{ row.total > 0 ? '買超' : row.total < 0 ? '賣超' : '混合' }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="totalRows" class="pagination-bar">
      <div class="pagination-info">
        顯示第 {{ pageStart }}-{{ pageEnd }} 筆，共 {{ totalRows }} 筆
      </div>
      <div class="pagination-controls">
        <button class="btn xs" type="button" :disabled="currentPage === 1" @click="setPage(currentPage - 1)">
          上一頁
        </button>
        <button
          v-for="page in visiblePages"
          :key="page"
          class="btn xs page-btn"
          :class="{ active: page === currentPage }"
          type="button"
          @click="setPage(page)"
        >
          {{ page }}
        </button>
        <button class="btn xs" type="button" :disabled="currentPage === totalPages" @click="setPage(currentPage + 1)">
          下一頁
        </button>
      </div>
    </div>

    <div class="table-footer">
      <button class="btn" type="button" @click="showAi = true">
        <IconSparkles class="btn-icon" :stroke-width="2" />
        AI解讀法人動向
      </button>
      <div v-if="showAi" class="ai-pick-result">
        <div class="ai-box-header">
          <IconSparkles class="inline-icon" :stroke-width="2" />
          AI 法人解讀
        </div>
        <div class="ai-content">
          三大法人合計 {{ formatSigned(institutionalStore.total, 2, '億') }}。若買超集中在大型權值股，通常有助於指數穩定；若賣超擴散，需降低追價風險。
        </div>
      </div>
    </div>
  </section>
</template>
