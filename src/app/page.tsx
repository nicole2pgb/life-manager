import { getTasks } from "@/lib/tasks";
import { TaskForm } from "@/components/tasks/task-form";
import { TaskList } from "@/components/tasks/task-list";

export default function Home() {
  const tasks = getTasks();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-12 sm:px-6">
      <header>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Tasks</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Create, edit, and complete your tasks.
        </p>
      </header>
      <TaskForm />
      <TaskList tasks={tasks} />
    </div>
  );
}
