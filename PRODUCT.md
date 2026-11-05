# A Fire

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Artists, especially musicians, documenting their work process, sharing work with peers, and seeking feedback to inform future work.

## Product Purpose

Enable artists to iterate as a group and produce better work through community wisdom. Support a continuing loop of documenting, sharing, receiving feedback, and applying what is learned to future work.

## Positioning

A Fire treats the social aspect of creative work as a source of collective learning and constructive feedback. Its purpose differs from using peers mainly as pressure to meet goals or as an audience for publicity. This is the founder's intended positioning, not a verified claim about all competing products.

## Operating Context

Artists share work in progress and their process with peers in circles. A project collects work around one idea or end goal, such as a song. Feedback informs subsequent iterations. Invitations and sharing beyond a circle support porous boundaries and cross-pollination.

## Capabilities and Constraints

Repository evidence establishes an existing web application with circles, posts, replies, activities, notes, chat, and text and media workflows. Internal feature names are evidence of implementation, not authority for user-facing terminology.

Preserve the architecture and canonical ownership rules in `AGENTS.md`: shared UI components, CSS Modules and design tokens, centralized routes, SWR-powered data hooks, and the established editor, viewport, image, draft/publishing, and audio systems.

### Confirmed terminology

- **Circle:** a group.
- **Project:** a collection of work around one idea or end goal, such as a song.
- **Feedback:** replies on work.
- **Keep / kept:** the action and language for saving feedback or messages.
- **Activity:** a specific instance people join and participate in.
- **Activity template:** the reusable prompts, steps, timing, participation and visibility rules used to start an activity.
- **Activity composer:** the template-authoring interface, when a visible name is needed; “Customize template” can open it directly.
- **Activity setup:** configuring participants, dates and settings before starting an activity.
- **Activity actions:** Choose a template, Customize template, Start activity, Join activity.
- **Entry:** a contribution to a project, with an optional title and body and any number of attached media items.

### Open decisions

- The vocabulary is incomplete. Confirm additional terms with the founder rather than carrying vestigial code terminology into the interface.
- The constructive-critique reference mentioned during initialization was not supplied. Its specific norms remain to be documented.
- Concrete success measures and product-specific accessibility requirements have not yet been established.

## Brand Commitments

The product name is **A Fire**. The existing site uses **“gather round”** (`frontend/site/features/site/SitePage.tsx`). No additional voice or visual direction was established during initialization.

## Evidence on Hand

- Founder-confirmed audience, purpose, positioning, principles, and terminology from the initialization conversation.
- `README.md`: stack, development workflow, and application structure.
- `AGENTS.md`: authoritative architecture constraints and canonical implementation registry.
- `frontend/src/app`: application surfaces and routes.
- `frontend/site/features/site/SitePage.tsx`: existing name and tagline.

These sources do not establish customer testimonials, measured outcomes, or comparative performance claims; do not invent them.

## Product Principles

- **Psychological safety:** support turn taking and participation that is safe for artists sharing unfinished work.
- **Intellectual diversity and porous boundaries:** encourage cross-pollination, good invitations, and sharing outside the circle.
- **Constructive critique and rapid feedback loops:** help peers provide useful feedback that informs the next iteration; specific critique norms remain open.
- **Shared purpose:** orient group activity toward better creative work through community wisdom.
- **Low barriers to participation:** make it easy for artists to contribute work, process, and feedback.

### Activity terminology compatibility

Activities use the existing database tables through Prisma mappings; historical migrations and physical identifiers remain unchanged. Legacy /rounds URLs and API paths remain aliases for the same activity features. Persisted notification event codes, job queue names, contribution-origin codes, and chat milestone identities retain their historical values so existing records and queued work remain valid. New API/model names use activity and template terminology; readers accept historical notification/chat payloads. Harmonomicon defines reusable activity packages; a future Activity composer authors templates, rather than changing an already running activity.

### Identity shapes

Room identity icons are slightly rounded squares throughout the app, using the shared `RoomIcon` and existing 3.2px corner token. This includes uploaded images and generated fallbacks. User identities remain circular or striped; project identity shapes retain their existing treatment.

### Shared page edges and navigation

App bars, page content, and bottom toolbars share the existing 12 px spacing token for their horizontal edges, with device safe areas applied once. Desktop centering and maximum width remain independent. Align visible controls and card surfaces, while retaining usable touch targets and internal card spacing. Room app bars also use 12 px top and bottom spacing around their 40 px controls.

Home navigation never appears in a bottom toolbar. Top app bars own page escape; bottom toolbars hold composer and contextual actions. Their existing bottom clearance, rounded-device-corner spacing, and software-keyboard behavior remain separate from the horizontal gutter.
