# Seed Data

Section 03 introduced the first real schema (`../migrations/`) but adds
**no seed data here** — per the section's explicit rules: do not seed
fake customers, fake licenses, or a fake OWNER. `platform_settings`
starts with its one singleton row (inserted by its own migration, not
seed data) and `owner_bootstrapped_at` unset; establishing the first real
OWNER is a deliberate, secret-gated, one-time operation
(`bootstrapOwner()` — see `docs/architecture/AUTHORIZATION.md`), not
something a seed script should do.

If reference/config data is ever added here (e.g. subscription plan
definitions), it must remain exactly that — reference data, never
fabricated picks, results, performance numbers, or anything presented as
a real customer, license, or user.
