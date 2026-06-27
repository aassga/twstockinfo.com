import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

const width = ref(typeof window === 'undefined' ? 1024 : window.innerWidth);

export function useBreakpoints() {
  const update = () => {
    width.value = window.innerWidth;
  };

  onMounted(() => {
    update();
    window.addEventListener('resize', update, { passive: true });
  });

  onBeforeUnmount(() => {
    window.removeEventListener('resize', update);
  });

  return {
    width,
    isMobile: computed(() => width.value < 768)
  };
}
