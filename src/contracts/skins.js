export const SUITE_SKINS = {
  modern: {
    id: 'modern',
    label: 'Modern',
    description: 'Paper surfaces, mono type, and signal colors for evidence analysis.',
  },
  dark: {
    id: 'dark',
    label: 'Dark',
    description: 'Dense slate console surfaces and operational status colors.',
  },
  light: {
    id: 'light',
    label: 'Light',
    description: 'Bright operational surfaces with AIOps-style blue status accents.',
  },
};

export const DEFAULT_SUITE_SKIN = SUITE_SKINS.modern.id;
export const SUITE_SKIN_STORAGE_KEY = 'datasnare:core-skin';

export function normalizeSuiteSkin(value) {
  const legacyIds = { ainetscope: 'modern', aiops: 'dark' };
  const normalized = legacyIds[value] || value;
  return SUITE_SKINS[normalized] ? normalized : DEFAULT_SUITE_SKIN;
}
