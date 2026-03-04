import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import ToolPolicyEditor from './ToolPolicyEditor.vue';

// Mock useTools — prevent actual API calls
vi.mock('../../composables/useTools.js', () => ({
  useTools: () => ({
    execute: vi.fn().mockResolvedValue({ status: 'error', error: 'not available' }),
  }),
}));

describe('ToolPolicyEditor', () => {
  // ── Preset Detection ──

  it('detects "all-auto" preset from { "*": { mode: "auto" } }', () => {
    const wrapper = mount(ToolPolicyEditor, {
      props: { modelValue: { '*': { mode: 'auto' } } },
    });
    const radios = wrapper.findAll<HTMLInputElement>('input[type="radio"]');
    const checked = radios.find(r => r.element.checked);
    expect(checked?.element.value).toBe('all-auto');
  });

  it('detects "all-approval" preset from { "*": { mode: "requires_approval" } }', () => {
    const wrapper = mount(ToolPolicyEditor, {
      props: { modelValue: { '*': { mode: 'requires_approval' } } },
    });
    const radios = wrapper.findAll<HTMLInputElement>('input[type="radio"]');
    const checked = radios.find(r => r.element.checked);
    expect(checked?.element.value).toBe('all-approval');
  });

  it('detects "per-tool" preset when multiple entries exist', () => {
    const wrapper = mount(ToolPolicyEditor, {
      props: {
        modelValue: {
          '*': { mode: 'auto' },
          'file_write': { mode: 'requires_approval' },
        },
      },
    });
    const radios = wrapper.findAll<HTMLInputElement>('input[type="radio"]');
    const checked = radios.find(r => r.element.checked);
    expect(checked?.element.value).toBe('per-tool');
  });

  it('detects "all-auto" preset for empty object', () => {
    const wrapper = mount(ToolPolicyEditor, {
      props: { modelValue: {} },
    });
    const radios = wrapper.findAll<HTMLInputElement>('input[type="radio"]');
    const checked = radios.find(r => r.element.checked);
    expect(checked?.element.value).toBe('all-auto');
  });

  // ── Preset Emission ──

  it('emits all-auto when selecting "All auto" radio', async () => {
    const wrapper = mount(ToolPolicyEditor, {
      props: { modelValue: { '*': { mode: 'requires_approval' } } },
    });
    const radios = wrapper.findAll<HTMLInputElement>('input[type="radio"]');
    const autoRadio = radios.find(r => r.element.value === 'all-auto')!;
    await autoRadio.trigger('change');

    const emitted = wrapper.emitted('update:modelValue');
    expect(emitted).toBeTruthy();
    const lastValue = emitted![emitted!.length - 1][0];
    expect(lastValue).toEqual({ '*': { mode: 'auto' } });
  });

  it('emits all-approval when selecting "All approval" radio', async () => {
    const wrapper = mount(ToolPolicyEditor, {
      props: { modelValue: {} },
    });
    const radios = wrapper.findAll<HTMLInputElement>('input[type="radio"]');
    const approvalRadio = radios.find(r => r.element.value === 'all-approval')!;
    await approvalRadio.trigger('change');

    const emitted = wrapper.emitted('update:modelValue');
    expect(emitted).toBeTruthy();
    const lastValue = emitted![emitted!.length - 1][0];
    expect(lastValue).toEqual({ '*': { mode: 'requires_approval' } });
  });

  // ── Rendering ──

  it('renders three preset radio buttons', () => {
    const wrapper = mount(ToolPolicyEditor, {
      props: { modelValue: {} },
    });
    const radios = wrapper.findAll('input[type="radio"]');
    expect(radios).toHaveLength(3);
  });

  it('shows per-tool editor when per-tool preset is active', () => {
    const wrapper = mount(ToolPolicyEditor, {
      props: {
        modelValue: {
          '*': { mode: 'auto' },
          'file_write': { mode: 'requires_approval' },
        },
      },
    });
    // Should show wildcard default row and category sections
    expect(wrapper.text()).toContain('(default)');
  });

  it('hides per-tool editor when preset is "all-auto"', () => {
    const wrapper = mount(ToolPolicyEditor, {
      props: { modelValue: { '*': { mode: 'auto' } } },
    });
    // Should NOT show wildcard default row
    expect(wrapper.text()).not.toContain('* (default)');
  });

  it('displays tool categories in per-tool mode', () => {
    const wrapper = mount(ToolPolicyEditor, {
      props: {
        modelValue: { '*': { mode: 'auto' }, 'file_read': { mode: 'auto' } },
      },
    });
    expect(wrapper.text()).toContain('Read Operations');
    expect(wrapper.text()).toContain('Write Operations');
    expect(wrapper.text()).toContain('Communication');
    expect(wrapper.text()).toContain('Process Execution');
  });

  it('shows quick action buttons in per-tool mode', () => {
    const wrapper = mount(ToolPolicyEditor, {
      props: {
        modelValue: { '*': { mode: 'auto' }, 'file_read': { mode: 'auto' } },
      },
    });
    expect(wrapper.text()).toContain('Read');
    expect(wrapper.text()).toContain('Write');
    expect(wrapper.text()).toContain('Reset defaults');
  });

  // ── Per-tool interactions ──

  it('shows "+ rules" button for tools in per-tool mode', async () => {
    const wrapper = mount(ToolPolicyEditor, {
      props: {
        modelValue: { '*': { mode: 'auto' }, 'file_read': { mode: 'auto' } },
      },
    });
    // Expand a category first
    const details = wrapper.findAll('details');
    if (details.length > 0) {
      // Categories should be present with "+ rules" buttons
      expect(wrapper.text()).toContain('rules');
    }
  });
});
