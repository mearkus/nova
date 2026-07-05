export type InputSnapshot = {
  active: boolean;
  normalizedX: number;
  normalizedY: number;
  keyboardX: number;
};

export class InputController {
  private activePointerId: number | null = null;
  private readonly keys = new Set<string>();
  private snapshot: InputSnapshot = {
    active: false,
    normalizedX: 0.5,
    normalizedY: 0.78,
    keyboardX: 0,
  };

  constructor(private readonly target: HTMLElement) {
    this.target.addEventListener("pointerdown", this.handlePointerDown);
    this.target.addEventListener("pointermove", this.handlePointerMove);
    this.target.addEventListener("pointerup", this.handlePointerEnd);
    this.target.addEventListener("pointercancel", this.handlePointerEnd);
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
  }

  get state(): InputSnapshot {
    return this.snapshot;
  }

  dispose(): void {
    this.target.removeEventListener("pointerdown", this.handlePointerDown);
    this.target.removeEventListener("pointermove", this.handlePointerMove);
    this.target.removeEventListener("pointerup", this.handlePointerEnd);
    this.target.removeEventListener("pointercancel", this.handlePointerEnd);
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
  }

  private updatePointer(clientX: number, clientY: number): void {
    const rect = this.target.getBoundingClientRect();
    const x = (clientX - rect.left) / Math.max(1, rect.width);
    const y = (clientY - rect.top) / Math.max(1, rect.height);

    this.snapshot = {
      ...this.snapshot,
      active: true,
      normalizedX: clamp(x, 0, 1),
      normalizedY: clamp(y, 0, 1),
    };
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.activePointerId = event.pointerId;
    this.target.setPointerCapture(event.pointerId);
    this.updatePointer(event.clientX, event.clientY);
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (this.activePointerId !== event.pointerId) {
      return;
    }

    this.updatePointer(event.clientX, event.clientY);
  };

  private readonly handlePointerEnd = (event: PointerEvent): void => {
    if (this.activePointerId !== event.pointerId) {
      return;
    }

    this.activePointerId = null;
    this.snapshot = { ...this.snapshot, active: false };
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) {
      return;
    }

    this.keys.add(event.key);
    this.updateKeyboardAxis();
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.key);
    this.updateKeyboardAxis();
  };

  private updateKeyboardAxis(): void {
    const left = this.keys.has("ArrowLeft") || this.keys.has("a") || this.keys.has("A");
    const right = this.keys.has("ArrowRight") || this.keys.has("d") || this.keys.has("D");
    const keyboardX = Number(right) - Number(left);

    this.snapshot = { ...this.snapshot, keyboardX };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
