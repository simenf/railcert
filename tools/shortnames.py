#!/usr/bin/env python3
"""Short display names for library documents and cited items.
Used by build_map.py:  from shortnames import ShortNames"""
import csv, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
TYPE = {"Regulation": "R", "Directive": "L", "Decision": "D"}

def celex_from(kind, a, b):
    a, b = int(a), int(b)
    if 1957 <= a <= 2030 and not (1957 <= b <= 2030 and a > 1999 and b < a): y, n = a, b
    elif 1957 <= b <= 2030: y, n = b, a
    else: return None
    return f"3{y}{kind}{n:04d}"

def num_of(celex):
    y, k, n = celex[1:5], celex[5], int(celex[6:10])
    return f"{n}/{y}" if (k == "R" and int(y) < 2015) else f"{y}/{n}"

FILE_RULES = [  # (regex on filename, short name or callable)
    (r"^ERA1209-222_PA_VA_Guidelines", "PA VA Guidelines"),
    (r"^ERA1209-222_PA_VA_v2\.1_Sec4", "PA VA Guidelines – flowcharts"),
    (r"^ERA1209-(\d{3})", lambda m: f"Clarification note ERA1209/{m.group(1)}"),
    (r"^ERA1208-(\d{3})", lambda m: f"Clarification note ERA1208/{m.group(1)}"),
    (r"^CSM_RA_Application_Guide", "CSM RA Guide"),
    (r"^CSM_RA_Collection_of_examples", "CSM RA – collection of examples"),
    (r"^Explanatory_note_CSM_AsBo", "AsBo explanatory note"),
    (r"^AsBo_RFU(\d+)", lambda m: f"AsBo RFU {m.group(1)}"),
    (r"^RFU-([A-Z]+-\d+)", lambda m: f"NB-Rail RFU-{m.group(1)}"),
    (r"^TSI_General_Guide", "TSI General Guide"),
    (r"^CCS_TSI_2023_Application_Guide", "CCS TSI Guide"),
    (r"^(ENE|INF|NOI|OPE|PRM|SRT|WAG)_TSI_Guide", lambda m: f"{m.group(1)} TSI Guide"),
    (r"^LOC-PAS_TSI_Guide", "LOC&PAS TSI Guide"),
    (r"^SMS_Requirements_Guide.*_NO", "SMS Requirements Guide (norsk)"),
    (r"^SMS_Requirements_Guide", "SMS Requirements Guide"),
    (r"^SSC_Application_Guide", "SSC Application Guide"),
    (r"^OSS_User_Guide", "OSS Guide for applicants"),
    (r"^ECM_certification_guidance", "ECM Certification Guidance"),
    (r"^Guide_CSM_monitoring", "CSM Monitoring Guide"),
    (r"^Guide_on_supervision", "CSM Supervision Guide"),
    (r"^RINF_Application_Guide", "RINF Guide"),
    (r"^ERATV_Application_Guide", "ERATV Guide"),
    (r"^EVR_Guidelines", "EVR Guide"),
    (r"^EIRENE_SRS", "EIRENE SRS (GSM-R)"),
    (r"^ERA_ERTMS_033281", "ERA/ERTMS/033281 – CCS trackside interfaces"),
    (r"^ERA_ERTMS_015560", "ETCS DMI (ERA_ERTMS_015560)"),
    (r"^STM_FRS_BVS544\.65001_v(\d\.\d)_(innledning|kap\d)", lambda m: f"ATC-2 STM FRS v{m.group(1)} – " + ("innledning" if m.group(2) == "innledning" else "kap. " + m.group(2)[3:])),
    (r"^STM_GRS_100200-E004_v(\d\.\d)", lambda m: f"ATC-2 STM GRS v{m.group(1)}"),
    (r"^STM_RAMS", "ATC-2 STM RAMS requirements"),
    (r"^BaneNOR_Network_Statement_2027_(EN|NO)", lambda m: f"Network Statement 2027 ({m.group(1)})"),
    (r"^BaneNOR_TJN", "TJN 2026 – endringsnotat"),
    (r"^CRA_Guidance_C2026-5252_Annex", "CRA Guidance – annex"),
    (r"^CRA_Guidance_C2026-5252_Comm", "CRA Guidance"),
    (r"^CRA_FAQ", "CRA FAQ"),
]

class ShortNames:
    def __init__(self, cat_rows):
        self.eu, self.no = {}, {}
        for r in csv.DictReader(open(os.path.join(HERE, "short_names.tsv"), encoding="utf-8"), delimiter="\t"):
            k, s = (r["key"] or "").strip(), (r["short"] or "").strip()
            if not k or k.startswith("#") or not s: continue
            m = re.match(r"^([RLD]) (\d{4}) (\d+)$", k)
            if m: self.eu[f"3{m.group(2)}{m.group(1)}{int(m.group(3)):04d}"] = s
            elif re.match(r"^(FOR|LOV)-", k): self.no[k] = s
        self.doc = {}
        for r in cat_rows:
            p = f"{r['folder']}/{r['filename']}"
            s, n = self._doc(r)
            if s: self.doc[p] = (s, n)

    def eu_short(self, celex, title=""):
        if celex in self.eu: return self.eu[celex]
        # amending / correcting acts: name after the act they change
        if title:
            m = re.search(r"\b(amending|correcting|supplementing|replacing [^ ]+ to)\b(.*)", title, re.I)
            if m:
                verb = m.group(1).lower()
                for k, a, b in re.findall(r"(Regulation|Directive|Decision)[^0-9]{0,30}?(\d{1,4})/(\d{1,4})", m.group(2)):
                    c = celex_from(TYPE[k], a, b)
                    if c and c in self.eu:
                        what = {"amending": "amendment", "correcting": "correction", "supplementing": "supplement"}.get(verb, "annex")
                        return f"{self.eu[c]} – {what} {num_of(celex)}"
        return ""

    SETLAB = {"Set1_ETCS_B2": "B2", "Set2_ETCS_B3_MR1": "B3 MR1", "Set3_ETCS_B3_R2": "B3 R2",
              "Set4_ETCS_B4_R1_current": "B4 R1", "Informative_specs": "informative"}

    def _doc(self, r):
        fn, title, url = r["filename"], r.get("title", ""), r.get("url", "")
        setdir = r["folder"].split("/")[-1]
        if setdir in self.SETLAB:
            lab = self.SETLAB[setdir]
            m = re.match(r"^\d{3}[a-z]?_(SUBSET-\d{3}(?:-\d+)*|ERA_ERTMS_\d+)(?:_v(\d)(\d)(\d))?", fn)
            if m:
                v = f" v{m.group(2)}.{m.group(3)}.{m.group(4)}" if m.group(2) else ""
                return f"{m.group(1)}{v} ({lab})", ""
            if fn.startswith("000_Readme"): return f"Readme – set {lab}", ""
            t = re.sub(r"\s*\[Set\w*\]$|\s*\[Informative\]$", "", title)
            return (t[:60] + f" ({lab})") if t else "", ""
        for pat, val in FILE_RULES:
            m = re.match(pat, fn)
            if m: return (val(m) if callable(val) else val), ""
        m = re.search(r"CELEX[:%3A]+[03](\d{4}[A-Z]\d{4})", url)
        if m:
            c = "3" + m.group(1); s = self.eu_short(c, title)
            if s:
                if "consolidated" in fn.lower(): s += " (consolidated)"
                elif "corrigendum" in fn.lower(): s += " – corrigendum"
                return s, num_of(c)
            return "", num_of(c)
        m = re.search(r"((?:FOR|LOV)-\d{4}-\d{2}-\d{2}-\d+)", fn + " " + r.get("reference", "") + " " + url)
        if not m:
            m2 = re.search(r"/(forskrift|lov)/(\d{4}-\d{2}-\d{2}-\d+)", url)
            key = (("FOR-" if m2.group(1) == "forskrift" else "LOV-") + m2.group(2)) if m2 else None
        else:
            key = m.group(1)
        if key and key in self.no: return self.no[key], key
        m = re.match(r"^SUBSET-(\d{3}(?:-\d+)?)", fn)
        if m: return f"SUBSET-{m.group(1)}", ""
        return "", ""

    def ext(self, nid, label):
        if nid.startswith("EU:"): return self.eu.get(nid[3:], "")
        if nid.startswith("NO:"): return self.no.get(nid[3:], "")
        return ""
