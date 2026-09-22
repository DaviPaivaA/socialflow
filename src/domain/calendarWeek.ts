export function getCurrentWeek(today: Date): Date[] {
  const mondayOffset = (today.getDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, index) =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - mondayOffset + index),
  );
}

export function getCurrentWeekLabel(today: Date): string {
  const week = getCurrentWeek(today);
  const first = week[0];
  const last = week[6];
  const month = (date: Date) =>
    new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(date).toUpperCase();

  if (first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear()) {
    return `${first.getDate()} — ${last.getDate()} DE ${month(first)} DE ${first.getFullYear()}`;
  }
  return `${first.getDate()} DE ${month(first)} DE ${first.getFullYear()} — ${last.getDate()} DE ${month(last)} DE ${last.getFullYear()}`;
}
