# Project commands

Keep `bin` for recurring development, build, test, deployment, and operational
commands. Helpers used by those commands may remain here until they move with
their owning implementation.

Task-specific scripts live beside the work they support:

- Database remediation measurements and preserved-restore investigations:
  [`server/prisma/inventory/scripts`](../server/prisma/inventory/scripts/README.md).
- Isolated Room-sharing browser harness:
  [`tests/e2e/expo/check-room-sharing-browser.cjs`](../tests/e2e/expo/check-room-sharing-browser.cjs).
- Frozen Round walkthrough verification:
  [`tests/e2e/rooms/verify-round-walkthrough.mjs`](../tests/e2e/rooms/verify-round-walkthrough.mjs).
- Waveform lab and Storybook audio fixture preparation:
  [`frontend/scripts/prepare-waveform-lab.mjs`](../frontend/scripts/prepare-waveform-lab.mjs)
  and [`frontend/scripts/prepare-storybook-audio.mjs`](../frontend/scripts/prepare-storybook-audio.mjs).

Run these scripts from the repository root. Do not add dated investigations,
fixture-specific checks, or experiment utilities to `bin` merely to make them
convenient to run.
