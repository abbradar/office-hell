// Per-stage scoreboard. Lives on `StageManager` for the manager's
// lifetime — switching scenes constructs a new manager, which is the
// reset. Wave / boss scripts read these counters to drive end-of-fight
// quips (e.g. coach's "you got angry N times…"); future stats can land
// here without re-plumbing.
export class GameScore {
  bombsUsed = 0;
  enemiesKilled = 0;
  hpLost = 0;
}
