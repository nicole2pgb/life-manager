export type Task = {
  id: string;
  title: string;
  notes: string | null;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
};

export const TASK_TITLE_MAX_LENGTH = 200;
export const TASK_NOTES_MAX_LENGTH = 2000;
