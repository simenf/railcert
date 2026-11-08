#!/usr/bin/env python3
"""build_nav.py [map_dir]   (default: 99_Reference_Map next to this tools folder)

Re-renders both editions of the reference map from the data already embedded in
reference_map.html, with a freshly built Navigator and the current map_template.html.
Use it after editing nav_config.py or the template; it needs no documents or pdftotext.
The full rebuild (bash tools/finalize.sh) runs the same Navigator code."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from navigator import build_nav, write_html

out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "99_Reference_Map")
html = open(os.path.join(out, "reference_map.html"), encoding="utf-8").read()
start = html.index("const D=") + len("const D=")
data = json.JSONDecoder().raw_decode(html, start)[0]
data.pop("nav", None)
data["nav"] = build_nav(data)
print("html KB", write_html(out, data) // 1024)
