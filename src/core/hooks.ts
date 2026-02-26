import { EventEmitter } from 'events';
import type { AgentOSEvent, HookPayload } from '../types/index.js';

export type { AgentOSEvent, HookData, HookPayload } from '../types/index.js';

class HookSystem extends EventEmitter {
  emit(event: AgentOSEvent, payload: HookPayload): boolean {
    return super.emit(event, payload);
  }

  on(event: AgentOSEvent, listener: (payload: HookPayload) => void): this {
    return super.on(event, listener);
  }
}

export const hooks = new HookSystem();
