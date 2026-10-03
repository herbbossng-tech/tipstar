// Vitest global setup (Section 09). Registered via the root
// `vitest.config.ts`'s `test.setupFiles` — runs for every test in the
// monorepo, but only ever touches jsdom/@testing-library state, which is
// a safe no-op for the hundreds of existing "node" environment tests
// that never call `render()` (there is nothing for `cleanup()` to clean
// up). Without this, a jsdom component test's rendered DOM leaks into
// the next test in the same file (React Testing Library does not
// auto-register cleanup under Vitest the way it does under Jest).
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
