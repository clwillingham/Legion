import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ProcessOutput from './ProcessOutput.vue';
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

describe('ProcessOutput', () => {
  it('renders process header with id and command', () => {
    const wrapper = mount(ProcessOutput, {
      props: {
        process: makeProcess({ processId: 5, command: 'python app.py' }),
        output: '',
      },
    });
    expect(wrapper.text()).toContain('#5');
    expect(wrapper.text()).toContain('python app.py');
  });

  it('shows label when present', () => {
    const wrapper = mount(ProcessOutput, {
      props: {
        process: makeProcess({ label: 'API Server' }),
        output: '',
      },
    });
    expect(wrapper.text()).toContain('API Server');
  });

  it('shows running state indicator', () => {
    const wrapper = mount(ProcessOutput, {
      props: {
        process: makeProcess({ state: 'running' }),
        output: '',
      },
    });
    expect(wrapper.text()).toContain('running');
  });

  it('shows exited state with exit code', () => {
    const wrapper = mount(ProcessOutput, {
      props: {
        process: makeProcess({ state: 'exited', exitCode: 1 }),
        output: '',
      },
    });
    expect(wrapper.text()).toContain('exited');
    expect(wrapper.text()).toContain('Exit: 1');
  });

  it('displays output text', () => {
    const wrapper = mount(ProcessOutput, {
      props: {
        process: makeProcess(),
        output: 'Server started on port 3000\nReady.',
      },
    });
    expect(wrapper.text()).toContain('Server started on port 3000');
    expect(wrapper.text()).toContain('Ready.');
  });

  it('shows empty state when no output', () => {
    const wrapper = mount(ProcessOutput, {
      props: {
        process: makeProcess(),
        output: '',
      },
    });
    expect(wrapper.text()).toContain('(no output yet)');
  });

  it('shows line count', () => {
    const wrapper = mount(ProcessOutput, {
      props: {
        process: makeProcess(),
        output: 'line1\nline2\nline3',
      },
    });
    expect(wrapper.text()).toContain('3 lines');
  });

  it('shows PID', () => {
    const wrapper = mount(ProcessOutput, {
      props: {
        process: makeProcess({ pid: 42424 }),
        output: '',
      },
    });
    expect(wrapper.text()).toContain('PID 42424');
  });

  it('shows mode', () => {
    const wrapper = mount(ProcessOutput, {
      props: {
        process: makeProcess({ mode: 'background' }),
        output: '',
      },
    });
    expect(wrapper.text()).toContain('background');
  });

  it('shows stop button for running process', () => {
    const wrapper = mount(ProcessOutput, {
      props: {
        process: makeProcess({ state: 'running' }),
        output: '',
      },
    });
    const stopBtn = wrapper.findAll('button').find(b => b.text() === 'Stop');
    expect(stopBtn?.exists()).toBe(true);
  });

  it('hides stop button for exited process', () => {
    const wrapper = mount(ProcessOutput, {
      props: {
        process: makeProcess({ state: 'exited', exitCode: 0 }),
        output: '',
      },
    });
    const stopBtn = wrapper.findAll('button').find(b => b.text() === 'Stop');
    expect(stopBtn).toBeUndefined();
  });

  it('emits stop when stop button clicked', async () => {
    const wrapper = mount(ProcessOutput, {
      props: {
        process: makeProcess({ processId: 3, state: 'running' }),
        output: '',
      },
    });
    const stopBtn = wrapper.findAll('button').find(b => b.text() === 'Stop');
    await stopBtn?.trigger('click');

    expect(wrapper.emitted('stop')).toBeTruthy();
    expect(wrapper.emitted('stop')![0][0]).toBe(3);
  });

  it('has auto-scroll checkbox', () => {
    const wrapper = mount(ProcessOutput, {
      props: {
        process: makeProcess(),
        output: '',
      },
    });
    expect(wrapper.text()).toContain('Auto-scroll');
    const checkbox = wrapper.find('input[type="checkbox"]');
    expect(checkbox.exists()).toBe(true);
  });
});
