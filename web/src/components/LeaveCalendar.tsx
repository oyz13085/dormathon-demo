import { useState } from 'react';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { enUS } from 'date-fns/locale/en-US';
import { theme } from '../theme';
import 'react-big-calendar/lib/css/react-big-calendar.css';

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales: { 'en-US': enUS },
});

export interface LeaveEvent {
  id: number;
  title: string;
  start: Date;
  end: Date;
  analystName: string;
  analystColor: string;
  approved: boolean;      // true = solid bar, false = hatched outline
  isPublicHoliday?: boolean;
}

interface Props {
  events: LeaveEvent[];
  onSelectEvent?: (event: LeaveEvent) => void;
}

export const ANALYST_COLORS: Record<string, string> = {
  'Aiman':    theme.colors.accent,
  'Mei Ling': theme.colors.ink,
  'Ravi':     theme.colors.sage,
  'Sarah':    theme.colors.sand,
  'Jun Wei':  '#7C6BCC',
};

function eventStyleGetter(event: LeaveEvent) {
  if (event.isPublicHoliday) {
    return { style: { background: theme.colors.grey, color: '#fff', borderRadius: 6, border: 'none', fontSize: 11 } };
  }
  if (event.approved) {
    return { style: { background: event.analystColor, color: '#fff', borderRadius: 6, border: 'none', fontSize: 11 } };
  }
  // Unapproved: outline + hatched
  return {
    style: {
      background: `repeating-linear-gradient(-45deg, ${event.analystColor}22 0px, ${event.analystColor}22 4px, transparent 4px, transparent 8px)`,
      color: event.analystColor,
      border: `1.5px solid ${event.analystColor}`,
      borderRadius: 6,
      fontSize: 11,
      fontWeight: 600,
    },
  };
}

export function LeaveCalendar({ events, onSelectEvent }: Props) {
  const [view, setView] = useState<'month' | 'week'>('month');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Legend + view pills */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {Object.entries(ANALYST_COLORS).map(([name, color]) => (
            <span key={name} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: theme.colors.grey }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: color }} />
              {name}
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['month', 'week'] as const).map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              padding: '4px 14px', borderRadius: theme.radius.pill, border: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: 600, textTransform: 'capitalize',
              background: view === v ? theme.colors.ink : theme.colors.track,
              color: view === v ? '#fff' : theme.colors.grey,
            }}>
              {v}
            </button>
          ))}
        </div>
      </div>

      <div style={{ '--rbc-today-highlight': theme.colors.accent + '18' } as React.CSSProperties}>
        <Calendar
          localizer={localizer}
          events={events}
          startAccessor="start"
          endAccessor="end"
          view={view}
          onView={v => (v === 'month' || v === 'week') && setView(v)}
          views={['month', 'week']}
          style={{ height: 500, fontFamily: theme.font.family, fontSize: 12 }}
          eventPropGetter={e => eventStyleGetter(e as LeaveEvent)}
          onSelectEvent={e => onSelectEvent?.(e as LeaveEvent)}
          toolbar={true}
        />
      </div>
    </div>
  );
}
