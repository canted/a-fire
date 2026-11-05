import { useState } from 'react';
import { Text } from 'react-native';
import { SWRConfig, unstable_serialize } from 'swr';
import { EntryFlow } from './EntryRepliesScreen';
import { ViewportShell } from '../../components/ViewportShell';
import { normalizeFeedbackRequest } from '../../lib/feedback';
import type { EntryShowResponse, Reply } from "../../lib/api/entries";
import { layout } from '../../styles/layout';

export default { title: 'Expo/Rooms/Entry feedback', component: EntryFlow };
const text = (value: string) => ({ type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }] });
const replies: Reply[] = [
  { id: 401, status: 'published', created_at: '2026-10-28T12:15:00Z', user: { id: 2, username: 'Maya' }, content: text('The open sky gives the trees room to breathe.') },
  { id: 402, status: 'published', created_at: '2026-10-28T12:16:00Z', user: { id: 3, username: 'Jon' }, content: { type: 'doc', content: [{ type: 'image', attrs: { src: '/wall-study.jpg', width: 843, height: 1116, alt: 'A visual response to the river study' } }, ...text('This is the part I kept returning to.').content] } },
];
function Fixture({ unavailable = false, missingSource = false, readOnly = false, empty = false }: { unavailable?: boolean; missingSource?: boolean; readOnly?: boolean; empty?: boolean }) {
  const [cache] = useState(() => new Map());
  const [closed, setClosed] = useState(false);
  const data: EntryShowResponse = {
    entry: { id: 301, status: unavailable ? 'draft' : 'published', user: { id: 1, username: 'Alex' }, room_id: 101,
      format: 'mixed_media', format_data: { title: 'Leaving the sky unfinished' }, content: text('This is the version shared with the Room.'),
      feedback_request: normalizeFeedbackRequest(), viewer_access: { kind: readOnly ? 'visitor' : 'member', can_write: !readOnly, can_reply: !readOnly },
      can_keep_replies: !missingSource && !readOnly, ...(missingSource ? {} : { keep_project_id: 201, source_entry_id: 302 }),
    },
    replies: { data: empty ? [] : replies, pagination: { page: 1, per_page: 50, next_page: null } },
  };
  const fallback = { [unstable_serialize(['post', '301'])]: data, memberships: { user: { id: readOnly ? 4 : 1, username: readOnly ? 'Visitor' : 'Alex' }, memberships: [] } };
  return <SWRConfig value={{ provider: () => cache, fallback, isPaused: () => true, revalidateOnMount: false, revalidateOnFocus: false, revalidateOnReconnect: false }}>
    <ViewportShell>{closed ? <Text style={layout.text}>Returned to the collection in this preview.</Text> : <EntryFlow id="301" embedded onBack={() => setClosed(true)} onClose={() => setClosed(true)} />}</ViewportShell>
  </SWRConfig>;
}
export const EmbeddedTextAndImage = () => <Fixture />;
export const NoFeedbackYet = () => <Fixture empty />;
export const MissingPrivateSource = () => <Fixture missingSource />;
export const VisitorReadOnly = () => <Fixture readOnly />;
export const UnpublishedEntryUnavailable = () => <Fixture unavailable />;
