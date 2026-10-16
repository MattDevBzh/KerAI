import type { AccountCredits } from '../shared/credits';

/** Poll the account only while the cockpit can display the result. */
export class AccountCreditsMonitor {
  private visible = false;
  private disposed = false;
  private busy = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private credits: AccountCredits | undefined;

  constructor(
    private readonly read: () => Promise<AccountCredits>,
    private readonly publish: (credits: AccountCredits) => void,
  ) {}

  setVisible(visible: boolean): void {
    if (this.disposed || this.visible === visible) return;
    this.visible = visible;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (!visible) return;
    if (this.credits) this.publish(this.credits);
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), 10_000);
  }

  async refresh(): Promise<void> {
    if (this.disposed || !this.visible || this.busy) return;
    this.busy = true;
    try {
      this.credits = await this.read();
    } catch {
      this.credits = {
        state: 'unavailable',
        message: 'Actualisation des crédits indisponible.',
      };
    } finally {
      this.busy = false;
    }
    if (!this.disposed && this.visible) this.publish(this.credits);
  }

  dispose(): void {
    this.disposed = true;
    this.visible = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
