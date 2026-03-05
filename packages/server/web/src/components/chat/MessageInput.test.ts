import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import MessageInput from './MessageInput.vue';

describe('MessageInput', () => {
  it('renders textarea and send button', () => {
    const wrapper = mount(MessageInput);
    expect(wrapper.find('textarea').exists()).toBe(true);
    expect(wrapper.find('button').exists()).toBe(true);
  });

  it('does not render a participant select', () => {
    const wrapper = mount(MessageInput);
    expect(wrapper.find('select').exists()).toBe(false);
  });

  it('emits send event with message on button click', async () => {
    const wrapper = mount(MessageInput);
    await wrapper.find('textarea').setValue('Hello agent');
    await wrapper.find('button').trigger('click');

    expect(wrapper.emitted('send')).toBeTruthy();
    const [message] = wrapper.emitted('send')![0] as [string];
    expect(message).toBe('Hello agent');
  });

  it('emits send event on Enter key (without Shift)', async () => {
    const wrapper = mount(MessageInput);
    await wrapper.find('textarea').setValue('Enter test');
    await wrapper.find('textarea').trigger('keydown', { key: 'Enter', shiftKey: false });

    expect(wrapper.emitted('send')).toBeTruthy();
  });

  it('does NOT emit send on Shift+Enter', async () => {
    const wrapper = mount(MessageInput);
    await wrapper.find('textarea').setValue('Shift enter test');
    await wrapper.find('textarea').trigger('keydown', { key: 'Enter', shiftKey: true });

    expect(wrapper.emitted('send')).toBeFalsy();
  });

  it('does NOT emit send when message is empty', async () => {
    const wrapper = mount(MessageInput);
    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted('send')).toBeFalsy();
  });

  it('does NOT emit send when message is whitespace only', async () => {
    const wrapper = mount(MessageInput);
    await wrapper.find('textarea').setValue('   ');
    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted('send')).toBeFalsy();
  });

  it('clears textarea after sending', async () => {
    const wrapper = mount(MessageInput);
    const textarea = wrapper.find('textarea');
    await textarea.setValue('Hello');
    await wrapper.find('button').trigger('click');

    expect((textarea.element as HTMLTextAreaElement).value).toBe('');
  });

  it('disables textarea and button when disabled prop is true', () => {
    const wrapper = mount(MessageInput, {
      props: { disabled: true },
    });

    expect(wrapper.find('textarea').attributes('disabled')).toBeDefined();
    expect(wrapper.find('button').attributes('disabled')).toBeDefined();
  });
});
