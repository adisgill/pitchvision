import{s as f,a as x,w as b}from"./models-C47ULxIq.js";function M(a){if(a.lh==null||a.la==null)return null;const t=f(x(a.lh,a.la,a.rho??0));return{h:t.home,d:t.draw,a:t.away}}function S(a){if(a.home_goals==null||a.mkt_h==null)return null;const t=a.home_goals>a.away_goals?a.mkt_h:a.home_goals<a.away_goals?a.mkt_a:a.mkt_d;return t>0?-Math.log(t):null}function $(a,t){return!a||!t||t.h==null?null:(Math.abs(a.h-t.h)+Math.abs(a.d-t.d)+Math.abs(a.a-t.a))/2}const L=(a,t)=>a>t?"W":a<t?"L":"D";function D(a,t,u,_,n){const s=new Map,d=m=>(s.has(m)||s.set(m,b(a,t,u,m)),s.get(m)),g=_.filter(m=>m.type==="goals"),p=_.filter(m=>m.type==="cards"&&(m.card==="red"||m.card==="second_yellow")),r=[];for(let m=0;m<=90;m++){let o=0;for(const e of g)e.minute<=m&&(o+=e.club_id===n?1:-1);let c=0,h=0;for(const e of p)e.minute<=m&&(e.club_id===n?c++:h++);const i=Math.max(-1,Math.min(1,h-c)),w=d(i),y=Math.max(-10,Math.min(10,o))+10,l=m===90?o>0?[1,0,0]:o===0?[0,1,0]:[0,0,1]:w[m][y];r.push({minute:m,gd:o,redD:i,p_home:l[0],p_draw:l[1],p_away:l[2]})}return r}const W=a=>`
  select m.match_id, m.competition_id, m.season, m.match_date, m.kickoff_utc, m.round, 'h' side,
         m.home_club club_id, m.home_team team, m.away_club opp_id, m.away_team opp,
         m.home_goals gf, m.away_goals ga, m.home_goals_ht gf_ht, m.away_goals_ht ga_ht,
         coalesce(m.home_xg, m.proxy_home_xg) xgf, coalesce(m.away_xg, m.proxy_away_xg) xga,
         m.home_manager manager, m.elo_home elo, m.mkt_h p_win, m.mkt_d p_draw, m.mkt_a p_loss
  from matches m where m.played and (${a})
  union all
  select m.match_id, m.competition_id, m.season, m.match_date, m.kickoff_utc, m.round, 'a',
         m.away_club, m.away_team, m.home_club, m.home_team,
         m.away_goals, m.home_goals, m.away_goals_ht, m.home_goals_ht,
         coalesce(m.away_xg, m.proxy_away_xg), coalesce(m.home_xg, m.proxy_home_xg),
         m.away_manager, m.elo_away, m.mkt_a, m.mkt_d, m.mkt_h
  from matches m where m.played and (${a})`,G=(a,t)=>a>t?3:a===t?1:0,N=a=>2e3+Number(String(a).slice(0,2)),P=a=>`${String(a%100).padStart(2,"0")}/${String((a+1)%100).padStart(2,"0")}`;export{W as a,N as b,D as c,M as d,P as e,G as p,L as r,S as s,$ as t};
