import type { Position } from "./graph";

/** The part of a Canvas card an animation needs. */
export interface MovableNode {
  getData(): Position;
  moveTo(pos: Position): void;
}

interface Track {
  node: MovableNode;
  from: Position;
  to: Position;
}

export const MOTION_MS = 220;
/** Past this many cards an animation costs more than it shows. */
export const MOTION_LIMIT = 400;

/** Ease-out cubic: quick to start, gentle to land. */
export function ease(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - clamped, 3);
}

/**
 * Glide cards from where they were to where a layout put them. The layout is
 * already applied, saved, and recorded in the undo history when an animation
 * starts; the animation only replays the way there. Each frame moves the
 * cards through Canvas itself, so their connections follow them.
 */
export class Motion {
  private tracks: Track[] = [];
  private frame = 0;
  private started = 0;
  private done: (() => void) | null = null;

  constructor(
    private win: Window,
    private alive: (node: MovableNode) => boolean,
    private duration = MOTION_MS,
    /** Runs after each frame moves the cards, for what is drawn around them. */
    private onFrame: () => void = () => {},
  ) {}

  get active(): boolean {
    return this.tracks.length > 0;
  }

  /** Cards to move from `from` to where they are now; `done` runs once they land. */
  play(moves: Iterable<[MovableNode, Position]>, done: () => void = () => {}): boolean {
    this.finish();
    const tracks: Track[] = [];
    for (const [node, from] of moves) {
      if (!this.alive(node)) continue;
      const to = node.getData();
      if (from.x === to.x && from.y === to.y) continue;
      tracks.push({ node, from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y } });
    }
    if (!tracks.length || tracks.length > MOTION_LIMIT) return false;
    this.tracks = tracks;
    this.done = done;
    for (const track of tracks) track.node.moveTo(track.from);
    this.onFrame();
    this.started = this.now();
    this.frame = this.win.requestAnimationFrame(this.step);
    return true;
  }

  /** Land every card at once, as when the user starts something new. */
  finish() {
    if (!this.tracks.length) return;
    if (this.frame) this.win.cancelAnimationFrame(this.frame);
    this.frame = 0;
    const tracks = this.tracks;
    const done = this.done;
    this.tracks = [];
    this.done = null;
    for (const track of tracks) this.place(track, 1);
    this.onFrame();
    done?.();
  }

  private step = () => {
    this.frame = 0;
    const progress = (this.now() - this.started) / this.duration;
    if (progress >= 1) {
      this.finish();
      return;
    }
    const eased = ease(progress);
    for (const track of this.tracks) this.place(track, eased);
    this.onFrame();
    this.frame = this.win.requestAnimationFrame(this.step);
  };

  private place(track: Track, t: number) {
    if (!this.alive(track.node)) return;
    const x = Math.round(track.from.x + (track.to.x - track.from.x) * t);
    const y = Math.round(track.from.y + (track.to.y - track.from.y) * t);
    const current = track.node.getData();
    if (current.x !== x || current.y !== y) track.node.moveTo({ x, y });
  }

  private now(): number {
    return this.win.performance?.now?.() ?? Date.now();
  }
}
