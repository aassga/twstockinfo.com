<script setup>
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useChartStore } from '../stores/chartStore';
import { useInstitutionalStore } from '../stores/institutionalStore';
import { formatSigned, moveClass } from '../utils/formatters';

const router = useRouter();
const institutionalStore = useInstitutionalStore();
const chartStore = useChartStore();

onMounted(() => {
  institutionalStore.loadInstitutional();
});

async function openChart(row) {
  await chartStore.openStock(row);
  router.push('/chart');
}
</script>

<template>
  <section class="view-stack">
    <div class="summary-grid institutional-summary">
      <div class="summary-tile">
        <span>外資</span>
        <strong :class="moveClass(institutionalStore.summary.foreign)">
          {{ formatSigned(institutionalStore.summary.foreign, 2, '億') }}
        </strong>
      </div>
      <div class="summary-tile">
        <span>投信</span>
        <strong :class="moveClass(institutionalStore.summary.trust)">
          {{ formatSigned(institutionalStore.summary.trust, 2, '億') }}
        </strong>
      </div>
      <div class="summary-tile">
        <span>自營商</span>
        <strong :class="moveClass(institutionalStore.summary.dealer)">
          {{ formatSigned(institutionalStore.summary.dealer, 2, '億') }}
        </strong>
      </div>
      <div class="summary-tile">
        <span>合計</span>
        <strong :class="moveClass(institutionalStore.total)">
          {{ formatSigned(institutionalStore.total, 2, '億') }}
        </strong>
      </div>
    </div>

    <van-skeleton v-if="institutionalStore.loading && !institutionalStore.rows.length" title :row="8" />

    <div v-else class="alert-grid">
      <article class="panel alert-panel">
        <div class="section-head">
          <h2>法人買超</h2>
        </div>
        <div class="signal-list">
          <button
            v-for="row in institutionalStore.topBuy"
            :key="`ib-${row.code}`"
            class="signal-row"
            type="button"
            @click="openChart(row)"
          >
            <span>
              <strong>{{ row.name }}</strong>
              <small>{{ row.code }} · 外資 {{ formatSigned(row.foreign, 2, '億') }}</small>
            </span>
            <b :class="moveClass(row.total)">{{ formatSigned(row.total, 2, '億') }}</b>
          </button>
        </div>
      </article>

      <article class="panel alert-panel">
        <div class="section-head">
          <h2>法人賣超</h2>
        </div>
        <div class="signal-list">
          <button
            v-for="row in institutionalStore.topSell"
            :key="`is-${row.code}`"
            class="signal-row"
            type="button"
            @click="openChart(row)"
          >
            <span>
              <strong>{{ row.name }}</strong>
              <small>{{ row.code }} · 投信 {{ formatSigned(row.trust, 2, '億') }}</small>
            </span>
            <b :class="moveClass(row.total)">{{ formatSigned(row.total, 2, '億') }}</b>
          </button>
        </div>
      </article>
    </div>

    <div v-if="institutionalStore.error" class="panel empty-state">
      {{ institutionalStore.error }}
    </div>
  </section>
</template>
