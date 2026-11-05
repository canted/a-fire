# Round presentation decisions

Status: Decided for implementation. Approved in the Round Storybook experiment on November 4, 2026.

This records visual and interaction decisions, not production completion. The candidate RoundPresentation is currently demonstrated by RoundTreatments.stories.tsx; live routes still need integration and acceptance.

## Decided

### Reading order and management

- Use the Prompt-led treatment. Quiet and Split are exploration alternatives, not competing implementation directions.
- Show the Round name in the app header, with a left caret returning to its Room home.
- Lead the content with the prompt. In progress, follow it with participation and the progress Wall. On completion, follow it with the completed work Wall.
- Keep completed-work cards and the shared Room-home Wall renderer unchanged. Reuse the canonical RoomWall/WallMember owners.
- Put statistics, timing and participation details below the Wall in subdued text. Do not repeat prominent totals above the Wall.
- After creation, emphasize reaching out to other people, rather than immediately contributing yourself.
- Provide a separate Manage Round page for editing, deadlines, outreach/reminders, participation administration and lifecycle actions. Editing is reached from that page.

### Typography

- Barlow Condensed identifies app objects: people, Rooms and Rounds. It is not the prompt or generic heading font.
- Use Poppins for the prominent prompt and section headings; use Lato for body text and statuses.
- Reduce prompt type size for long prompts; keep the full prompt readable without truncation. The approved experiment uses 28/38px for short prompts and 20/30px for prompts over 160 characters; these are the current visual reference.

### Participation and progress Wall

- Before choosing, offer the participation modes authorized for this Round. The experiment illustrates participating, giving feedback only and following; production must respect existing permissions and template capabilities.
- After choosing, collapse the choice to a quiet current-role label and Change action.
- Show Share something for participants eligible to share. Reviewers/followers do not receive that action merely because they have joined.
- Put the username/avatar outside and above each progress card, consistent with completed Wall cards.
- The white rounded card contains only the status and its icon. Center that group horizontally and vertically.
- Use 16px regular Lato with 24px line height and muted ink so the 18px bold object name remains stronger. Allow wrapping without clipping.
- Joined: one filled fat check in the existing blue token.
- Shared: two filled fat checks, first blue and second green.
- Giving feedback: the existing outline chat-teardrop icon.
- Following: the filled eyes icon.
- Keep the written status alongside the icons; color is not the sole state indicator.

### Creation form and language

- Use a plain labeled form without an enclosing card; text inputs have a white background.
- Use the existing ViewportToolbar and ViewportShell architecture, standard gutters and full-sized actions. Safe-area and keyboard behavior remain owned by the shell.
- Do not expose the internal term entry in Round UI. Use Share, Share something, Share from project, or context-specific work/contribution wording.

## Proposed

No competing visual treatment remains proposed for the reviewed main Round surface. Keep the experiment available as an implementation reference until integration is accepted.

## Open Questions

These are remaining implementation/review tasks, not unresolved choices about the approved design:

- Compose and review the Manage Round page, including authorized outreach actions and destructive-action confirmation.
- Apply the hierarchy to Art Before the Chorus's phase-specific cover selection, response creation and waiting states without changing its privacy rules.
- Verify contribution/share-from-project flows, Room Round listing/history, and real creation/edit routes against this language and hierarchy.
- Protect unsaved Round configuration through the existing draft-navigation owner.
- Verify authenticated routes, narrow and wide browsers, keyboard/focus/history, error recovery, reduced motion and actual iPhone safe-area behavior. Storybook approval is an intermediate gate.

## Source Research

- User-led review and iterative Storybook approvals in this chat, November 4, 2026.
- Storybook: Expo / Rounds / Experiments / Three treatments / Compare.
- Candidate: RoundPresentation.tsx; fixtures and controls: RoundTreatments.stories.tsx.
- Existing owners: RoomWall, wall/WallMember, RoundFormScreen, FeedbackRound, ArtRoundParticipant, ArtRoundHost, RoundResultView, ViewportToolbar and ViewportShell.
- Initial critique: .impeccable/critique/2026-11-04T22-37-30Z__frontend-src-features-rounds-roundformscreen-tsx.md (repository root).
