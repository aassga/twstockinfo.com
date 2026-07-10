const SOURCE_RULES = [
  {
    test: value => value.includes('twse mis') || value.includes('twse-mis') || value.includes('mis'),
    label: 'TWSE MIS 即時報價',
    type: 'realtime'
  },
  {
    test: value => value.includes('yahoo chart') || value.includes('yahoo') && value.includes('chart'),
    label: 'Yahoo 圖表資料',
    type: 'chart'
  },
  {
    test: value => value.includes('yahoo'),
    label: 'Yahoo 備援報價（推估）',
    type: 'estimated'
  },
  {
    test: value => value.includes('mops') && value.includes('finmind'),
    label: 'MOPS / TWSE / TPEX / FinMind 事件資料',
    type: 'official'
  },
  {
    test: value => value.includes('histock') && (value.includes('法人') || value.includes('institutional')),
    label: 'HiStock 法人明細（輔助）',
    type: 'supplemental'
  },
  {
    test: value => value.includes('histock') && value.includes('twse'),
    label: 'HiStock / TWSE 籌碼輔助',
    type: 'supplemental'
  },
  {
    test: value => value.includes('histock'),
    label: 'HiStock 排名輔助（推估）',
    type: 'estimated'
  },
  {
    test: value => value.includes('finmind'),
    label: 'FinMind 財報 / 籌碼資料',
    type: 'financial'
  },
  {
    test: value => value.includes('mops'),
    label: 'MOPS 公開資訊觀測站',
    type: 'official'
  },
  {
    test: value => value.includes('twse') && value.includes('tpex'),
    label: 'TWSE / TPEX OpenAPI',
    type: 'official'
  },
  {
    test: value => value.includes('twse') || value.includes('tpex') || value.includes('openapi'),
    label: '交易所 OpenAPI',
    type: 'official'
  },
  {
    test: value => value.includes('local') || value.includes('本機') || value.includes('計算'),
    label: '本機計算（推估）',
    type: 'computed'
  }
];

export function sourceMeta(source, fallback = '資料來源待確認') {
  const raw = String(source || '').trim();
  const normalized = raw.toLowerCase();
  const matched = SOURCE_RULES.find(rule => rule.test(normalized));
  if (!matched) {
    return {
      label: raw || fallback,
      raw,
      type: raw ? 'unknown' : 'unknown'
    };
  }

  return {
    ...matched,
    raw: raw || matched.label
  };
}

export function quoteSourceMeta(stock) {
  const source = stock?.forceSourceLabel || stock?.source || 'TWSE MIS';
  const meta = sourceMeta(source);
  if (meta.type === 'estimated') return meta;
  if (String(stock?.source || '').includes('openapi')) {
    return { label: '交易所 OpenAPI 備援', type: 'fallback', raw: source };
  }
  return meta;
}

export function sourceLabel(source, fallback) {
  return sourceMeta(source, fallback).label;
}
