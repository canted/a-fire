import type { Page } from "@playwright/test";

export async function prepareLayoutRoutes(page: Page) {
const stamp = new Date().toISOString();
const doc = (text: string) => ({type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]});
const user={id:1,username:'Rowan',avatar_url:null};
const circle={id:77,name:'Small Hours',owner_id:1,canManage:true,porosity:'open',memberBoard:{id:91,name:'Small Hours'},access:{kind:'member',can_manage:true,can_write:true,can_write_wall:true,can_view_notes:true}};
const entry={id:201,kind:'material',author:user,created_at:stamp,updated_at:stamp,content:doc('A small contribution.'),format:'mixed_media',format_data:{},can_edit:true,can_share:true,draft:false,status:'published',submissions:[]};
const project={id:42,name:'Room Score',description:'Studies of voice and quiet spaces.',owner:user,participants:[],pending_participants:[],rooms:[],updated_at:stamp,viewer_participation:'owner',can_edit:true,can_add_material:true,entries:[entry],};
const message={id:101,kind:'message',body:'Geometry reference message',content:doc('Geometry reference message'),created_at:stamp,fire_at:stamp,expires_at:stamp,lifecycle:'active',mine:false,client_nonce:null,author:{id:2,display_username:'Mira',avatar_url:null},masked_author:null,reply_count:0,reply_participants:[],pinned_at:null,saved_at:null};
const wall={id:'19',roomId:'77',roundId:'91',title:'The rooms we listen in',description:'Bring a small sound from a room you know.',publishedAt:stamp,templateKey:'feedback',entries:[{id:'74',entryId:'74',authorName:'Rowan',available:true,content:doc('A quiet sketch.'),format:'mixed_media',formatData:{},responseCount:0,responseParticipants:[]}]};
const fixtures: Record<string, unknown> = {
'/api/v1/mentions':{targets:[]},'/api/client-build':{buildId:null},'/api/v1/unseen/count':{total:0,entries:0,replies:0},'/api/v1/notices':{items:[],nextCursor:null},
'/api/v1/memberships':{user,memberships:[{id:4,room:{id:77,name:'Small Hours'},display_username:'Rowan',disabled:false,notify:true}]},
'/api/v2/rooms/77':circle,'/api/v2/rooms/77/menu':{rooms:[circle],currentRoom:{...circle,pages:[]}},
'/api/v2/rooms/77/adjacent-rooms':{adjacent_rooms:[{...circle,id:78,name:'Listening corner'}]},
'/api/v2/rooms/77/notification-deliveries':{items:[]},
'/api/v2/rooms/77/members':{members:[]},
'/api/v1/introductions/rooms/77/pairs':{pairs:[]},
'/api/v2/rooms/77/join-requests':{join_requests:[]},'/api/v2/rooms/77/knocks':{knocks:[]},
'/api/v1/invites':{invites:[],permissions:{new_room_invite_allowed:false}},'/api/v1/invites/suggestions':{suggestions:[]},
'/api/v2/notes/tree':{room_id:77,pages:[]},
'/api/v1/boards/91':{id:'91',name:'Small Hours',roomId:'77',canManage:true,currentUserSquareId:'1',squares:[{id:'1',username:'Rowan',latestEntry:{id:'201',content:doc('A small contribution.'),format:'mixed_media'}},{id:'2',username:'Mira',latestEntry:{id:'202',content:doc('A second sketch.'),format:'mixed_media'}}]},
'/api/v2/rooms':{rooms:[circle]},
'/api/v1/rooms/77/home':{roomId:'77',members:[{membershipId:'1',username:'Rowan',latestEntry:{id:'74',createdAt:stamp,content:doc('A quiet sketch.'),format:'mixed_media'}},{membershipId:'2',username:'Mira',latestEntry:{id:'75',createdAt:stamp,content:doc('A second sketch.'),format:'mixed_media'}}],viewer_access:{kind:'member',can_write:true,can_reply:true,entry_history:'all'}},
'/api/v1/rooms/77/rounds/overview':{currentRounds:[],rounds:[],recentRounds:[]},
'/api/v1/rooms/77/rounds':{currentRounds:[],rounds:[],recentRounds:[]},
'/api/v1/projects/42/entries':{entries:[entry],nextCursor:null},
'/api/v1/projects/42/entries/201':{entry},
'/api/v1/projects/42/entries/201/copies':{submissions:[],nextCursor:null},
'/api/v1/projects':{projects:[project]},'/api/v1/projects/42':project,
'/api/v1/projects/home':{today:stamp.slice(0,10),rounds:[],roomDashboard:{newResponses:0,activitiesJoined:1,feedbackGiven:1,entriesShared:1},recentRooms:[{id:'77',name:'Small Hours',activityText:'A small contribution.',unseenCount:0}],totalRoomUnseenCount:0,recentProjects:[{project,entry}],recentEntries:[{project,entry}],contributions:[]},
'/api/v2/rooms/77/chat/messages':{messages:[message],viewer_access:{kind:'member',can_send:true,can_paginate:true,history_limit:null},next_cursor:null,present_user_ids:[],viewer_user_id:1,server_time:stamp},
'/api/v1/rooms/77/walls':{walls:[{...wall,presented:true,entryCount:1}]},'/api/v1/walls/19':wall,
'/api/v1/boards/91/rounds':{currentRounds:[],activeRound:null,nextRound:null,recentRounds:[],rounds:[]},
'/api/v1/entries/74':{entry:{id:74,status:'published',user,room_id:77,room:{id:77,name:'Small Hours'},project_id:null,content:doc('A quiet sketch.'),format:'mixed_media',format_data:{},feedback_request:{reply_mode:'simple',requested_feedback_types:[],idea_guidance:null},viewer_access:{kind:'member',can_write:true,can_reply:true}},replies:{data:[],pagination:{page:1,per_page:20,next_page:null}}}
};
const unknown = new Set<string>();
await page.route('**/api/**',async route=>{const p=new URL(route.request().url()).pathname;if(!p.startsWith('/api/'))return route.continue();let value=fixtures[p];if(value===undefined&&/seen|presentation|\/auth\/media/.test(p))value={ok:true};if(value===undefined){unknown.add(p);value={};}await route.fulfill({json:value});});
await page.route('**/socket.io/**',route=>route.abort());
await page.addInitScript(()=>{localStorage.setItem('afire.preview.session',JSON.stringify({accessToken:'eyJhbGciOiJub25lIn0.'+btoa(JSON.stringify({sub:1,exp:9999999999}))+'.test',refreshToken:'fixture-refresh'}));localStorage.setItem('afire:pwa-install-dismissed','true');});
  return unknown;
}
