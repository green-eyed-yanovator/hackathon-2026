-- Local sample data (Adelaide CBD), loaded on `supabase start` / `supabase db reset`.
insert into public.posts (title, description, latitude, longitude) values
  ('Free lemons', 'Tree is overflowing, help yourself at the front gate.', -34.9212, 138.5989),
  ('Lost cat', 'Grey tabby, answers to Miso. Last seen near Rundle Mall.', -34.9229, 138.6060),
  ('Street clean-up Saturday', 'Meeting at the park at 9am, gloves provided.', -34.9340, 138.6010);

insert into public.replies (post_id, content)
select id, 'Grabbed a few, thank you!' from public.posts where title = 'Free lemons';
