import type { Task } from "@/lib/task-types";
import { TaskItem } from "@/components/tasks/task-item";

export function TaskList({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        No tasks yet. Add your first task above.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {tasks.map((task) => (
        <TaskItem key={task.id} task={task} />
      ))}
    </ul>
  );
}
