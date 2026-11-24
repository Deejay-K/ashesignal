-- Stage 55 (optional): let a group chat receive speculative alerts. Run once in the Supabase SQL editor, after
-- stage52-54. Safe to run more than once. Without it everything else works; groups just cannot turn these on.
alter table telegram_chats add column if not exists spec_preset text not null default 'off';
