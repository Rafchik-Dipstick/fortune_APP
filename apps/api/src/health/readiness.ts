export type ComponentReadiness = 'ready' | 'not_ready';

export interface ApiReadinessSnapshot {
  checks: {
    database: ComponentReadiness;
    process: ComponentReadiness;
  };
  status: ComponentReadiness;
}

export type DatabaseReadinessProbe = () => Promise<void>;

export class ApiReadiness {
  readonly #checkDatabase: DatabaseReadinessProbe;
  #acceptingTraffic = true;

  constructor(checkDatabase: DatabaseReadinessProbe) {
    this.#checkDatabase = checkDatabase;
  }

  stopAcceptingTraffic(): void {
    this.#acceptingTraffic = false;
  }

  async inspect(): Promise<ApiReadinessSnapshot> {
    if (!this.#acceptingTraffic) {
      return {
        checks: {
          database: 'not_ready',
          process: 'not_ready',
        },
        status: 'not_ready',
      };
    }

    try {
      await this.#checkDatabase();
      return {
        checks: {
          database: 'ready',
          process: 'ready',
        },
        status: 'ready',
      };
    } catch {
      return {
        checks: {
          database: 'not_ready',
          process: 'ready',
        },
        status: 'not_ready',
      };
    }
  }
}
