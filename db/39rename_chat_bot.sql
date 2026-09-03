-- Renames the scripted chat bot from "SSK Assistant" to "Gadidosti Assistant" — the INSERT in
-- db/38chat_bot_and_lock.sql used ON CONFLICT DO NOTHING, so any environment that already ran
-- it needs this explicit UPDATE; a fresh environment gets the new name directly from the
-- (also updated) seed INSERT and this is just a no-op there.
UPDATE users SET name = 'Gadidosti Assistant' WHERE id = '00000000-0000-0000-0000-000000000001';
