import { useEffect, useMemo, useState } from 'react';
import { Activity, Pause, Play, RadioTower, RotateCcw } from 'lucide-react';
import './road-network.css';

const PHASES = ['north-south', 'north-yellow', 'east-west', 'east-yellow'];
const PHASE_LABELS = {
  'north-south': 'North / South green',
  'north-yellow': 'North / South amber',
  'east-west': 'East / West green',
  'east-yellow': 'East / West amber',
  'all-red': 'All directions stop',
};

function statusForPhase(phase) {
  if (phase === 'all-red') return 'red';
  if (phase === 'north-yellow' || phase === 'east-yellow') return 'yellow';
  return 'green';
}

function statusForDirection(direction, phase) {
  if (phase === 'all-red') return 'red';
  if (direction === 'ns') {
    if (phase === 'north-south') return 'green';
    if (phase === 'north-yellow') return 'yellow';
    return 'red';
  }
  if (phase === 'east-west') return 'green';
  if (phase === 'east-yellow') return 'yellow';
  return 'red';
}

function SignalHead({ label, direction, position, phase }) {
  const status = statusForDirection(direction, phase);
  return <div className={`rn-signal-head rn-signal-${position}`} aria-label={`${label} traffic signal is ${status}`}>
    <span className={status === 'red' ? 'is-on' : ''} data-lamp="red" />
    <span className={status === 'yellow' ? 'is-on' : ''} data-lamp="yellow" />
    <span className={status === 'green' ? 'is-on' : ''} data-lamp="green" />
    <small>{label}</small>
  </div>;
}

export default function RoadNetworkAnimation({ plan, phases = [] }) {
  const [phase, setPhase] = useState('north-south');
  const [automatic, setAutomatic] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const planKey = `${plan?.id ?? ''}-${plan?.junction_id ?? ''}`;
  const layout = useMemo(() => {
    const id = Number(plan?.junction_id || 1);
    const signature = `${plan?.id ?? ''}-${plan?.plan_type ?? ''}`;
    const checksum = [...signature].reduce((total, character) => total + character.charCodeAt(0), 0);
    return ['central', 'offset', 'wide'][Math.abs(id + checksum) % 3];
  }, [plan?.id, plan?.plan_type, plan?.junction_id]);
  const northGreen = phases.find((item) => /north|south/i.test(`${item.movement || ''} ${item.name || ''}`))?.green_seconds ?? 28;
  const eastGreen = phases.find((item) => /east|west/i.test(`${item.movement || ''} ${item.name || ''}`))?.green_seconds ?? 20;

  useEffect(() => {
    if (!automatic) return undefined;
    const timer = window.setInterval(() => {
      setPhase((current) => {
        const index = PHASES.indexOf(current);
        const next = PHASES[(index + 1 + PHASES.length) % PHASES.length];
        return next;
      });
      setElapsed((current) => current + 1);
    }, 4200);
    return () => window.clearInterval(timer);
  }, [automatic, planKey]);

  useEffect(() => {
    setPhase('north-south');
    setElapsed(0);
    setAutomatic(true);
  }, [planKey]);

  const choosePhase = (next) => {
    setAutomatic(false);
    setPhase(next);
    setElapsed(0);
  };

  return <section className="rn-widget" aria-label="Interactive traffic signal simulation">
    <div className="rn-widget-header">
      <div><span className="rn-eyebrow"><RadioTower size={15} /> SIMULATED ROAD NETWORK</span><h4>Live intersection preview</h4><p>Vehicles animate continuously. Select a signal phase to inspect how the junction state changes.</p></div>
      <span className={`rn-live-chip ${automatic ? 'is-auto' : 'is-manual'}`}><i />{automatic ? 'AUTO CYCLE' : 'MANUAL PHASE'}</span>
    </div>

    <div className={`rn-scene rn-layout-${layout}`} data-phase={phase}>
      <div className="rn-grid-glow" />
      <div className="rn-road rn-road-horizontal"><span className="rn-lane-divider"/><span className="rn-lane-edge top"/><span className="rn-lane-edge bottom"/></div>
      <div className="rn-road rn-road-vertical"><span className="rn-lane-divider"/><span className="rn-lane-edge left"/><span className="rn-lane-edge right"/></div>
      <div className="rn-crosswalk rn-crosswalk-north"/><div className="rn-crosswalk rn-crosswalk-south"/>
      <div className="rn-crosswalk rn-crosswalk-east"/><div className="rn-crosswalk rn-crosswalk-west"/>
      <div className="rn-junction-core"><span>JUNCTION {plan?.junction_id ?? '12'}</span><b><Activity size={19}/></b><small>{plan?.plan_type?.replaceAll('_', ' ') || 'adaptive scenario'}</small></div>

      <div className="rn-vehicle rn-car car-n1"/><div className="rn-vehicle rn-car car-n2"/><div className="rn-vehicle rn-van car-n3"/>
      <div className="rn-vehicle rn-car car-s1"/><div className="rn-vehicle rn-car car-s2"/>
      <div className="rn-vehicle rn-car car-e1"/><div className="rn-vehicle rn-car car-e2"/><div className="rn-vehicle rn-van car-e3"/>
      <div className="rn-vehicle rn-car car-w1"/><div className="rn-vehicle rn-car car-w2"/>

      <SignalHead label="N" direction="ns" position="n" phase={phase}/><SignalHead label="S" direction="ns" position="s" phase={phase}/>
      <SignalHead label="E" direction="ew" position="e" phase={phase}/><SignalHead label="W" direction="ew" position="w" phase={phase}/>
      <div className="rn-direction-label rn-direction-n">N</div><div className="rn-direction-label rn-direction-e">E</div><div className="rn-direction-label rn-direction-s">S</div><div className="rn-direction-label rn-direction-w">W</div>
      <div className="rn-simulation-stamp"><span className="rn-pulse-dot"/> Simulation running <b>{String(elapsed).padStart(2, '0')}</b></div>
    </div>

    <div className="rn-phase-status"><span className="rn-phase-indicator" data-status={statusForPhase(phase)}/><div><small>ACTIVE SIGNAL PHASE</small><b>{PHASE_LABELS[phase] || PHASE_LABELS['north-south']}</b></div><div className="rn-phase-timing"><small>NS GREEN</small><b>{northGreen}s</b></div><div className="rn-phase-timing"><small>EW GREEN</small><b>{eastGreen}s</b></div></div>
    <div className="rn-controls" role="group" aria-label="Traffic signal controls">
      <button className={automatic ? 'selected' : ''} onClick={() => { setAutomatic(true); setElapsed(0); }}><Play size={15}/> Auto cycle</button>
      <button className={!automatic && phase === 'north-south' ? 'selected' : ''} onClick={() => choosePhase('north-south')}><span className="rn-color-dot green"/> N / S green</button>
      <button className={!automatic && phase === 'north-yellow' ? 'selected' : ''} onClick={() => choosePhase('north-yellow')}><span className="rn-color-dot yellow"/> N / S amber</button>
      <button className={!automatic && phase === 'east-west' ? 'selected' : ''} onClick={() => choosePhase('east-west')}><span className="rn-color-dot green"/> E / W green</button>
      <button className={!automatic && phase === 'east-yellow' ? 'selected' : ''} onClick={() => choosePhase('east-yellow')}><span className="rn-color-dot yellow"/> E / W amber</button>
      <button className={!automatic && phase === 'all-red' ? 'selected' : ''} onClick={() => choosePhase('all-red')}><span className="rn-color-dot red"/> All red</button>
      <button className="rn-reset" onClick={() => { setAutomatic(true); setPhase('north-south'); setElapsed(0); }}><RotateCcw size={14}/> Reset</button>
    </div>
    <div className="rn-legend"><span><i className="red"/> Stop</span><span><i className="yellow"/> Prepare</span><span><i className="green"/> Go</span><small>Illustrative simulation only · no physical traffic light is controlled</small></div>
  </section>;
}
