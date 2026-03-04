import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import MessageInput from './MessageInput.vue';

const defaultParticipants = [
  { id: 'agent-1', name: 'Agent One' },
  { id: 'agent-2', name: 'Agent Two' },
];

describe('MessageInput', () => {
  it('renders participant selector and textarea', () => {
    const wrapper = mount(MessageInput, {
      props: { participants: defaultParticipants },
    });
    expect(wrapper.find('select').exists()).toBe(true);
    expect(wrapper.find('textarea').exists()).toBe(true);
    expect(wrapper.find('button').exists()).toBe(true);
  });

  it('renders participant options in select', () => {
    const wrapper = mount(MessageInput, {
      props: { participants: defaultParticipants },
    });
    const options = wrapper.findAll('option');
    expect(options).toHaveLength(2);
    expect(options[0].text()).toBe('Agent One');
    expect(options[1].text()).toBe('Agent Two');
  });

  it('emits send event with target and message on button click', async () => {
    const wrapper = mount(MessageInput, {
      props: { participants: defaultParticipants },
    });

    await wrapper.find('textarea').setValue('Hello agent');
    await wrapper.find('button').trigger('click');

    expect(wrapper.emitted('send')).toBeTruthy();
    const [target, message] = wrapper.emitted('send')![0] as [string, string];
    expect(target).toBe('agent-1');
    expect(message).toBe('Hello agent');
  });

  it('emits send event on Enter key (without Shift)', async () => {
    const wrapper = mount(MessageInput, {
      props: { participants: defaultParticipants },
    });

    await wrapper.find('textarea').setValue('Enter test');
    await wrapper.find('textarea').trigger('keydown', { key: 'Enter', shiftKey: false });

    expect(wrapper.emitted('send')).toBeTruthy();
  });

  it('does NOT emit send on Shift+Enter', async () => {
    const wrapper = mount(MessageInput, {
      props: { participants: defaultParticipants },
    });

    await wrapper.find('textarea').setValue('Shift enter test');
    await wrapper.find('textarea').trigger('keydown', { key: 'Enter', shiftKey: true });

    expect(wrapper.emitted('send')).toBeFalsy();
  });

  it('does NOT emit send when message is empty', async () => {
    const wrapper = mount(MessageInput, {
      props: { participants: defaultParticipants },
    });

    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted('send')).toBeFalsy();
  });

  it('does NOT emit send when message is whitespace only', async () => {
    const wrapper = mount(MessageInput, {
      props: { participants: defaultParticipants },
    });

    await wrapper.find('textarea').setValue('   ');
    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted('send')).toBeFalsy();
  });

  it('clears textarea after sending', async () => {
    const wrapper = mount(MessageInput, {
      props: { participants: defaultParticipants },
    });

    const textarea = wrapper.find('textarea');
    await textarea.setValue('Hello');
    await wrapper.find('button').trigger('click');

    expect((textarea.element as HTMLTextAreaElement).value).toBe('');
  });

  it('disables textarea and button when disabled prop is true', () => {
    const wrapper = mount(MessageInput, {
      props: { participants: defaultParticipants, disabled: true },
    });

    expect(wrapper.find('textarea').attributes('disabled')).toBeDefined();
    expect(wrapper.find('button').attributes('disabled')).toBeDefined();
  });

  it('sends to selected participant', async () => {
    const wrapper = mount(MessageInput, {
      props: { participants: defaultParticipants },
    });

    await wrapper.find('select').setValue('agent-2');
    await wrapper.find('textarea').setValue('Hello agent 2');
    await wrapper.find('button').trigger('click');

    const [target] = wrapper.emitted('send')![0] as [string, string];
    expect(target).toBe('agent-2');
  });
});
