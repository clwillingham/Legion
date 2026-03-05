import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import ProcessList from './ProcessList.vue';
import type { ProcessInfo } from '../../composables/useProcesses.js';

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

describe('ProcessList', () => {
  it('renders "Processes" header', () => {
    const wrapper = mount(ProcessList, {
      props: { processes: [], selectedId: null },
    });
    expect(wrapper.text()).toContain('Processes');
  });

  it('shows empty state when no processes exist', () => {
    const wrapper = mount(ProcessList, {
      props: { processes: [], selectedId: null },
    });
    expect(wrapper.text()).toContain('No tracked processes');
  });

  it('renders process entries', () => {
    const processes = [
      makeProcess({ processId: 1, command: 'npm run dev', label: 'Dev Server' }),
      makeProcess({ processId: 2, command: 'npm test', label: 'Tests' }),
    ];
    const wrapper = mount(ProcessList, {
      props: { processes, selectedId: null },
    });
    expect(wrapper.text()).toContain('Dev Server');
    expect(wrapper.text()).toContain('Tests');
    expect(wrapper.text()).toContain('#1');
    expect(wrapper.text()).toContain('#2');
  });

  it('shows running state indicator', () => {
    const processes = [makeProcess({ state: 'running' })];
    const wrapper = mount(ProcessList, {
      props: { processes, selectedId: null },
    });
    expect(wrapper.text()).toContain('running');
  });

  it('shows exited state with exit code', () => {
    const processes = [makeProcess({ state: 'exited', exitCode: 0 })];
    const wrapper = mount(ProcessList, {
      props: { processes, selectedId: null },
    });
    expect(wrapper.text()).toContain('exited');
    expect(wrapper.text()).toContain('exit 0');
  });

  it('shows stop button only for running processes', () => {
    const processes = [
      makeProcess({ processId: 1, state: 'running' }),
      makeProcess({ processId: 2, state: 'exited', exitCode: 0 }),
    ];
    const wrapper = mount(ProcessList, {
      props: { processes, selectedId: null },
    });
    const stopButtons = wrapper.findAll('button').filter(b => b.text().trim() === 'Stop');
    expect(stopButtons.length).toBe(1);
  });

  it('highlights selected process', () => {
    const processes = [makeProcess({ processId: 1 })];
    const wrapper = mount(ProcessList, {
      props: { processes, selectedId: 1 },
    });
    const entry = wrapper.findAll('.process-entry').find(e => e.text().includes('#1'));
    expect(entry?.classes()).toContain('bg-gray-800');
  });

  it('emits select when process entry is clicked', async () => {
    const processes = [makeProcess({ processId: 42 })];
    const wrapper = mount(ProcessList, {
      props: { processes, selectedId: null },
    });
    const entry = wrapper.findAll('.process-entry').find(e => e.text().includes('#42'));
    await entry?.trigger('click');

    expect(wrapper.emitted('select')).toBeTruthy();
    expect(wrapper.emitted('select')![0][0]).toBe(42);
  });

  it('emits stop when stop button is clicked', async () => {
    const processes = [makeProcess({ processId: 7, state: 'running' })];
    const wrapper = mount(ProcessList, {
      props: { processes, selectedId: null },
    });
    const stopBtn = wrapper.findAll('button').find(b => b.text().trim() === 'Stop');
    await stopBtn?.trigger('click');

    expect(wrapper.emitted('stop')).toBeTruthy();
    expect(wrapper.emitted('stop')![0][0]).toBe(7);
  });

  it('does not emit select when stop button is clicked', async () => {
    const processes = [makeProcess({ processId: 7, state: 'running' })];
    const wrapper = mount(ProcessList, {
      props: { processes, selectedId: null },
    });
    const stopBtn = wrapper.findAll('button').find(b => b.text().trim() === 'Stop');
    await stopBtn?.trigger('click');

    // Stop should be emitted but not select (click.stop modifier prevents propagation)
    expect(wrapper.emitted('stop')).toBeTruthy();
    expect(wrapper.emitted('select')).toBeFalsy();
  });

  it('sorts running processes before exited, then by recency', () => {
    const processes = [
      makeProcess({ processId: 1, state: 'exited', exitCode: 0, startedAt: '2024-01-01T00:00:00Z' }),
      makeProcess({ processId: 2, state: 'running', startedAt: '2024-01-01T00:00:00Z' }),
      makeProcess({ processId: 3, state: 'exited', exitCode: 1, startedAt: '2024-06-01T00:00:00Z' }),
    ];
    const wrapper = mount(ProcessList, {
      props: { processes, selectedId: null },
    });
    const text = wrapper.text();
    const pos2 = text.indexOf('#2'); // running — should be first
    const pos3 = text.indexOf('#3'); // exited newer — second
    const pos1 = text.indexOf('#1'); // exited older — last
    expect(pos2).toBeLessThan(pos3);
    expect(pos3).toBeLessThan(pos1);
  });

  it('shows PID information', () => {
    const processes = [makeProcess({ pid: 99999 })];
    const wrapper = mount(ProcessList, {
      props: { processes, selectedId: null },
    });
    expect(wrapper.text()).toContain('PID 99999');
  });

  it('shows command text', () => {
    const processes = [makeProcess({ command: 'python train.py' })];
    const wrapper = mount(ProcessList, {
      props: { processes, selectedId: null },
    });
    expect(wrapper.text()).toContain('python train.py');
  });

  it('shows "Running only" filter when processes exist', () => {
    const processes = [makeProcess()];
    const wrapper = mount(ProcessList, {
      props: { processes, selectedId: null },
    });
    expect(wrapper.text()).toContain('Running only');
  });

  it('hides "Running only" filter when no processes', () => {
    const wrapper = mount(ProcessList, {
      props: { processes: [], selectedId: null },
    });
    expect(wrapper.text()).not.toContain('Running only');
  });

  it('filters to running only when checkbox is toggled', async () => {
    const processes = [
      makeProcess({ processId: 1, state: 'running' }),
      makeProcess({ processId: 2, state: 'exited', exitCode: 0 }),
    ];
    const wrapper = mount(ProcessList, {
      props: { processes, selectedId: null },
    });

    // Both are visible initially
    expect(wrapper.text()).toContain('#1');
    expect(wrapper.text()).toContain('#2');

    // Toggle the checkbox
    const checkbox = wrapper.find('input[type="checkbox"]');
    await checkbox.setValue(true);
    await nextTick();

    // Only running process should be visible
    expect(wrapper.text()).toContain('#1');
    expect(wrapper.text()).not.toContain('#2');
  });

  it('shows running count in filter label', () => {
    const processes = [
      makeProcess({ processId: 1, state: 'running' }),
      makeProcess({ processId: 2, state: 'running' }),
      makeProcess({ processId: 3, state: 'exited', exitCode: 0 }),
    ];
    const wrapper = mount(ProcessList, {
      props: { processes, selectedId: null },
    });
    expect(wrapper.text()).toContain('(2)');
  });

  it('has + button that emits start', async () => {
    const wrapper = mount(ProcessList, {
      props: { processes: [], selectedId: null },
    });
    const plusBtn = wrapper.findAll('button').find(b => b.text().trim() === '+');
    expect(plusBtn?.exists()).toBe(true);
    await plusBtn?.trigger('click');
    expect(wrapper.emitted('start')).toBeTruthy();
  });
});
