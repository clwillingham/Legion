import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import type { ProcessInfo } from '../composables/useProcesses.js';

function makeProcess(overrides: Partial<ProcessInfo> = {}): ProcessInfo {
  return {
    processId: 1,
    pid: 12345,
    command: 'npm run dev',
    state: 'running',
    mode: 'background',
    exitCode: null,
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

const mockProcesses = ref<ProcessInfo[]>([]);
const mockSelectedProcessId = ref<number | null>(null);
const mockProcessOutput = ref<Record<number, string>>({});
const mockLoadProcesses = vi.fn();
const mockStopProcess = vi.fn();
const mockSelectProcess = vi.fn();
const mockStartProcess = vi.fn().mockResolvedValue({ processId: 99 });

vi.mock('../composables/useProcesses.js', () => ({
  useProcesses: () => ({
    processes: mockProcesses,
    selectedProcessId: mockSelectedProcessId,
    processOutput: mockProcessOutput,
    loadProcesses: mockLoadProcesses,
    getProcess: vi.fn(),
    stopProcess: mockStopProcess,
    startProcess: mockStartProcess,
    selectProcess: mockSelectProcess,
    loadProcessOutput: vi.fn(),
  }),
}));

import ProcessesView from './ProcessesView.vue';

beforeEach(() => {
  mockProcesses.value = [];
  mockSelectedProcessId.value = null;
  mockProcessOutput.value = {};
  mockLoadProcesses.mockClear();
  mockStopProcess.mockClear();
  mockSelectProcess.mockClear();
  mockStartProcess.mockClear().mockResolvedValue({ processId: 99 });
});

describe('ProcessesView', () => {
  it('calls loadProcesses on mount', () => {
    mount(ProcessesView);
    expect(mockLoadProcesses).toHaveBeenCalled();
  });

  it('renders process list sidebar', () => {
    mockProcesses.value = [makeProcess()];
    const wrapper = mount(ProcessesView);
    expect(wrapper.text()).toContain('Processes');
  });

  it('shows empty state when no process is selected and list is empty', () => {
    const wrapper = mount(ProcessesView);
    expect(wrapper.text()).toContain('No tracked processes');
  });

  it('shows "Select a process" when processes exist but none selected', () => {
    mockProcesses.value = [makeProcess()];
    const wrapper = mount(ProcessesView);
    expect(wrapper.text()).toContain('Select a process to view its output');
  });

  it('shows process output when a process is selected', () => {
    const proc = makeProcess({ processId: 1, command: 'npm test' });
    mockProcesses.value = [proc];
    mockSelectedProcessId.value = 1;
    mockProcessOutput.value = { 1: 'Test output here' };

    const wrapper = mount(ProcessesView);
    expect(wrapper.text()).toContain('Test output here');
    expect(wrapper.text()).toContain('#1');
  });

  it('renders two-column layout', () => {
    mockProcesses.value = [makeProcess()];
    mockSelectedProcessId.value = 1;
    mockProcessOutput.value = { 1: 'output' };

    const wrapper = mount(ProcessesView);
    // Should have the flex layout with sidebar and content
    const container = wrapper.find('.flex.h-full');
    expect(container.exists()).toBe(true);
  });
});
