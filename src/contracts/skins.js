export const SUITE_SKINS = {
  ainetscope: {
    id: 'ainetscope',
    label: 'AINetScope',
    description: 'Paper, mono type, and signal colors for evidence analysis.',
  },
  aiops: {
    id: 'aiops',
    label: 'AIOps',
    description: 'Dense console surfaces and operational status colors.',
  },
};

export const DEFAULT_SUITE_SKIN = SUITE_SKINS.ainetscope.id;
export const SUITE_SKIN_STORAGE_KEY = 'datasnare:core-skin';

export function normalizeSuiteSkin(value) {
  return SUITE_SKINS[value] ? value : DEFAULT_SUITE_SKIN;
}
