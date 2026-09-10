import type { TaskViewModel } from "@/lib/task-types";
import { TaskItem } from "@/components/tasks/task-item";

export function TaskList({ tasks }: { tasks: TaskViewModel[] }) {
  if (tasks.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        No tasks yet. Add your first task above.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {tasks.map(({ task, isDueToday, isCompletedToday, weeklyCompletedCount }) => (
        <TaskItem
          key={task.id}
          task={task}
          isDueToday={isDueToday}
          isCompletedToday={isCompletedToday}
          weeklyCompletedCount={weeklyCompletedCount}
        />
      ))}
    </ul>
  );
}
