import { afterEach, describe, expect, it } from "vitest";
import {
  createTask,
  deleteTask,
  getTasks,
  getTaskViewModels,
  getWeeklyOverview,
  getWeeklyProgress,
  toggleTaskOccurrence,
  updateTask,
} from "@/lib/tasks";
import { createTestUser, deleteTestUser } from "@/lib/testing/test-users";

// See specs/user-login.md "Testing Requirements" — cross-user task
// isolation is this feature's highest-priority coverage: every function
// here scopes its query by userId (FR5.9), and a task id belonging to a
// different user must behave exactly as if it doesn't exist (FR5.11).

describe("cross-user task isolation", () => {
  const userIdsToClean: string[] = [];

  afterEach(async () => {
    await Promise.all(userIdsToClean.splice(0).map(deleteTestUser));
  });

  async function makeUser() {
    const user = await createTestUser();
    userIdsToClean.push(user.id);
    return user;
  }

  it("getTasks only returns the caller's own tasks", async () => {
    const alice = await makeUser();
    const bob = await makeUser();

    await createTask(alice.id, { title: "Alice's errand", notes: null, recurrence: null });
    await createTask(bob.id, { title: "Bob's errand", notes: null, recurrence: null });

    const aliceTasks = await getTasks(alice.id);
    const bobTasks = await getTasks(bob.id);

    expect(aliceTasks.map((t) => t.title)).toEqual(["Alice's errand"]);
    expect(bobTasks.map((t) => t.title)).toEqual(["Bob's errand"]);
  });

  it("updateTask on another user's task id behaves as not found and leaves it unmodified", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const aliceTask = await createTask(alice.id, { title: "Alice's errand", notes: null, recurrence: null });

    const result = await updateTask(bob.id, aliceTask.id, {
      title: "Hijacked by Bob",
      notes: null,
      recurrence: null,
    });
    expect(result).toBeNull();

    const [stillAlices] = await getTasks(alice.id);
    expect(stillAlices.title).toBe("Alice's errand");
  });

  it("deleteTask on another user's task id is a no-op", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const aliceTask = await createTask(alice.id, { title: "Alice's errand", notes: null, recurrence: null });

    await deleteTask(bob.id, aliceTask.id);

    const aliceTasks = await getTasks(alice.id);
    expect(aliceTasks).toHaveLength(1);
    expect(aliceTasks[0].title).toBe("Alice's errand");
  });

  it("toggleTaskOccurrence on another user's task id is a no-op", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const aliceTask = await createTask(alice.id, { title: "Alice's errand", notes: null, recurrence: null });

    const result = await toggleTaskOccurrence(bob.id, aliceTask.id);
    expect(result).toBeNull();

    const [stillAlices] = await getTasks(alice.id);
    expect(stillAlices.completed).toBe(false);
  });

  it("getTaskViewModels and getWeeklyOverview never include another user's tasks", async () => {
    const alice = await makeUser();
    const bob = await makeUser();

    await createTask(alice.id, { title: "Alice daily", notes: null, recurrence: { type: "daily" } });
    await createTask(bob.id, { title: "Bob daily", notes: null, recurrence: { type: "daily" } });

    const now = new Date();

    const aliceViewModels = await getTaskViewModels(alice.id);
    expect(aliceViewModels.map((v) => v.task.title)).toEqual(["Alice daily"]);

    const aliceOverview = await getWeeklyOverview(alice.id, now, now);
    const aliceOverviewTitles = aliceOverview.days.flatMap((day) => day.items.map((item) => item.task.title));
    expect(aliceOverviewTitles).not.toContain("Bob daily");
    expect(aliceOverviewTitles.every((title) => title === "Alice daily")).toBe(true);
  });

  it("getWeeklyProgress totals are unaffected by another user's tasks", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const now = new Date();

    await createTask(alice.id, { title: "Alice daily", notes: null, recurrence: { type: "daily" } });
    const aliceProgressBefore = await getWeeklyProgress(alice.id, now);

    await createTask(bob.id, { title: "Bob daily", notes: null, recurrence: { type: "daily" } });
    const aliceProgressAfter = await getWeeklyProgress(alice.id, now);

    expect(aliceProgressAfter).toEqual(aliceProgressBefore);
  });
});
