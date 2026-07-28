-- rank_history.ranking_article_id is written by /api/rank/check (the RANKO
-- dashboard path) but never had a foreign key. Without it PostgREST cannot
-- embed rank_history from ranking_agent_articles, so the dashboard's
--   .select('*, rank_history(position, checked_at)')
-- failed with PGRST200 ("Could not find a relationship") and returned null.
-- Because loadArticles() discarded the error, this surfaced as an empty list
-- ("No articles tracked yet") despite rows existing.
--
-- The column was 100% NULL when this ran, so the constraint could not be
-- violated by existing data.

alter table public.rank_history
  add constraint rank_history_ranking_article_id_fkey
  foreign key (ranking_article_id)
  references public.ranking_agent_articles(id)
  on delete cascade;

create index if not exists rank_history_ranking_article_id_idx
  on public.rank_history(ranking_article_id);
