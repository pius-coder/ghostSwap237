-- Clean up all existing plans first to prevent duplicates
DELETE FROM public.plans;

-- Seed the plans table with Format-Boy Cam credit packs
INSERT INTO public.plans (name, price, credits, duration_minutes, usd_price)
VALUES
  ('Starter', 14000, 500, 4, 10.00),
  ('Basic', 28000, 1000, 8, 20.00),
  ('Pro', 56000, 2000, 16, 40.00),
  ('Enterprise', 140000, 5000, 40, 100.00);
