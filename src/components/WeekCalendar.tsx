import { calendarDays } from "../data/mockData";

type WeekCalendarProps = {
  compact?: boolean;
};

export function WeekCalendar({ compact = false }: WeekCalendarProps) {
  return (
    <div className={"week-calendar " + (compact ? "compact" : "")}>
      {calendarDays.map((day) => (
        <div
          className={"calendar-day " + (day.today ? "today" : "")}
          key={day.day}
        >
          <div className="day-head">
            <span>{day.day}</span>
            <strong>{day.date}</strong>
          </div>
          <div className="day-content">
            {day.items.map((item) => (
              <button
                className={"calendar-item " + item.color}
                key={item.name}
                type="button"
              >
                <span>{item.time}</span>
                <strong>{item.name}</strong>
              </button>
            ))}
            {!day.items.length && <span className="empty-day">Livre</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
