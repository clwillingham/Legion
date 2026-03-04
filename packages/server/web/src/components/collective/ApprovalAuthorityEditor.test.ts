import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ApprovalAuthorityEditor from './ApprovalAuthorityEditor.vue';
import type { Participant, ApprovalAuthority } from '../../composables/useCollective.js';

function makeParticipant(overrides: Partial<Participant> = {}): Participant {
  return {
    id: 'agent-1',
    type: 'agent',
    name: 'Agent One',
    description: 'A helpful agent',
    status: 'active',
    tools: { '*': { mode: 'auto' } },
    ...overrides,
  };
}

describe('ApprovalAuthorityEditor', () => {
  // ── Preset Detection ──

  it('detects "none" mode from empty object', () => {
    const wrapper = mount(ApprovalAuthorityEditor, {
      props: { modelValue: {}, participants: [] },
    });
    const radios = wrapper.findAll<HTMLInputElement>('input[type="radio"]');
    const checked = radios.find(r => r.element.checked);
    expect(checked?.element.value).toBe('none');
  });

  it('detects "full" mode from "*"', () => {
    const wrapper = mount(ApprovalAuthorityEditor, {
      props: { modelValue: '*' as ApprovalAuthority, participants: [] },
    });
    const radios = wrapper.findAll<HTMLInputElement>('input[type="radio"]');
    const checked = radios.find(r => r.element.checked);
    expect(checked?.element.value).toBe('full');
  });

  it('detects "custom" mode from object with entries', () => {
    const wrapper = mount(ApprovalAuthorityEditor, {
      props: {
        modelValue: { 'agent-1': ['file_read', 'file_write'] } as ApprovalAuthority,
        participants: [],
      },
    });
    const radios = wrapper.findAll<HTMLInputElement>('input[type="radio"]');
    const checked = radios.find(r => r.element.checked);
    expect(checked?.element.value).toBe('custom');
  });

  // ── Preset Emission ──

  it('emits empty object when selecting "No authority"', async () => {
    const wrapper = mount(ApprovalAuthorityEditor, {
      props: { modelValue: '*' as ApprovalAuthority, participants: [] },
    });
    const radios = wrapper.findAll<HTMLInputElement>('input[type="radio"]');
    const noneRadio = radios.find(r => r.element.value === 'none')!;
    await noneRadio.trigger('change');

    const emitted = wrapper.emitted('update:modelValue');
    expect(emitted).toBeTruthy();
    expect(emitted![emitted!.length - 1][0]).toEqual({});
  });

  it('emits "*" when selecting "Full authority"', async () => {
    const wrapper = mount(ApprovalAuthorityEditor, {
      props: { modelValue: {}, participants: [] },
    });
    const radios = wrapper.findAll<HTMLInputElement>('input[type="radio"]');
    const fullRadio = radios.find(r => r.element.value === 'full')!;
    await fullRadio.trigger('change');

    const emitted = wrapper.emitted('update:modelValue');
    expect(emitted).toBeTruthy();
    expect(emitted![emitted!.length - 1][0]).toBe('*');
  });

  // ── Rendering ──

  it('renders three preset radio buttons', () => {
    const wrapper = mount(ApprovalAuthorityEditor, {
      props: { modelValue: {}, participants: [] },
    });
    const radios = wrapper.findAll('input[type="radio"]');
    expect(radios).toHaveLength(3);
  });

  it('shows custom editor when custom mode is active', () => {
    const wrapper = mount(ApprovalAuthorityEditor, {
      props: {
        modelValue: { 'agent-1': ['file_read'] } as ApprovalAuthority,
        participants: [makeParticipant()],
      },
    });
    // Should show the participant entry and an Add button
    expect(wrapper.text()).toContain('agent-1');
    expect(wrapper.text()).toContain('Add');
  });

  it('hides custom editor when mode is "none"', () => {
    const wrapper = mount(ApprovalAuthorityEditor, {
      props: { modelValue: {}, participants: [] },
    });
    expect(wrapper.text()).not.toContain('Add');
  });

  it('hides custom editor when mode is "full"', () => {
    const wrapper = mount(ApprovalAuthorityEditor, {
      props: { modelValue: '*' as ApprovalAuthority, participants: [] },
    });
    expect(wrapper.text()).not.toContain('Add');
  });

  it('shows description for each preset', () => {
    const wrapper = mount(ApprovalAuthorityEditor, {
      props: { modelValue: {}, participants: [] },
    });
    expect(wrapper.text()).toContain('cannot approve');
    expect(wrapper.text()).toContain('can approve any');
    expect(wrapper.text()).toContain('per-participant');
  });

  // ── Custom Mode Interactions ──

  it('shows participant dropdown with available agents', () => {
    const wrapper = mount(ApprovalAuthorityEditor, {
      props: {
        modelValue: { '*': [] } as unknown as ApprovalAuthority,
        participants: [
          makeParticipant({ id: 'agent-1', name: 'Agent One' }),
          makeParticipant({ id: 'agent-2', name: 'Agent Two' }),
        ],
      },
    });
    const select = wrapper.find('select');
    expect(select.exists()).toBe(true);
    // agent-2 should be available (agent-1 might be used if '*' doesn't match)
    const options = select.findAll('option');
    expect(options.length).toBeGreaterThanOrEqual(1);
  });

  it('displays tool summary for entries', () => {
    const wrapper = mount(ApprovalAuthorityEditor, {
      props: {
        modelValue: { '*': ['file_read', 'file_write'] } as unknown as ApprovalAuthority,
        participants: [],
      },
    });
    expect(wrapper.text()).toContain('file_read, file_write');
  });

  it('shows "No tools" when entry has empty tool list', () => {
    const wrapper = mount(ApprovalAuthorityEditor, {
      props: {
        modelValue: { '*': [] } as unknown as ApprovalAuthority,
        participants: [],
      },
    });
    expect(wrapper.text()).toContain('No tools');
  });

  it('shows Remove button for entries', () => {
    const wrapper = mount(ApprovalAuthorityEditor, {
      props: {
        modelValue: { 'agent-1': ['file_read'] } as unknown as ApprovalAuthority,
        participants: [],
      },
    });
    expect(wrapper.text()).toContain('Remove');
  });
});
