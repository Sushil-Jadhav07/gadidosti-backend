// Scripted quick-reply bot — the first thing a client sees when opening a trip's chat, before a
// human (driver/broker) is pulled in. Deliberately a fixed menu tree, not an LLM: predictable,
// zero API cost/latency, and nothing it says needs guardrails. See chatThread.model.js
// (findOrCreateByBooking seeds the greeting) and chatService.js (handleBotAction drives this).
const BOT_SENDER_ID = '00000000-0000-0000-0000-000000000001';

const GREETING = "Hi! I'm the SSK Assistant. How can I help with this trip?";

const MENU_ROOT = [
  { id: 'track', label: 'Where is my truck?' },
  { id: 'payment', label: 'Payment / billing issue' },
  { id: 'talk_human', label: 'Talk to my driver/broker' },
  { id: 'other', label: 'Something else' },
];

// action id -> { reply, quickReplies?, escalate? }. `escalate: true` flips the thread to
// 'human' stage and pulls in the assigned driver/broker (see chatService.handleBotAction).
const RESPONSES = {
  track: {
    reply: "You can see your truck's live position right on this trip's tracking map, updated every few seconds. Want to talk to your driver directly instead?",
    quickReplies: [
      { id: 'talk_human', label: 'Talk to my driver/broker' },
      { id: 'done', label: "No, that's all" },
    ],
  },
  payment: {
    reply: 'For payment or billing questions, our support team can help directly — connecting you now.',
    escalate: true,
  },
  talk_human: {
    reply: "Connecting you with your driver/broker now — they'll be with you shortly.",
    escalate: true,
  },
  other: {
    reply: "Let's get you connected with support.",
    escalate: true,
  },
  done: {
    reply: 'Glad I could help! Message me again anytime.',
    quickReplies: MENU_ROOT,
  },
};

// Flat id -> label lookup across every option reachable anywhere in the tree (the root menu,
// plus every response's own follow-up quickReplies) — used to render the client's tapped
// option back as their own chat bubble (see chatService.handleBotAction). Built once here
// rather than re-scanned ad hoc, since 'done' and 'talk_human' are reachable from more than one
// place in the tree.
const OPTION_LABELS = Object.fromEntries(
  [...MENU_ROOT, ...Object.values(RESPONSES).flatMap((r) => r.quickReplies || [])]
    .map((o) => [o.id, o.label])
);

module.exports = { BOT_SENDER_ID, GREETING, MENU_ROOT, RESPONSES, OPTION_LABELS };
