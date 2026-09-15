insert into books (id, title, author, status, bundle_version, bundle_url, bundle_sha) values
  ('habits', 'The Habit Loop', 'Minibook', 'published', 1, 'bundles/bundle-habits-en-v1.json', 'minisha');

insert into book_configs (book_id, state_variables, bands, bands_compiled) values
  ('habits',
   '[{"key":"consistency","label":"Consistency","type":"scale","range":[0,100],"display":"bar","default_value":40},{"key":"energy","label":"Energy","type":"scale","range":[0,10],"display":"number","default_value":5}]',
   '[{"key":"steady","predicate":{"all":[{"var":"consistency","op":">=","value":50}]}}]',
   '[{"key":"steady","fn":"s => (((s[\"consistency\"]) ?? 0) >= 50)"}]');

insert into personas (id, book_id, status, starting_state, gating_base) values
  ('maya', 'habits', 'published', '{"consistency":35}', '{}'),
  ('omar', 'habits', 'published', '{"consistency":45}', '{}');

insert into chapters (id, book_id, status, "order", title, content_ref) values
  ('mini_ch1', 'habits', 'published', 1, 'Mornings', 'ref:ch1'),
  ('mini_ch2', 'habits', 'published', 2, 'Evenings', 'ref:ch2');

insert into decisions (id, chapter_id, book_id, "order", prompt) values
  ('mdec1', 'mini_ch1', 'habits', 1, 'The alarm rings at 6am.'),
  ('mdec2', 'mini_ch2', 'habits', 1, 'Evening comes.');

insert into options (id, decision_id, chapter_id, book_id, label, intent, next, requires, lock_reason, persona_effects) values
  ('mdec1o1', 'mdec1', 'mini_ch1', 'habits', 'Get up and walk', 'Keep the promise.', 'chapter_end', null, 'Always available.',
   '[{"persona_id":"maya","delta":{"consistency":6},"outcome_text":"Consistency rises to {consistency}."},{"persona_id":"omar","delta":{"consistency":4},"outcome_text":"Consistency reaches {consistency}."}]'),
  ('mdec1o2', 'mdec1', 'mini_ch1', 'habits', 'Snooze and skip', 'Rest a little longer.', 'chapter_end', null, 'Always available.',
   '[{"persona_id":"maya","delta":{"consistency":-5},"outcome_text":"Consistency falls to {consistency}."},{"persona_id":"omar","delta":{"consistency":-3},"outcome_text":"Consistency slips to {consistency}."}]'),
  ('mdec2o1', 'mdec2', 'mini_ch2', 'habits', 'Step out for air', 'Clear the head.', 'chapter_end', null, 'Always available.',
   '[{"persona_id":"maya","delta":{"consistency":5},"outcome_text":"Consistency climbs to {consistency}."},{"persona_id":"omar","delta":{"consistency":3},"outcome_text":"Consistency rises to {consistency}."}]'),
  ('mdec2o2', 'mdec2', 'mini_ch2', 'habits', 'Sink into the couch', 'Rest the body.', 'chapter_end', null, 'Always available.',
   '[{"persona_id":"maya","delta":{"consistency":-4},"outcome_text":"Consistency has slipped to {consistency}."},{"persona_id":"omar","delta":{"consistency":-2},"outcome_text":"Consistency down to {consistency}."}]');
