const PLAN_COLORS = ['green', 'blue', 'violet', 'amber', 'coral', 'teal'];
const PLAN_TIER_COLORS = { starter: 'green', growth: 'blue', enterprise: 'violet' };

export function planColor(planKey = '') {
  const key = String(planKey).toLowerCase();
  if (PLAN_TIER_COLORS[key]) return PLAN_TIER_COLORS[key];
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PLAN_COLORS[hash % PLAN_COLORS.length];
}

export function PlanTag({ planKey = '', children }) {
  return <span className={`plan-tag plan-tag--${planColor(planKey)}`}>{children || planKey}</span>;
}
