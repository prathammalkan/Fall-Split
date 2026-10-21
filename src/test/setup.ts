import '@testing-library/jest-dom';
import { vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

// Mock Supabase — tests must not make real network calls
vi.mock('../lib/supabase', () => ({
  db: {
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  },
}));

// Mock IndexedDB for offline queue tests
if (typeof indexedDB === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).indexedDB = new IDBFactory();
}
