import { contributionCalendar, homeActivityPriorities, homeFeaturedTask } from "../../../../frontend/src/lib/homeModel";
import type { HomeSnapshot } from "../../../../frontend/src/lib/homeModel";
import type { RoundDetail } from "../../../../frontend/src/lib/api/rounds";

const item = (id: string, joined: boolean, submitted = false): HomeSnapshot["rounds"][number] => ({ roomName: id, detail: { round: { id, status: "active" }, phase: "submission", viewerState: { role: joined ? "participant" : null, status: joined ? "active" : null, canSubmit: joined, submittedEntryId: submitted ? "10" : null, canJoin: !joined }, submissions: [] } as unknown as RoundDetail });
describe("home round priorities", () => {
  it("puts an unfinished joined round ahead of discovery and completed tasks", () => {
    const priorities = homeActivityPriorities([item("discovery", false), item("submitted", true, true), item("task", true)]);
    expect(priorities[0].detail.round.id).toBe("task");
    expect(priorities[0].actions[0].label).toBe("Share");
  });
  it("does not present inactive rounds as current tasks", () => {
    const archived = item("archived", true); archived.detail.round.status = "archived";
    expect(homeActivityPriorities([archived])).toEqual([]);
  });
});
describe("project contribution calendar", () => {
  it("orders each week top to bottom with the latest week on the right", () => {
    const days = contributionCalendar("2026-10-05", [{ date: "2026-10-04", count: 2 }, { date: "2026-10-05", count: 1 }], 2);
    expect(days).toHaveLength(14);
    expect(days[0]).toEqual({ date: "2026-09-28", count: 0, future: false });
    expect(days[6]).toEqual({ date: "2026-10-04", count: 2, future: false });
    expect(days[7]).toEqual({ date: "2026-10-05", count: 1, future: false });
    expect(days[8].future).toBe(true);
  });
  it("uses calendar arithmetic across month and year boundaries", () => {
    const days = contributionCalendar("2027-01-01", [], 2);
    expect(days[0].date).toBe("2026-12-21");
    expect(days[11].date).toBe("2027-01-01");
    expect(days[12].future).toBe(true);
  });
});


describe("shared compact Home task", () => {
  it("keeps the selected current task prompt and destination instead of substituting a recent Room", () => {
    const task = item("12", true);
    task.currentTask = { prompt: "Read work and give feedback." };
    const discovery = item("13", false);
    const data = { rounds: [discovery, task], recentRooms: [], featuredRoundId: "12" };
    expect(homeFeaturedTask(data)).toMatchObject({ text: "Read work and give feedback.", href: "/app/rounds/12", canJoin: false });
    expect(homeFeaturedTask({ ...data, rounds: [] })).toBeUndefined();
  });
});
