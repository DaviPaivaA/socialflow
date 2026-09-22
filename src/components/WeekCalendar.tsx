import { getPostPresentationColor, getPostTitle } from "../domain/postPresentation";
import { formatScheduledTime, getScheduledTimestamp } from "../domain/scheduling";
import { getCurrentWeek } from "../domain/calendarWeek";
import type { Post } from "../types/social";

type WeekCalendarProps = {
  compact?: boolean;
  posts: readonly Post[];
  today?: Date;
};

const WEEKDAYS = ["SEG", "TER", "QUA", "QUI", "SEX", "SÁB", "DOM"];

function isSameLocalDay(first: Date, second: Date): boolean {
  return first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate();
}

export function WeekCalendar({ compact = false, posts, today = new Date() }: WeekCalendarProps) {
  const scheduledPosts = posts
    .map((post) => ({ post, timestamp: getScheduledTimestamp(post.scheduledFor) }))
    .filter((entry): entry is { post: Post; timestamp: number } => entry.timestamp !== null)
    .sort((left, right) => left.timestamp - right.timestamp || left.post.id.localeCompare(right.post.id));

  return (
    <div className={"week-calendar " + (compact ? "compact" : "")}>
      {getCurrentWeek(today).map((date, index) => {
        const dayPosts = scheduledPosts.filter(({ timestamp }) => isSameLocalDay(new Date(timestamp), date));
        return (
          <div className={"calendar-day " + (isSameLocalDay(date, today) ? "today" : "")} key={date.toDateString()}>
            <div className="day-head">
              <span>{WEEKDAYS[index]}</span>
              <strong>{date.getDate()}</strong>
            </div>
            <div className="day-content">
              {dayPosts.map(({ post }) => (
                <div className={"calendar-item " + getPostPresentationColor(post)} key={post.id}>
                  <span>{formatScheduledTime(post.scheduledFor)}</span>
                  <strong>{getPostTitle(post)}</strong>
                </div>
              ))}
              {dayPosts.length === 0 && <span className="empty-day">Livre</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
