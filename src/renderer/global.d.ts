import type { ReminderApi } from '../shared/types';

declare global {
  interface Window {
    xiabanla: ReminderApi;
  }
}

export {};
