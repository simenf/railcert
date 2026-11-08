"""Hand-set rules for the Navigator tab (used by navigator.py).

Edit this file to change the hierarchy, then rebuild with
    python3 tools/build_nav.py            (fast: re-renders the map from its embedded data)
or the full  bash tools/finalize.sh.

Keys
  * A family key is a library document's short name with " (consolidated)", " – amendment …",
    " – correction …", " (old)" etc. stripped, e.g. "CCS TSI" or "Samtrafikkforskriften".
    Amending, correcting, consolidated and superseded acts fold into their family.
  * Keys starting with "@" are groups (virtual folders) defined in SKELETON.

Tiers
  0  basic acts               (directives, framework regulations, Norwegian acts)
  1  implementing / delegated (TSIs, CSMs, 2018/545, 2010/713, registers, Norwegian forskrifter)
  2  mandatory specifications (CCS TSI Annex A sets, ATC-2 STM specs)
  3  guidance                 (ERA guides, clarification notes, RFUs, SJT veiledninger, Bane NOR)
  4  referenced material      (other EU acts, ETSI, further subsets, ERA technical documents)
"""

# --------------------------------------------------------------------------------------------
# SKELETON: (key, parent, tier, label for groups / None).  Order = display order among siblings.
# --------------------------------------------------------------------------------------------
SKELETON = [
    ("@eu", None, -1, "EU law"),
    ("Interoperability Directive", "@eu", 0, None),
    ("@tsi", "Interoperability Directive", 1, "TSIs – technical rules per subsystem"),
    ("CCS TSI", "@tsi", 1, None),
    ("LOC&PAS TSI", "@tsi", 1, None),
    ("WAG TSI", "@tsi", 1, None),
    ("INF TSI", "@tsi", 1, None),
    ("ENE TSI", "@tsi", 1, None),
    ("OPE TSI", "@tsi", 1, None),
    ("NOI TSI", "@tsi", 1, None),
    ("PRM TSI", "@tsi", 1, None),
    ("SRT TSI", "@tsi", 1, None),
    ("Telematics TSI (TEL)", "@tsi", 1, None),
    ("@tsi-pkg", "@tsi", 1, "Cross-TSI amending packages"),
    ("TSI package 2023", "@tsi-pkg", 1, None),
    ("TSI package 2019 (4RP alignment)", "@tsi-pkg", 1, None),
    ("TSI amendment 2020 (area of use)", "@tsi-pkg", 1, None),
    ("ENE & LOC&PAS amendment (energy measurement)", "@tsi-pkg", 1, None),
    ("@va", "Interoperability Directive", 1, "Vehicle authorisation & placing in service"),
    ("Vehicle Authorisation Regulation", "@va", 1, None),
    ("ERA Fees Regulation", "@va", 1, None),
    ("@ca", "Interoperability Directive", 1, "Conformity assessment (NoBo / DeBo)"),
    ("Conformity Modules Decision", "@ca", 1, None),
    ("EC Declaration Templates Regulation", "@ca", 1, None),
    ("@natrules", "Interoperability Directive", 1, "National rules (Art. 14) – SRD / RDD"),
    ("@reg", "Interoperability Directive", 1, "Registers"),
    ("Vehicle Registers (EVR) Decision", "@reg", 1, None),
    ("ERATV Decision", "@reg", 1, None),
    ("RINF Regulation", "@reg", 1, None),
    ("4RP transposition extension", "Interoperability Directive", 1, None),

    ("Railway Safety Directive", "@eu", 0, None),
    ("CSM RA", "Railway Safety Directive", 1, None),
    ("Single Safety Certificate Regulation", "Railway Safety Directive", 1, None),
    ("CSM SMS requirements", "Railway Safety Directive", 1, None),
    ("CSM Supervision", "Railway Safety Directive", 1, None),
    ("CSM Monitoring", "Railway Safety Directive", 1, None),
    ("ECM Regulation", "Railway Safety Directive", 1, None),
    ("Common Safety Targets (2nd set)", "Railway Safety Directive", 1, None),
    ("CSM CST assessment", "Railway Safety Directive", 1, None),
    ("Accident Investigation Reports Regulation", "Railway Safety Directive", 1, None),
    ("Channel Tunnel Regulation", "Railway Safety Directive", 1, None),

    ("ERA Regulation", "@eu", 0, None),
    ("SERA Directive", "@eu", 0, None),
    ("SERA Annex VII", "SERA Directive", 1, None),
    ("4th Railway Package – market pillar", "SERA Directive", 1, None),
    ("Rail Capacity Regulation", "SERA Directive", 1, None),
    ("Train Drivers Directive", "@eu", 0, None),
    ("Cyber Resilience Act (CRA)", "@eu", 0, None),
    ("CRA – important & critical products", "Cyber Resilience Act (CRA)", 1, None),
    ("CRA – L-category exclusion", "Cyber Resilience Act (CRA)", 1, None),
    ("CRA – delayed notifications", "Cyber Resilience Act (CRA)", 1, None),
    ("AI Act", "@eu", 0, None),

    # ERTMS specification sets hang under the CCS TSI (Annex A)
    ("@set4", "CCS TSI", 2, "Annex A specs – Set 4 (ETCS B4 R1, current)"),
    ("@specs-old", "CCS TSI", 2, "Earlier specification sets"),
    ("@set3", "@specs-old", 2, "Set 3 (ETCS B3 R2 – system version 3.6.0, as deployed in Norway)"),
    ("@set2", "@specs-old", 2, "Set 2 (ETCS B3 MR1)"),
    ("@set1", "@specs-old", 2, "Set 1 (ETCS B2)"),
    ("@set-inf", "CCS TSI", 2, "Informative specifications (FMEAs, hazard log, safety analyses)"),
    ("@ertms-misc", "CCS TSI", 2, "ESC/RSC, braking curves and other ERTMS documents"),
    ("@ertms-ref", "CCS TSI", 4, "Referenced ETSI / GSM-R / FRMCS specifications and further subsets"),

    # ---------------------------------------------------------------- Norway
    ("@no", None, -1, "Norsk regelverk"),
    ("Jernbaneloven", "@no", 0, None),
    ("Samtrafikkforskriften", "Jernbaneloven", 1, None),
    ("TSI CCS-forskriften", "Samtrafikkforskriften", 1, None),
    ("@atc2", "TSI CCS-forskriften", 2, "ATC-2 STM specifications (Norwegian class B)"),
    ("@atc2-cur", "@atc2", 2, "v6.1 (2017, current)"),
    ("@atc2-old", "@atc2", 2, "Earlier versions (v6.0, v5.2, v5.1)"),
    ("TSI OPE-forskriften", "Samtrafikkforskriften", 1, None),
    ("TSI LOC&PAS-forskriften", "Samtrafikkforskriften", 1, None),
    ("TSI-unntaksforskriften", "Samtrafikkforskriften", 1, None),
    ("Meldermyndighetsforskriften (NoBo/DeBo)", "Samtrafikkforskriften", 1, None),
    ("EF-erklæringsforskriften", "Samtrafikkforskriften", 1, None),
    ("Kjøretøyregisterforskriften (EVR)", "Samtrafikkforskriften", 1, None),
    ("Jernbanekjøretøyforskriften", "Samtrafikkforskriften", 1, None),
    ("Arbeidsmaskinforskriften", "Samtrafikkforskriften", 1, None),
    ("@nntr", "Samtrafikkforskriften", 1, "Nasjonale tekniske regler (SRD / RDD)"),
    ("Sikkerhetsforskriften", "Jernbaneloven", 1, None),
    ("CSM RA-forskriften", "Sikkerhetsforskriften", 1, None),
    ("CSM SMS-forskriften", "Sikkerhetsforskriften", 1, None),
    ("ECM-forskriften", "Sikkerhetsforskriften", 1, None),
    ("Helsekravforskriften", "Sikkerhetsforskriften", 1, None),
    ("Sikringsforskriften", "Sikkerhetsforskriften", 1, None),
    ("Jernbaneforskriften", "Jernbaneloven", 1, None),
    ("Førerforskriften", "Jernbaneloven", 1, None),
    ("Forskrift om sikkerhet og tekniske forhold", "Jernbaneloven", 1, None),
    ("Gebyrforskriften (SJT)", "Jernbaneloven", 1, None),
    ("Jernbaneinfrastrukturforskriften", "Jernbaneloven", 1, None),
    ("Togframføringsforskriften (repealed)", "Jernbaneloven", 1, None),
    ("@sporvei", "Jernbaneloven", 1, "Sporvei, sidespor og museumsbaner"),
    ("Kravforskriften (sporvei)", "@sporvei", 1, None),
    ("Sidesporforskriften", "@sporvei", 1, None),
    ("Museumsbaneforskriften", "@sporvei", 1, None),
    ("Tillatelsesforskriften", "@sporvei", 1, None),
    ("Jernbaneundersøkelsesloven", "@no", 0, None),
    ("Jernbaneundersøkelsesforskriften", "Jernbaneundersøkelsesloven", 1, None),
    ("Varslings- og rapporteringsforskriften", "Jernbaneundersøkelsesloven", 1, None),
    ("Lov om tekniske kontrollorgan", "@no", 0, None),
    ("@banenor", "@no", 3, "Bane NOR (infrastructure manager)"),
]

# Norwegian regulation -> EU family it implements (shown both ways).
TRANSPOSES = {
    "Samtrafikkforskriften": "Interoperability Directive",
    "Sikkerhetsforskriften": "Railway Safety Directive",
    "Jernbaneforskriften": "SERA Directive",
    "Førerforskriften": "Train Drivers Directive",
    "TSI CCS-forskriften": "CCS TSI",
    "TSI OPE-forskriften": "OPE TSI",
    "TSI LOC&PAS-forskriften": "LOC&PAS TSI",
    "CSM RA-forskriften": "CSM RA",
    "CSM SMS-forskriften": "CSM SMS requirements",
    "ECM-forskriften": "ECM Regulation",
    "EF-erklæringsforskriften": "EC Declaration Templates Regulation",
    "Kjøretøyregisterforskriften (EVR)": "Vehicle Registers (EVR) Decision",
    "Meldermyndighetsforskriften (NoBo/DeBo)": "Conformity Modules Decision",
}

# Superseded / renamed acts whose stripped name is not the current family's name.
FAMILY_ALIAS = {
    "TAP TSI": "Telematics TSI (TEL)", "TAF TSI": "Telematics TSI (TEL)",
    "RST TSI": "LOC&PAS TSI",
    "NVR Decision": "Vehicle Registers (EVR) Decision",
    "RINF Decision": "RINF Regulation",
    "CSM safety certificates": "CSM SMS requirements",
    "CSM safety authorisations": "CSM SMS requirements",
    "Common Safety Indicators Directive": "Railway Safety Directive",
    "Conventional Rail Interoperability Directive": "Interoperability Directive",
    "High-Speed Interoperability Directive": "Interoperability Directive",
    "Interoperability amending Directive": "Interoperability Directive",
    "Infrastructure Capacity Directive": "SERA Directive",
    "Railway Development Directive": "SERA Directive",
    "Declaration of Conformity to Type Regulation": "EC Declaration Templates Regulation",
    "Batteries Directive": "Batteries Regulation",
    "ERA Fees – revision 2024": "ERA Fees Regulation",
}

# Folder -> default parent for documents in it (applied before citation-based placement).
FOLDER_PARENT = {
    "07_ERTMS_Specifications/Set4_ETCS_B4_R1_current": "@set4",
    "07_ERTMS_Specifications/Set3_ETCS_B3_R2": "@set3",
    "07_ERTMS_Specifications/Set2_ETCS_B3_MR1": "@set2",
    "07_ERTMS_Specifications/Set1_ETCS_B2": "@set1",
    "07_ERTMS_Specifications/Informative_specs": "@set-inf",
    "07_ERTMS_Specifications": "@ertms-misc",
    "08_Norway/ATC2_STM_Specifications/v6.1_2017": "@atc2-cur",
    "08_Norway/ATC2_STM_Specifications/v6.0_2014": "@atc2-old",
    "08_Norway/ATC2_STM_Specifications/v5.2_2014": "@atc2-old",
    "08_Norway/ATC2_STM_Specifications/v5.1_2009": "@atc2-old",
    "08_Norway/ATC2_STM_Specifications": "@atc2",
    "08_Norway/Bane_NOR": "@banenor",
    "09_Referenced_Documents/ETSI": "@ertms-ref",
    "09_Referenced_Documents/ERTMS_Subsets": "@ertms-ref",
    "08_Norway/Nasjonale_regler_NNTR": "@nntr",
}

# Overrides: (regex on the file name, parent key). Used for link files and spreadsheets that have
# no machine-readable citations, and for the few places where the citation data guesses wrong.
OVERRIDES = [
    # ERA guidance pages and spreadsheets
    (r"^ERA_CSM_RA_page", "CSM RA"),
    (r"^(AsBo_RFU|CSM_RA_Application_Guide|CSM_RA_Collection_of_examples|Explanatory_note_CSM_AsBo)", "CSM RA"),
    (r"^Guide_harmonised_design_targets", "CSM RA"),
    (r"^(ERA_ERTMS_National_Technical_Rules|ERA_National_rules_page|SRD_portal|SRD_user_manual_MS|ERA-PRG-006)", "@natrules"),
    (r"^(NB-Rail_official_documents|RFU-STR-)", "Conformity Modules Decision"),
    (r"^RFU-CCS-", "CCS TSI"),
    (r"^RFU-RST-", "LOC&PAS TSI"),
    (r"^ERA_Knowledge_Graph", "RINF Regulation"),
    (r"^(EVR_user_manual|EVR_Guidelines)", "Vehicle Registers (EVR) Decision"),
    (r"^Harmonised_national_restriction_codes", "Vehicle Registers (EVR) Decision"),
    (r"^ERATV_Application_Guide", "ERATV Decision"),
    (r"^RINF_Application_Guide", "RINF Regulation"),
    (r"^(ERA_SSC_applications_page|SSC_assessors_toolkit|SSC_Application_Guide)", "Single Safety Certificate Regulation"),
    (r"^(ECM_SAIT_guidance|ECM_certification_guidance)", "ECM Regulation"),
    (r"^Management_Maturity_Model", "CSM Supervision"),
    (r"^Guide_on_supervision", "CSM Supervision"),
    (r"^Guide_CSM_monitoring", "CSM Monitoring"),
    (r"^SMS_Requirements_Guide", "CSM SMS requirements"),
    # 07 root (before the general CCS_TSI_ rule: first match wins)
    (r"^CCS_TSI_AppA_mandatory_specs", "@set4"),
    (r"^CCS_TSI_AnnexA_archived_specs", "@specs-old"),
    (r"^CCS_TSI_AG_informative_specs", "@set-inf"),
    (r"^(CCS_TSI_|Guide_ERA_ERTMS_033281|ERA-TD-2026-1_ERTMS_exclusions)", "CCS TSI"),
    (r"^(ERA_TSI_domain_page|Standards_quoted_in_TSIs|TSI_deficiencies|TSIs_chronology|TSI_General_Guide)", "@tsi"),
    (r"^(ERA_VA_page|ERA_VA_FAQ|OSS_portal|OSS_release_notes|OSS_User_Guide|Other_EU_legislation_for_VA|VA_legal_framework_overview|ERA1209-222_PA_VA)", "Vehicle Authorisation Regulation"),
    (r"^ERA_Route_Compatibility_Check", "OPE TSI"),
    (r"^(CCS|ENE|INF|NOI|OPE|PRM|SRT|WAG)_TSI_Guide", None),  # None = "the TSI named in the file"
    (r"^LOC-PAS_TSI_Guide", "LOC&PAS TSI"),
    # Norway
    (r"^CSM_SMS_2018-762_norsk_oversettelse", "CSM SMS-forskriften"),
    (r"^Jernbanekjoretoyforskriften_horingsutkast", "Jernbanekjøretøyforskriften"),
    (r"^(SJT_Horing_TSI_CCS|SJT_Horingsnotat_TSI_CCS)", "TSI CCS-forskriften"),
    (r"^SJT_Horingsnotat_forskrifter_jernbanekjoretoy", "Jernbanekjøretøyforskriften"),
    (r"^SJT_Kjoretoy_nasjonalt_regelverk", "Jernbanekjøretøyforskriften"),
    (r"^(SJT_Infrastruktur_krav_dokumentasjon|SJT_Tillatelse_infrastruktur|SJT_Veiledning_melding_soknad_infrastruktur|SJT_Kjoretoy_europeisk_regelverk|SJT_Tillatelse_kjoretoy_SJT_og_ERA)", "Samtrafikkforskriften"),
    (r"^SJT_Infrastruktur_unntak_TSI_NTR", "TSI-unntaksforskriften"),
    (r"^SJT_Krav_ECM", "ECM-forskriften"),
    (r"^SJT_STM_spesifikasjoner", "@atc2"),
    (r"^(SJT_Sjekkliste_risikovurderinger|SJT_Veileder_risikovurdering)", "CSM RA-forskriften"),
    (r"^(SJT_Sok_felles_sikkerhetssertifikat|SJT_Veileder_SMS_mindre_virksomheter|ERA_Application_guide_single_safety_certificate_NO)", "Sikkerhetsforskriften"),
    (r"^ERA_Guide_SMS_requirements_NO", "CSM SMS-forskriften"),
    (r"^SJT_Tillatelser_trikk_T-bane", "Kravforskriften (sporvei)"),
    (r"^SJT_Tredjepartsverifisering", "Meldermyndighetsforskriften (NoBo/DeBo)"),
    (r"^SJT_Veileder_arbeidsmaskinforskriften", "Arbeidsmaskinforskriften"),
    # CRA
    (r"^(CRA_Commission_policy_pages|CRA_Standardisation_Request_M606|ENISA_CRA_Single_Reporting_Platform|CRA_FAQ|CRA_Guidance)", "Cyber Resilience Act (CRA)"),
    # referenced documents with a clear home
    (r"^ERA-TD-2011-11_List_CCS_Class_B", "CCS TSI"),
    (r"^ERA-1172-00\d_ECM", "ECM Regulation"),
    (r"^ERA-TD-1\d\d_Telematics|^ERA-TD-B\d+_Telematics", "Telematics TSI (TEL)"),
    (r"^ERA_ERTMS_0(03204|40001|40055|40063|40092|40093)", "@ertms-misc"),
    (r"^ERA-ED-DEC-2110-2022_NoBo", "Conformity Modules Decision"),
]

SHOW = 8   # children shown before "show more" (hand-placed rows are always shown)

# --------------------------------------------------------------------------------------------
# Task paths. Each ref is resolved, in order, as: family key, document short name, cited-item
# label (EN 50126, SUBSET-026 …), file-name fragment.  Unresolved refs are reported at build.
# --------------------------------------------------------------------------------------------
PATHS = [
    {"id": "va", "t": "Authorise a vehicle", "d": "Placing a vehicle on the market with Norway in the area of use (ERA or SJT as authorising entity).", "steps": [
        ("Legal basis: Art. 21 of the Interoperability Directive, transposed by samtrafikkforskriften", ["Interoperability Directive", "Samtrafikkforskriften"]),
        ("Practical arrangements for authorisation", ["Vehicle Authorisation Regulation"]),
        ("ERA's guidelines and process flowcharts", ["PA VA Guidelines", "PA VA Guidelines – flowcharts", "VA_legal_framework_overview"]),
        ("Pre-engagement and application in the One-Stop Shop", ["OSS Guide for applicants", "OSS_portal"]),
        ("Requirements capture with CSM RA Annex I", ["CSM RA", "Clarification note ERA1209/146"]),
        ("TSI verification by a NoBo (modules, EC certificates and declarations)", ["Conformity Modules Decision", "EC Declaration Templates Regulation", "LOC&PAS TSI", "CCS TSI"]),
        ("Norwegian national rules, checked by a DeBo", ["Jernbanekjøretøyforskriften", "Meldermyndighetsforskriften (NoBo/DeBo)", "ERA_SRD_Single_Rules_Database"]),
        ("Independent safety assessment by an AsBo", ["AsBo explanatory note", "AsBo RFU 02"]),
        ("SJT's guidance when Norway is in the area of use", ["SJT_Tillatelse_kjoretoy_SJT_og_ERA", "SJT_Kjoretoy_europeisk_regelverk"]),
        ("Fees", ["ERA Fees Regulation", "Gebyrforskriften (SJT)"]),
        ("Registration: EVR (vehicle) and ERATV (type)", ["Vehicle Registers (EVR) Decision", "Kjøretøyregisterforskriften (EVR)", "ERATV Decision"]),
        ("Route compatibility check before first use", ["OPE TSI", "ERA_Route_Compatibility_Check", "RINF Regulation"]),
    ]},
    {"id": "etcs-ob", "t": "Place ETCS on-board in service in Norway", "d": "From the CCS TSI down to the specifications, tests and checks the on-board unit needs.", "steps": [
        ("The CCS TSI (consolidated 2026) and the Norwegian regulation that implements it", ["CCS TSI", "TSI CCS-forskriften"]),
        ("Application guide and transition rules", ["CCS TSI Guide", "CCS_TSI_transition_regime_tool"]),
        ("Set 4 mandatory specs: SRS, DMI and train interface", ["004_SUBSET-026_v400", "006_ERA_ERTMS_015560_v400", "007_SUBSET-034_v400", "081_SUBSET-119_v400"]),
        ("Norway runs system version 3.6.0 (Set 3), so check version management", ["Set3_ETCS_B3_R2/004_SUBSET-026", "060_SUBSET-104_v400"]),
        ("Class B: the ATC-2 STM interface", ["008_SUBSET-035_v400", "SJT_STM_spesifikasjoner"]),
        ("Test specifications and NB-Rail recommendations", ["037d_SUBSET-076-7", "NB-Rail RFU-CCS-067", "NB-Rail RFU-CCS-505"]),
        ("ETCS system compatibility (ESC/RSC) with Bane NOR", ["ESC-RSC_Technical_Document", "ESC_documents_per_IM", "BaneNOR_Systembeskrivelse_ERTMS"]),
        ("Safety: RAMS standards and CSM RA", ["EN 50126", "EN 50128", "EN 50129", "CSM RA"]),
        ("Authorisation via the OSS", ["Vehicle Authorisation Regulation", "SJT_Tillatelse_kjoretoy_SJT_og_ERA"]),
    ]},
    {"id": "trackside", "t": "Place trackside CCS in service in Norway", "d": "Fixed installations: ERA pre-approval of ERTMS trackside, verification and SJT's permit.", "steps": [
        ("Art. 18–19 of the Interoperability Directive (ERA pre-approval of ERTMS trackside)", ["Interoperability Directive", "Samtrafikkforskriften"]),
        ("CCS TSI trackside requirements and interfaces to other subsystems", ["CCS TSI", "077_ERA_ERTMS_033281", "Guide_ERA_ERTMS_033281"]),
        ("Notified national rules for fixed installations", ["ERA-PRG-006", "ERA_ERTMS_national_technical_rules"]),
        ("NoBo and DeBo verification", ["Conformity Modules Decision", "Meldermyndighetsforskriften (NoBo/DeBo)", "SJT_Tredjepartsverifisering"]),
        ("Risk assessment and AsBo", ["CSM RA", "CSM RA-forskriften"]),
        ("SJT application for new or changed infrastructure", ["SJT_Tillatelse_infrastruktur", "SJT_Veiledning_melding_soknad_infrastruktur", "SJT_Infrastruktur_krav_dokumentasjon"]),
        ("Bane NOR's technical rules and Network Statement", ["BaneNOR_TRV_RollingStock_Signalling", "Network Statement 2027 (EN)"]),
        ("Register the line in RINF", ["RINF Regulation", "RINF Guide"]),
    ]},
    {"id": "csmra", "t": "Apply CSM RA and use an AsBo", "d": "Significance of change, risk assessment and the independent assessment report.", "steps": [
        ("CSM RA (as amended by 2015/1136)", ["CSM RA"]),
        ("The Norwegian implementation", ["CSM RA-forskriften", "Sikkerhetsforskriften"]),
        ("ERA guide, worked examples and design targets", ["CSM RA Guide", "CSM RA – collection of examples", "Guide_harmonised_design_targets"]),
        ("Safe integration", ["Clarification note ERA1209/063"]),
        ("The AsBo's role, working method and competence", ["AsBo explanatory note", "AsBo RFU 01", "AsBo RFU 03"]),
        ("The AsBo safety assessment report", ["AsBo RFU 02", "AsBo RFU 04"]),
        ("NoBo acceptance of AsBo results", ["Clarification note ERA1209/186"]),
        ("Standards for explicit risk estimation", ["EN 50126", "EN 50129"]),
        ("SJT guidance and checklist", ["SJT_Veileder_risikovurdering", "SJT_Sjekkliste_risikovurderinger"]),
    ]},
    {"id": "atc2", "t": "ATC-2 STM", "d": "The Norwegian class B system (ATC-2) as an STM on the ETCS on-board unit.", "steps": [
        ("CCS TSI class B rules and ERA's list of class B systems", ["CCS TSI", "ERA-TD-2011-11_List_CCS_Class_B"]),
        ("STM interface specifications (Set 4)", ["008_SUBSET-035_v400", "025_SUBSET-056", "026_SUBSET-057", "052_SUBSET-058", "049_SUBSET-059"]),
        ("STM test cases", ["036c_SUBSET-074-2"]),
        ("SJT's STM specification page", ["SJT_STM_spesifikasjoner"]),
        ("STM FRS v6.1 (current): introduction and chapters 3, 4, 5 and 8", ["ATC-2 STM FRS v6.1 – innledning", "ATC-2 STM FRS v6.1 – kap. 3", "ATC-2 STM FRS v6.1 – kap. 4", "ATC-2 STM FRS v6.1 – kap. 5", "ATC-2 STM FRS v6.1 – kap. 8"]),
        ("General technical requirements and RAMS", ["ATC-2 STM GRS v6.1", "ATC-2 STM RAMS requirements"]),
        ("The Norwegian TSI CCS regulation", ["TSI CCS-forskriften"]),
        ("Earlier versions for existing fleets", ["ATC-2 STM FRS v6.0 – innledning", "ATC-2 STM FRS v5.2 – innledning"]),
    ]},
    {"id": "cra", "t": "Cyber Resilience Act for rail products", "d": "Rail is not excluded: connected products with digital elements are in scope from 11 Dec 2027.", "steps": [
        ("The CRA (Regulation (EU) 2024/2847)", ["Cyber Resilience Act (CRA)"]),
        ("Commission guidance and FAQ", ["CRA Guidance", "CRA Guidance – annex", "CRA FAQ"]),
        ("Important and critical products (Annex III/IV)", ["CRA – important & critical products"]),
        ("Delegated acts so far", ["CRA – L-category exclusion", "CRA – delayed notifications"]),
        ("Vulnerability and incident reporting (from 11 Sep 2026)", ["ENISA_CRA_Single_Reporting_Platform"]),
        ("Harmonised standards (M/606)", ["CRA_Standardisation_Request_M606"]),
        ("Where rail law meets it: CCS TSI and ERTMS end-to-end security", ["CCS TSI", "010d_SUBSET-146"]),
        ("Neighbouring cyber legislation", ["NIS2 Directive", "Cybersecurity Act", "RED delegated cybersecurity"]),
        ("Rail and industrial cyber standards", ["CLC/TS 50701", "IEC 62443-3-3"]),
    ]},
    {"id": "jru", "t": "Juridical recording", "d": "What the on-board recorder must log, and where those rules live.", "steps": [
        ("OPE TSI: recording of data", ["OPE TSI"]),
        ("CCS TSI: the recording function", ["CCS TSI"]),
        ("SUBSET-027 FIS Juridical Recording (Set 4)", ["005_SUBSET-027_v400"]),
        ("SUBSET-027 in the Set 3 version used in Norway", ["Set3_ETCS_B3_R2/005_SUBSET-027"]),
        ("The SRS and DMI for the recorded events", ["004_SUBSET-026_v400", "006_ERA_ERTMS_015560_v400"]),
        ("LOC&PAS TSI: on-board recording device", ["LOC&PAS TSI"]),
        ("Standards for on-board data recording", ["IEC 62625-1", "IEC 62625-2"]),
        ("Use after accidents: investigation and reporting", ["Jernbaneundersøkelsesloven", "Varslings- og rapporteringsforskriften", "Accident Investigation Reports Regulation"]),
    ]},
    {"id": "ssc", "t": "Single safety certificate and SMS", "d": "For a railway undertaking operating in Norway; ECM certification at the end.", "steps": [
        ("The Railway Safety Directive and sikkerhetsforskriften", ["Railway Safety Directive", "Sikkerhetsforskriften"]),
        ("Practical arrangements for the single safety certificate", ["Single Safety Certificate Regulation"]),
        ("SMS requirements", ["CSM SMS requirements", "CSM SMS-forskriften"]),
        ("ERA's application and SMS guides (also in Norwegian)", ["SSC Application Guide", "SMS Requirements Guide", "SMS Requirements Guide (norsk)"]),
        ("Apply via the OSS; SJT's page", ["SJT_Sok_felles_sikkerhetssertifikat", "OSS_portal"]),
        ("After certification: monitoring and supervision", ["CSM Monitoring", "CSM Supervision", "CSM Monitoring Guide", "Management_Maturity_Model"]),
        ("Entity in charge of maintenance (ECM)", ["ECM Regulation", "ECM Certification Guidance", "ECM-forskriften"]),
    ]},
]
