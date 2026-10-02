export const ANALYSIS_PLUGIN_CONTRACT = 'datasnare-analysis-plugin/v1';

export const AIANALYSIS_PLUGIN_IDS = [
  'airca',
  'ailogscope',
  'aiperf',
  'aiprocmon',
  'ainetscope',
  'aimemorydump',
];

export const ANALYSIS_PLUGINS = {
  airca: {
    id: 'airca',
    name: 'AIRootCause',
    status: 'first-party',
    inputArtifactTypes: ['json', 'csv', 'txt'],
    outputSchema: 'datasnare-rootcause/investigation-v1',
    contributions: ['investigation', 'timeline', 'findings'],
  },
  ailogscope: {
    id: 'ailogscope',
    name: 'AILogScope',
    status: 'first-party',
    inputArtifactTypes: ['log', 'txt', 'json', 'yaml', 'pdf'],
    outputSchema: 'datasnare-ailogscope/events-v1',
    contributions: ['events', 'findings'],
  },
  aiperf: {
    id: 'aiperf',
    name: 'AIPerf',
    status: 'first-party',
    inputArtifactTypes: ['blg', 'csv', 'xml'],
    outputSchema: 'datasnare-aiperf/events-v1',
    contributions: ['metrics', 'findings', 'timeline'],
  },
  aiprocmon: {
    id: 'aiprocmon',
    name: 'AIProcMon',
    status: 'first-party',
    inputArtifactTypes: ['pml', 'csv', 'xml'],
    outputSchema: 'datasnare-aiprocmon/events-v1',
    contributions: ['process-events', 'findings', 'process-map'],
  },
  ainetscope: {
    id: 'ainetscope',
    name: 'AINetScope',
    status: 'first-party',
    inputArtifactTypes: ['pcap', 'pcapng', 'cap'],
    outputSchema: 'datasnare-ainetscope/analysis-v1',
    contributions: ['flows', 'findings', 'timeline'],
  },
  aimemorydump: {
    id: 'aimemorydump',
    name: 'AIMemoryDump',
    status: 'planned',
    inputArtifactTypes: [],
    outputSchema: null,
    contributions: [],
  },
};