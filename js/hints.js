// Help measures understanding, not how often a player presses the shutter.
// Pure state so automatic hints can be checked without a renderer.
export class HintState {
  constructor() { this.idle = 0; this.failures = 0; this.seen = new Set(); this.attempts = new Map(); this.shown = 0; }
  step(dt) { this.idle += Math.max(0, dt); }
  progress(key) {
    if (this.seen.has(key)) return false;
    this.seen.add(key); this.idle = 0; this.failures = 0; this.attempts.clear();
    return true;
  }
  attempt(key) {
    const n = (this.attempts.get(key) || 0) + 1;
    this.attempts.set(key, n);
    if (n > 1) this.failures++;
  }
  fail() { this.failures++; }
  due() {
    if (this.shown === 0 && (this.idle >= 70 || this.failures >= 6)) return 1;
    if (this.shown === 1 && (this.idle >= 150 || this.failures >= 12)) return 2;
    return 0;
  }
  revealed(tier) { this.shown = Math.max(this.shown, tier); }
}
