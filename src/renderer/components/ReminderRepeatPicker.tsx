import { DEFAULT_WORK_WEEK_DAYS, WEEK_DAYS } from '../../shared/reminderConstants';
import { getAlternateWeekCycleSlot } from '../../shared/reminderSchedule';
import type { Reminder } from '../../shared/types';
import { getNextRepeatDateKey, toDateKey } from '../domain/dateTimeInput';
import {
  getWorkdayRepeatDefaults,
  toggleDay
} from '../domain/reminderText';

type ReminderRepeatPickerProps = {
  reminder: Reminder;
  workdayReminder?: Reminder;
  allowNoRepeat?: boolean;
  alternateDefaultDays?: number[];
  onChange: (patch: Partial<Reminder>) => void;
};

export function ReminderRepeatPicker(props: ReminderRepeatPickerProps) {
  const { reminder, workdayReminder, allowNoRepeat = false, alternateDefaultDays = DEFAULT_WORK_WEEK_DAYS, onChange } = props;
  const repeatEnabled = !allowNoRepeat || reminder.repeatRule !== 'once';
  const useAlternateWeeks = Boolean(reminder.useAlternateWeeks || reminder.repeatRule === 'alternate-weeks');
  const workdayRepeatDefaults = getWorkdayRepeatDefaults(workdayReminder, alternateDefaultDays);
  const fallbackWeeklyDays = repeatEnabled && reminder.weeklyDays?.length ? reminder.weeklyDays : workdayRepeatDefaults.weeklyDays;
  const fallbackAlternateWeekDays = useAlternateWeeks && reminder.alternateWeekDays?.length ? reminder.alternateWeekDays : workdayRepeatDefaults.alternateWeekDays;
  const fallbackAlternateNextWeekDays = useAlternateWeeks && reminder.alternateNextWeekDays?.length ? reminder.alternateNextWeekDays : workdayRepeatDefaults.alternateNextWeekDays;
  const alternateWeekAnchorDate = reminder.alternateWeekAnchorDate || workdayRepeatDefaults.alternateWeekAnchorDate || toDateKey(new Date());
  const alternateWeekReference = { ...reminder, alternateWeekAnchorDate };
  const currentWeekSlot = getAlternateWeekCycleSlot(alternateWeekReference, new Date());
  const nextWeekSlot = currentWeekSlot === 'anchor' ? 'next' : 'anchor';
  const currentWeekDays = currentWeekSlot === 'anchor' ? fallbackAlternateWeekDays : fallbackAlternateNextWeekDays;
  const nextWeekDays = nextWeekSlot === 'anchor' ? fallbackAlternateWeekDays : fallbackAlternateNextWeekDays;

  function updateRepeatEnabled(nextRepeatEnabled: boolean) {
    if (!nextRepeatEnabled) {
      onChange({
        repeatRule: 'once',
        useAlternateWeeks: false,
        weeklyDays: fallbackWeeklyDays,
        scheduledDate: reminder.scheduledDate || toDateKey(new Date())
      });
      return;
    }
    updateRepeatPatch({
      useAlternateWeeks: false,
      weeklyDays: fallbackWeeklyDays
    });
  }

  function updateRepeatPatch(patch: Partial<Reminder>) {
    const nextReminder: Reminder = {
      ...reminder,
      weeklyDays: fallbackWeeklyDays,
      ...patch,
      repeatRule: 'weekly'
    };
    onChange({
      ...patch,
      repeatRule: 'weekly',
      weeklyDays: nextReminder.weeklyDays,
      scheduledDate: getNextRepeatDateKey(nextReminder)
    });
  }

  function toggleWeekDay(day: number) {
    updateRepeatPatch({
      weeklyDays: toggleDay(fallbackWeeklyDays, day),
      useAlternateWeeks: false
    });
  }

  function toggleAlternateDay(week: 'current' | 'next', day: number) {
    const slot = week === 'current' ? currentWeekSlot : nextWeekSlot;
    if (slot === 'anchor') {
      updateRepeatPatch({
        useAlternateWeeks: true,
        alternateWeekAnchorDate,
        alternateWeekDays: toggleDay(fallbackAlternateWeekDays, day),
        alternateNextWeekDays: fallbackAlternateNextWeekDays
      });
      return;
    }
    updateRepeatPatch({
      useAlternateWeeks: true,
      alternateWeekAnchorDate,
      alternateWeekDays: fallbackAlternateWeekDays,
      alternateNextWeekDays: toggleDay(fallbackAlternateNextWeekDays, day)
    });
  }

  function updateAlternateWeeks(nextUseAlternateWeeks: boolean) {
    updateRepeatPatch({
      useAlternateWeeks: nextUseAlternateWeeks,
      alternateWeekAnchorDate: nextUseAlternateWeeks ? alternateWeekAnchorDate : reminder.alternateWeekAnchorDate,
      alternateWeekDays: fallbackAlternateWeekDays,
      alternateNextWeekDays: fallbackAlternateNextWeekDays
    });
  }

  return (
    <section className="repeat-picker">
      <div className="repeat-heading">
        <span>重复</span>
        <div className="repeat-switches">
          {allowNoRepeat && (
            <label className="switch-row">
              <input
                type="checkbox"
                checked={repeatEnabled}
                onChange={(event) => updateRepeatEnabled(event.target.checked)}
              />
              <span>重复</span>
            </label>
          )}
          <label className="switch-row">
            <input
              type="checkbox"
              checked={useAlternateWeeks}
              disabled={!repeatEnabled}
              onChange={(event) => updateAlternateWeeks(event.target.checked)}
            />
            <span>大小周</span>
          </label>
        </div>
      </div>

      {repeatEnabled && useAlternateWeeks ? (
        <div className="alternate-week-rows">
          <WeekdayPicker
            label="本周"
            selectedDays={currentWeekDays}
            onToggle={(day) => toggleAlternateDay('current', day)}
          />
          <WeekdayPicker
            label="下周"
            selectedDays={nextWeekDays}
            onToggle={(day) => toggleAlternateDay('next', day)}
          />
        </div>
      ) : repeatEnabled ? (
        <WeekdayPicker selectedDays={fallbackWeeklyDays} onToggle={toggleWeekDay} />
      ) : (
        <div className="repeat-empty-state">不重复</div>
      )}
    </section>
  );
}

type WeekdayPickerProps = {
  label?: string;
  selectedDays: number[];
  onToggle: (day: number) => void;
};

function WeekdayPicker(props: WeekdayPickerProps) {
  const { label, selectedDays, onToggle } = props;
  return (
    <div className={label ? 'weekday-line' : 'weekday-line single-weekday-line'}>
      {label && <span>{label}</span>}
      <div className="weekday-row">
        {WEEK_DAYS.map((day) => (
          <button
            type="button"
            key={day.value}
            className={selectedDays.includes(day.value) ? 'selected' : ''}
            onClick={() => onToggle(day.value)}
          >
            {day.label}
          </button>
        ))}
      </div>
    </div>
  );
}
