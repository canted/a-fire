# Shared Room Wall

## Implementation plan and ownership

The preceding naming changes were committed as `aebbdd7e`. This consolidation preserves the Room/Result persistence boundary and the existing HTTP and cache contracts.

- `RoomHome` owns live Room loading/error presentation, current-Round context, scroll restoration and the history action. Its existing `useRoomHome` hook supplies authorized data.
- `RoundResultView` owns result metadata, history navigation, focus, scroll restoration, embedded EntryFlow and Round actions. `useRoundResult` is the renamed existing hook, including viewed-state acknowledgement.
- `wallModel.ts` adapts those two authorized responses to `WallMemberModel`. Live selection retains `selectWallProcess`; Round results preserve supplied selection and order, including unavailable entries. No adapter fetches private source Entries.
- `RoomWall` owns the shared paired layout and empty/unavailable presentation. It has no fetching, sorting, navigation or scrolling responsibilities.
- `WallMember` owns the shared identity, Entry, statement and feedback presentation extracted from the live Wall. `WallProcessPreview` is a Storybook treatment adapter to that same renderer; production does not depend on it.

Round-result items use one Entry slot each, retaining their explicitly shared statement/feedback in EntryContent. Live members may have multiple context slots selected by the existing live policy. The common presentation must not apply live recency selection to a saved result.

## Verification scope

Check both adapters, empty and unavailable members, saved result order, shared context, live and result view integration, Entry opening/return, heading focus, history scrolling, access/error states, and Expo type checking. Shared Wall stories cover live, result, empty and unavailable states. Keep real mobile-browser acceptance distinct and pending until exercised.

No database or API change is required: this work reorganizes presentation and adapters around the existing authorized responses. Production remains untouched.

## Verification results

- Expo application typecheck passed.
- 24 targeted tests passed across Wall adapters, live/result views and workspace/home hooks. Coverage includes inaccessible cached results, unavailable result positions, saved ordering, shared context, focus and independent history scroll restoration.
- Shared live/result/empty/unavailable stories were added. Browser rendering was attempted against the Expo Storybook configuration, but its Vite dependency optimizer failed parsing React Native's `codegenNativeComponent.js` before story rendering. Desktop/phone-width visual acceptance is therefore pending; this is not a visual-parity claim.
