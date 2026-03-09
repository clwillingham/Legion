import { describe, it, expect } from 'vitest';
import { resolveToolCallComponent, resolveToolResultComponent } from './toolComponentRegistry.js';

describe('toolComponentRegistry', () => {
  it('resolves communicate tool call component', () => {
    const component = resolveToolCallComponent('communicate');
    expect(component).not.toBeNull();
  });

  it('returns null for unregistered tool call', () => {
    const component = resolveToolCallComponent('file_read');
    expect(component).toBeNull();
  });

  it('resolves communicate tool result component', () => {
    const component = resolveToolResultComponent('communicate');
    expect(component).not.toBeNull();
  });

  it('returns null for unregistered tool result', () => {
    const component = resolveToolResultComponent('file_read');
    expect(component).toBeNull();
  });
});
