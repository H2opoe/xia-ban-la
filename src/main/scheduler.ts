import type { Reminder } from '../shared/types.js';
import { shouldReminderRunOnDate, toDateKey } from '../shared/reminderSchedule.js';
import { ReminderStore } from './store.js';

type TriggerOptions = {
  source: 'schedule' | 'manual';
};

type ReminderScheduleState = {
  key: string;
  wasBeforeTarget: boolean;
  triggered: boolean;
};

export class ReminderScheduler {
  private timer: NodeJS.Timeout | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private running = false;
  private tickInProgress = false;
  private pendingTick = false;
  private snoozeTimers = new Map<string, NodeJS.Timeout>();
  private scheduleStates = new Map<string, ReminderScheduleState>();

  constructor(
    private readonly store: ReminderStore,
    private readonly trigger: (reminder: Reminder, options: TriggerOptions) => Promise<void>,
    private readonly isReminderActive: (reminderId: string) => boolean = () => false
  ) {}

  start() {
    this.stop();
    this.running = true;
    this.unsubscribeStore = this.store.subscribe(() => {
      void this.tick();
    });
    void this.tick();
  }

  stop() {
    this.running = false;
    this.clearTimer();
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.tickInProgress = false;
    this.pendingTick = false;
    for (const timer of this.snoozeTimers.values()) {
      clearTimeout(timer);
    }
    this.snoozeTimers.clear();
    this.scheduleStates.clear();
  }

  async triggerNow(reminderId: string) {
    const reminder = this.findReminder(reminderId);
    if (!reminder) {
      throw new Error('提醒不存在');
    }
    await this.trigger(reminder, { source: 'manual' });
  }

  async snooze(reminderId: string, minutes: number) {
    const reminder = this.findReminder(reminderId);
    if (!reminder) {
      throw new Error('提醒不存在');
    }

    const existingTimer = this.snoozeTimers.get(reminderId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // 稍后提醒只是一次性的延迟弹出，不应该反写“更多提醒”的截止时间或下班提醒的今日覆盖时间。
    const delayMs = Math.max(1, minutes) * 60_000;
    const timer = setTimeout(() => {
      this.snoozeTimers.delete(reminderId);
      void this.triggerSnoozedReminder(reminderId);
    }, delayMs);
    this.snoozeTimers.set(reminderId, timer);
  }

  private async triggerSnoozedReminder(reminderId: string) {
    const reminder = this.findReminder(reminderId);
    if (!reminder || !reminder.enabled || reminder.completed) {
      return;
    }

    await this.trigger(reminder, { source: 'manual' });
  }

  private async tick() {
    if (!this.running) {
      return;
    }

    if (this.tickInProgress) {
      this.pendingTick = true;
      return;
    }

    this.tickInProgress = true;
    this.clearTimer();

    try {
      await this.store.reconcileForToday();
      await this.runScheduledReminders();
    } finally {
      this.tickInProgress = false;
    }

    if (this.pendingTick) {
      this.pendingTick = false;
      void this.tick();
      return;
    }

    this.scheduleNextTick();
  }

  private async runScheduledReminders() {
    const now = new Date();
    const todayKey = toDateKey(now);
    const currentTime = now.getTime();
    const activeReminderIds = new Set<string>();

    for (const reminder of this.store.getAll()) {
      activeReminderIds.add(reminder.id);
      if (!reminder.enabled || reminder.completed) {
        this.scheduleStates.delete(reminder.id);
        continue;
      }

      if (this.isReminderActive(reminder.id)) {
        continue;
      }

      if (!shouldRunToday(reminder, now)) {
        this.scheduleStates.delete(reminder.id);
        continue;
      }

      const targetTime = getTargetTime(reminder, todayKey);
      const scheduleState = this.getScheduleState(reminder, todayKey, targetTime, currentTime);
      if (scheduleState.triggered) {
        continue;
      }

      if (currentTime < targetTime) {
        scheduleState.wasBeforeTarget = true;
        continue;
      }

      // 只在本次运行中真实跨过触发点时弹出，避免启动或刚保存配置后对已过时间补弹。
      if (scheduleState.wasBeforeTarget) {
        scheduleState.triggered = true;
        await this.trigger(reminder, { source: 'schedule' });
      }
    }

    for (const reminderId of this.scheduleStates.keys()) {
      if (!activeReminderIds.has(reminderId)) {
        this.scheduleStates.delete(reminderId);
      }
    }
  }

  private findReminder(reminderId: string) {
    return this.store.getAll().find((reminder) => reminder.id === reminderId);
  }

  private scheduleNextTick() {
    if (!this.running) {
      return;
    }

    const nextWakeTime = this.getNextWakeTime(new Date());
    if (!nextWakeTime) {
      return;
    }

    const delayMs = Math.max(0, nextWakeTime - Date.now());
    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
  }

  private getNextWakeTime(now: Date) {
    const todayKey = toDateKey(now);
    const currentTime = now.getTime();
    let nextWakeTime = getNextMidnightTime(now);

    for (const reminder of this.store.getAll()) {
      if (!reminder.enabled || reminder.completed || this.isReminderActive(reminder.id)) {
        continue;
      }
      if (!shouldRunToday(reminder, now)) {
        continue;
      }

      const targetTime = getTargetTime(reminder, todayKey);
      const scheduleState = this.scheduleStates.get(reminder.id);
      if (targetTime > currentTime && !scheduleState?.triggered) {
        nextWakeTime = Math.min(nextWakeTime, targetTime);
      }
    }

    return nextWakeTime;
  }

  private clearTimer() {
    if (!this.timer) {
      return;
    }

    clearTimeout(this.timer);
    this.timer = null;
  }

  private getScheduleState(reminder: Reminder, todayKey: string, targetTime: number, currentTime: number) {
    const key = getScheduleStateKey(reminder, todayKey, targetTime);
    const existingState = this.scheduleStates.get(reminder.id);
    if (existingState && existingState.key === key) {
      return existingState;
    }

    const nextState: ReminderScheduleState = {
      key,
      wasBeforeTarget: currentTime < targetTime,
      triggered: false
    };
    this.scheduleStates.set(reminder.id, nextState);
    return nextState;
  }
}

function shouldRunToday(reminder: Reminder, date: Date) {
  if (reminder.todayOverrideTime && reminder.todayOverrideDate === toDateKey(date)) {
    return true;
  }

  if (reminder.repeatRule === 'once') {
    return reminder.scheduledDate === toDateKey(date);
  }
  return shouldReminderRunOnDate(reminder, date);
}

function getTargetTime(reminder: Reminder, todayKey: string) {
  const time = reminder.todayOverrideTime && reminder.todayOverrideDate === todayKey ? reminder.todayOverrideTime : reminder.dailyTime;
  const [hour = 18, minute = 0] = time.split(':').map(Number);
  const targetMinutes = Math.max(0, hour * 60 + minute - reminder.advanceMinutes);
  return new Date(`${todayKey}T00:00:00`).getTime() + targetMinutes * 60_000;
}

function getNextMidnightTime(date: Date) {
  const nextMidnight = new Date(date);
  nextMidnight.setHours(24, 0, 0, 0);
  return nextMidnight.getTime();
}

function getScheduleStateKey(reminder: Reminder, todayKey: string, targetTime: number) {
  return [
    todayKey,
    targetTime,
    reminder.repeatRule,
    reminder.scheduledDate,
    reminder.todayOverrideTime || '',
    reminder.todayOverrideDate || ''
  ].join('|');
}
