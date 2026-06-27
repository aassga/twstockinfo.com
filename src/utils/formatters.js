export function formatMoney(value, digits = 0) {
  const number = Number(value || 0);
  return `$${number.toLocaleString('zh-TW', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })}`;
}

export function formatNumber(value, digits = 0) {
  const number = Number(value || 0);
  return number.toLocaleString('zh-TW', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

export function formatVolume(value) {
  const number = Number(value || 0);
  if (number >= 100000000) return `${formatNumber(number / 100000000, 2)}億`;
  if (number >= 10000) return `${formatNumber(number / 10000, 1)}萬`;
  return formatNumber(number);
}

export function formatSigned(value, digits = 2, suffix = '') {
  const number = Number(value || 0);
  const sign = number > 0 ? '+' : '';
  return `${sign}${number.toFixed(digits)}${suffix}`;
}

export function formatPct(value) {
  return formatSigned(value, 2, '%');
}

export function moveClass(value) {
  const number = Number(value || 0);
  if (number > 0) return 'is-up';
  if (number < 0) return 'is-down';
  return 'is-flat';
}

export function formatDateTime(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function formatChartTime(value, interval = 'D') {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  const options = interval === 'D'
    ? { month: '2-digit', day: '2-digit' }
    : { month: '2-digit', day: '2-digit', hour: '2-digit' };
  return date.toLocaleString('zh-TW', options);
}
