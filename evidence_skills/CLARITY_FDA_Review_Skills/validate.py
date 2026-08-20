#!/usr/bin/env python3
"""validate.py — CI guard for CLARITY Final Skillset (v4.0.0): 9 FDA skills + orchestrator + commercial."""
import os,sys,json,re
DOM={"name":r"name:\s*fda-review-","question":r"\*\*Core question:\*\*","phase flow":r"## Phase flow",
 "Paperclip":r"Paperclip MCP","PubMed":r"PubMed","clinicaltrials":r"clinicaltrials\.gov",
 "phase elements":r"## Phase-gated elements","P4 heading":r"### Phase 4","output contract":r"## Output contract",
 "Evidence Directness":r"Evidence Directness","Inference Strength":r"Inference Strength",
 "no-merge":r"[Nn]ever merge the two signals","clickable":r"clickable link","refs bottom":r"References.*bottom",
 "evalbench":r"## Evalbench analysis","95% CI":r"95% CI","guardrails":r"## Guardrails",
 "no-hallucination":r"[Nn]o hallucination","not found":r"Not found in public sources","placeholder":r"Do not generate"}
ORCH={"name":r"name:\s*fda-review-orchestrator","routing":r"## Routing","required":r"Required inputs",
 "phase flow":r"## Phase flow","loop":r"## Loop","commercial route":r"clarity-commercial-viability",
 "Evidence Directness":r"Evidence Directness","Inference Strength":r"Inference Strength",
 "evalbench":r"## Evalbench analysis","guardrails":r"## Guardrails"}
COMM={"name":r"name:\s*clarity-commercial-viability","runs after":r"AFTER the 9 FDA",
 "mandated output":r"MANDATED OUTPUT","table1":r"Table 1","table2":r"Table 2","table3":r"Table 3","table4":r"Table 4",
 "landscape merge":r"Landscape DRIVES the model|landscape DRIVES","rNPV":r"rNPV","evalbench":r"## Evalbench analysis",
 "Evidence Directness":r"Evidence Directness","Inference Strength":r"Inference Strength",
 "XBI":r"XBI","patents":r"Google Patents","guardrails":r"## Guardrails","clickable":r"clickable link"}
PH=["### Pre-clinical","### Phase 1","### Phase 2","### Phase 3","### Phase 4"]
G,R,Y,X="\033[92m","\033[91m","\033[93m","\033[0m"
def ck(t,r):return [l for l,p in r.items() if not re.search(p,t,re.I)]
def sect(t,h):
 i=t.find(h)
 if i<0:return ""
 r=t[i+len(h):];nl=r.find("\n");r=r[nl+1:] if nl>=0 else r
 m=re.search(r"\n#{2,3}\s",r);return r[:m.start()] if m else r
def main():
 root=sys.argv[1] if len(sys.argv)>1 else os.path.dirname(os.path.abspath(__file__))
 man=json.load(open(os.path.join(root,"manifest.json")))
 err,n=[],0
 if man.get("phase_model")!="cumulative_flow":err.append("manifest.phase_model != cumulative_flow")
 if man.get("confidence_model",{}).get("type")!="two_signal":err.append("confidence_model != two_signal")
 if "evalbench" not in man:err.append("manifest missing evalbench")
 if "commercial_skill" not in man:err.append("manifest missing commercial_skill block")
 for s in man.get("skills",[]):
  sid=s["id"];path=os.path.join(root,s["path"]);role=s["role"];n+=1
  if not os.path.isfile(path):err.append(f"[{sid}] missing file");continue
  t=open(path,encoding="utf-8").read()
  rules=ORCH if role=="router" else (COMM if role=="commercial" else DOM)
  for m in ck(t,rules):err.append(f"[{sid}] missing: {m}")
  if role=="domain":
   for h in PH:
    if h not in t:err.append(f"[{sid}] missing phase heading {h}")
   for ph,h in zip(["Pre-clinical","Phase 1","Phase 2","Phase 3","Phase 4"],PH):
    if ph in s["active_phases"] and sect(t,h).strip().lower().startswith("do not generate"):
     err.append(f"[{sid}] {ph} active but 'Do not generate'")
 print("="*58);print("CLARITY Final Skillset — validation (v4.0.0)")
 print(f"Skills checked: {n}");print("="*58)
 for e in err:print(f"{R}FAIL{X} {e}")
 if not err:print(f"{G}PASS{X} all {n} skills valid");sys.exit(0)
 print(f"\n{R}{len(err)} error(s){X}");sys.exit(1)
if __name__=="__main__":main()
