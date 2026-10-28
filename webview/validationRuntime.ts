// Webviews forbid eval. Disable Zod's optional JIT before evaluating any UI schema.
import { config } from 'zod/v4';
config({ jitless: true });
export * from 'zod/v4';
