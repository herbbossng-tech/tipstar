# Migrations

No migrations exist yet. Per the Master Blueprint V1.0, Section 01 does
not create the production schema — that is Section 03's job. Nothing in
this codebase currently requires a database table: identity, license, and
Telegram destination management are all typed contracts
(`@sport-os/platform`, `@sport-os/telegram`) with `NotImplemented*`
default implementations until Section 03 provides a real, persisted
implementation.

When Section 03 adds the first migration, delete this file.
