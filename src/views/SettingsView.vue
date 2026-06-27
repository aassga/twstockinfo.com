<script setup>
import { config } from '../config';
</script>

<template>
  <section class="view-stack">
    <article class="panel">
      <div class="section-head">
        <h2>資料代理</h2>
      </div>
      <div class="setting-row">
        <span>Worker</span>
        <strong>{{ config.proxyBase }}</strong>
      </div>
    </article>

    <article class="panel">
      <div class="section-head">
        <h2>版本狀態</h2>
      </div>
      <div class="setting-row">
        <span>前端</span>
        <strong>Vue 3 + Vite</strong>
      </div>
      <div class="setting-row">
        <span>行動 UI</span>
        <strong>Vant</strong>
      </div>
      <div class="setting-row">
        <span>PC UI</span>
        <strong>Element Plus</strong>
      </div>
      <div class="setting-row">
        <span>舊版檔案</span>
        <strong>legacy/</strong>
      </div>
    </article>
  </section>
</template>
