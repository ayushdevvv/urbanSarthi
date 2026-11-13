from pathlib import Path
import re
p = Path('/mnt/data/urbansarthi_agent_update/frontend/src/pages/citizen/TrafficVisionPage.jsx')
s = p.read_text()
s = s.replace("import { useEffect, useMemo, useRef, useState } from 'react';", "import { useEffect, useRef, useState } from 'react';")
s = s.replace("  Activity, AlertTriangle, ArrowDownToLine, ArrowUpRight, Bot, Check, CheckCircle2,\n  ChevronDown, CircleHelp, Clock3, Cpu, FileVideo, Gauge, GitBranch, LoaderCircle,\n  Play, ScanLine, ShieldCheck, SlidersHorizontal, Sparkles, Video, XCircle,\n", "  AlertTriangle, ArrowDownToLine, ArrowUpRight, CheckCircle2, ChevronDown,\n  CircleHelp, Clock3, Cpu, FileVideo, Gauge, LoaderCircle, ScanLine, ShieldCheck, Video, XCircle,\n")
s=s.replace("import { useApp } from '../../context/AppContext.jsx';", "import { useApp } from '../../context/AppContext.jsx';\nimport { Link } from 'react-router-dom';")
# Drop now-separated chart function.
s = re.sub(r"\nfunction TrendChart\(\{ timeline \}\) \{.*?\n\}\n\n(?=export default function TrafficVisionPage)", "\n", s, flags=re.S)
# Remove agent-only state.
s = s.replace("  const [junctions, setJunctions] = useState([]);\n  const [junctionId, setJunctionId] = useState('');\n", "")
s = s.replace("  const [scenario, setScenario] = useState('signal_priority');\n  const [cycleSeconds, setCycleSeconds] = useState('90');\n  const [prompt, setPrompt] = useState('Review the traffic evidence, draft a safe adaptive signal plan and run the 60-minute forecast.');\n", "")
s = s.replace("  const [agentBusy, setAgentBusy] = useState(false);\n  const [reviewBusy, setReviewBusy] = useState(false);\n", "")
s = s.replace("  const [workflow, setWorkflow] = useState(null);\n  const [dispatchPreview, setDispatchPreview] = useState(null);\n", "")
# Status endpoint only. Junction operations belong to the separate agent page.
s = re.sub(r"    Promise\.allSettled\(\[\n      api\.get\('/traffic-detection/video-status'\),\n      api\.get\('/traffic/junctions'\),\n    \]\)\.then\(\(\[statusResult, junctionResult\]\) => \{\n      if \(!alive\) return;\n      if \(statusResult\.status === 'fulfilled'\) setSystemStatus\(statusResult\.value\);\n      else setSystemStatus\(\{ ready: false, opencv_available: false, video_analysis_ready: false, note: statusResult\.reason\?\.message \|\| 'Backend is unreachable\.' \}\);\n      if \(junctionResult\.status === 'fulfilled'\) \{\n        const items = Array\.isArray\(junctionResult\.value\) \? junctionResult\.value : \[\];\n        setJunctions\(items\);\n        if \(items\.length\) setJunctionId\(String\(items\[0\]\.id\)\);\n      \}\n    \}\);", "    api.get('/traffic-detection/video-status', { timeoutMs: 40000 }).then((result) => {\n      if (alive) setSystemStatus(result);\n    }).catch((reason) => {\n      if (alive) setSystemStatus({ ready: false, opencv_available: false, video_analysis_ready: false, note: reason?.message || 'Backend is unreachable.' });\n    });", s)
s=s.replace("    setWorkflow(null);\n    setDispatchPreview(null);\n", "")
s=s.replace("    setWorkflow(null);\n    setDispatchPreview(null);\n", "")
# Remove workflow actions from this file.
s = re.sub(r"\n  async function runAgentWorkflow\(\) \{.*?\n  function downloadReport\(\) \{", "\n  function downloadReport() {", s, flags=re.S)
s = s.replace("const payload = { project: 'Traffic Intelligence', generated_at: new Date().toISOString(), evidence: compactReport(report), agent: workflow?.agent || null, tools: workflow?.tools || [], draft_plan: workflow?.plan || null, forecast: workflow?.simulation || null, note: workflow?.simulation?.mode === 'native_sumo_simulation' ? 'Native SUMO ran 3,600 simulated seconds on the bundled synthetic grid. Video is not map-matched; human review required; physical dispatch disabled.' : 'Forecast data uses the supplied SUMO-generated dataset and trained XGBoost models. The video is not a lane-calibrated input to that forecast. Human review required; physical dispatch disabled.' };", "const payload = { project: 'UrbanSaarthi Traffic Lab', generated_at: new Date().toISOString(), evidence: compactReport(report), note: 'YOLO/OpenCV detections from the uploaded source. Object counts are not calibrated queue length or speed measurements.' };")
# Replace the old embedded agent workflow with a prominent separate-page handoff.
start = s.index('    <div className="ul-section-heading ul-operator-heading">')
end = s.index('    <footer className="ul-lab-footer">', start)
end2 = s.index('</footer>', end) + len('</footer>')
replacement = '''    <section className="ul-agent-handoff">
      <div className="ul-agent-handoff-copy">
        <span className="ul-panel-kicker">02 / AUTONOMOUS DECISION SUPPORT</span>
        <h2>Evidence captured. Let TrafficSaarthi work.</h2>
        <p>Your saved YOLO report is ready for the operations agent. It can inspect the evidence, estimate corridor emissions, draft signal phases and run a 60-minute forecast before asking an operator to review.</p>
        <div className="ul-handoff-points"><span>Evidence inspection</span><span>Signal-plan drafting</span><span>60-minute forecast</span><span>Human approval</span></div>
      </div>
      <Link className="ul-agent-handoff-button" to="/authority/traffic-agent">Open Traffic Agent <ArrowUpRight size={17}/></Link>
    </section>
    <footer className="ul-lab-footer"><div><ShieldCheck size={14}/><span>YOLO evidence</span><i/> <span>Operator-reviewed decisions</span></div><span>URBANSARTHI · TRAFFIC INTELLIGENCE</span></footer>'''
s = s[:start] + replacement + s[end2:]
# Remove any residual unused `reportRestored` mutations? keep to show report provenance.
p.write_text(s)
print('rewrote TrafficVisionPage', len(s.splitlines()), 'lines')
