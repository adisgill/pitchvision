import{a as r}from"./shared-CEOXBjrT.js";const d=t=>`
  with g as (${r(t)}),
  g2 as (select *, case when gf > ga then 3 when gf = ga then 1 else 0 end pts,
                3 * p_win + p_draw xpts
         from g where manager is not null and p_win is not null),
  g3 as (select *, case when manager = lag(manager) over (partition by club_id order by match_date, match_id)
                        then 0 else 1 end chg from g2),
  g4 as (select *, sum(chg) over (partition by club_id order by match_date, match_id rows unbounded preceding) stint from g3)
  select club_id, arg_max(team, match_date) team, manager, stint, arg_max(competition_id, match_date) league,
         min(match_date) start_date, max(match_date) end_date, count(*) n,
         avg(pts) ppg, avg(xpts) xppg, avg(pts - xpts) over_pm,
         coalesce(stddev_samp(pts - xpts), 1.2) / sqrt(count(*)) se,
         sum(case when pts = 3 then 1 else 0 end) w, sum(case when pts = 1 then 1 else 0 end) d,
         sum(case when pts = 0 then 1 else 0 end) l
  from g4 group by club_id, manager, stint`;function l(t,c=38){const a=t.filter(e=>e.n>=c);if(a.length<5)return{tau2:0,rows:t.map(e=>({...e,shrunk:0}))};const i=a.reduce((e,n)=>e+n.over_pm,0)/a.length,g=a.reduce((e,n)=>e+(n.over_pm-i)**2,0)/(a.length-1),o=a.reduce((e,n)=>e+n.se**2,0)/a.length,s=Math.max(0,g-o);return{tau2:s,rows:t.map(e=>({...e,shrunk:e.over_pm*(s/(s+e.se**2||1))}))}}const h=t=>`
  with g as (${r(t)}),
  g2 as (select *, case when gf > ga then 3 when gf = ga then 1 else 0 end - (3 * p_win + p_draw) res
         from g where manager is not null and p_win is not null),
  g3 as (select *, case when manager = lag(manager) over (partition by club_id order by match_date, match_id)
                        then 0 else 1 end chg from g2),
  g4 as (select *, sum(chg) over (partition by club_id order by match_date, match_id rows unbounded preceding) stint from g3),
  g5 as (select *, row_number() over (partition by club_id, stint order by match_date, match_id) rn,
                count(*) over (partition by club_id, stint) n from g4)
  select club_id, manager, stint, any_value(n) n, avg(res) filter (where rn <= n / 2) first_half,
         avg(res) filter (where rn > n / 2) second_half
  from g5 group by club_id, manager, stint`;export{l as a,h as b,d as s};
