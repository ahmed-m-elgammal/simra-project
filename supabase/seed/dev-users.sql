insert into free_claims (app_user_id, book_id) values
  ('u_free', 'a'), ('u_free', 'b'), ('u_free', 'c');

insert into entitlements (app_user_id, book_id) values
  ('u_ent', 'habits');

insert into progress (app_user_id, book_id, furthest_chapter) values
  ('u_caught', 'habits', 2),
  ('u_mid', 'habits', 1);
