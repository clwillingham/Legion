import type { Component } from 'vue';
import CommunicateCallBlock from './CommunicateCallBlock.vue';
import CommunicateResultBlock from './CommunicateResultBlock.vue';

const toolCallRegistry: Record<string, Component> = {
  communicate: CommunicateCallBlock,
};

const toolResultRegistry: Record<string, Component> = {
  communicate: CommunicateResultBlock,
};

export function resolveToolCallComponent(toolName: string): Component | null {
  return toolCallRegistry[toolName] ?? null;
}

export function resolveToolResultComponent(toolName: string): Component | null {
  return toolResultRegistry[toolName] ?? null;
}
