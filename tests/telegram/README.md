Cross-package Telegram integration tests. `authentication-flow.test.ts`
(Section 02) exercises the real authentication + session pipeline against
`@sport-os/platform`'s audit service. Further tests here — e.g. Publishing
Policy Engine wired to a real destination catalog — wait on Section 03's
persistence. See `../README.md`. Package-level Telegram tests live in
`packages/telegram/src/*.test.ts`.
