declare module 'pg' {
  export interface QueryResult<T = Record<string, unknown>> {
    rows: T[];
  }
  export class Client {
    constructor(config: Record<string, unknown>);
    connect(): Promise<void>;
    query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
    end(): Promise<void>;
  }
  const def: { Client: typeof Client };
  export default def;
}

declare module 'fs' {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding?: string): string;
  const def: {
    existsSync: typeof existsSync;
    readFileSync: typeof readFileSync;
  };
  export default def;
}
