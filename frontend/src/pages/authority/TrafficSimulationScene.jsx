import React, { useMemo } from 'react';

function signalPhase(minute, scenario) {
  if (scenario === 'signal_priority') return minute % 20 < 15 ? 'NS' : 'EW';
  return Math.floor(minute / (scenario === 'demand_surge' ? 5 : 10)) % 2 === 0 ? 'NS' : 'EW';
}

function SignalHead({ x, y, label, active, rotate = 0 }) {
  const ns = active === 'NS';
  const go = (label === 'N' || label === 'S') ? ns : !ns;
  return <g transform={`translate(${x} ${y}) rotate(${rotate})`}>
    <rect x="-14" y="-33" width="28" height="66" rx="8" fill="#14211f" stroke="#58716a" strokeWidth="2"/>
    <circle cx="0" cy="-20" r="7" fill={!go ? '#e44343' : '#743434'} stroke={!go ? '#ff8980' : '#512525'} strokeWidth="1.3"/>
    <circle cx="0" cy="0" r="7" fill="#594923" stroke="#a48b43" strokeWidth="1.2"/>
    <circle cx="0" cy="20" r="7" fill={go ? '#38db83' : '#245b43'} stroke={go ? '#a1ffd0' : '#183f30'} strokeWidth="1.3"/>
    <rect x="-24" y="-51" width="48" height="13" rx="5" fill="#f8fbf3" stroke="#b9c6b8"/>
    <text x="0" y="-42" textAnchor="middle" fontSize="8.5" fontWeight="900" fill="#19372d">{label} · {go ? 'GO' : 'STOP'}</text>
  </g>;
}

function Car({ x, y, direction, index, moving }) {
  const rotation = direction === 'N' ? 90 : direction === 'S' ? -90 : direction === 'W' ? 180 : 0;
  const colors = ['#f3c85b', '#71b9ea', '#f6f8f3', '#e27e62', '#9aadd4', '#7dd0a4'];
  return <g className={moving ? `sim-car sim-car-${direction.toLowerCase()}` : ''} style={moving ? { animationDelay: `${(index % 5) * 0.14}s` } : undefined} transform={`translate(${x} ${y}) rotate(${rotation})`}>
    <rect x="-15" y="-8" width="30" height="16" rx="4" fill="#243631" opacity=".5" transform="translate(1.5 2)"/>
    <rect x="-15" y="-8" width="30" height="16" rx="4" fill={colors[index % colors.length]} stroke="#f6f8f2" strokeWidth="1"/>
    <rect x="-6" y="-5" width="12" height="10" rx="2" fill="#244a55" opacity=".9"/>
    <rect x="-12" y="-7" width="4" height="3" rx="1" fill="#fff2bd"/>
    <rect x="8" y="-7" width="4" height="3" rx="1" fill="#fff2bd"/>
  </g>;
}

function Person({ x, y, scale = 1 }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`} strokeLinecap="round">
    <circle cx="0" cy="-7" r="3.2" fill="#e6b28b" stroke="#725645" strokeWidth=".8"/>
    <path d="M0 -3 L0 5 M0 0 L-4 3 M0 0 L4 3 M0 5 L-3 10 M0 5 L3 10" stroke="#35665b" strokeWidth="2.6" fill="none"/>
  </g>;
}

export default function TrafficSimulationScene({ roads = [], frame, scenario = 'baseline', playing = false, areaName = 'Selected area' }) {
  const active = signalPhase(Number(frame?.minute || 0), scenario);
  const directions = useMemo(() => {
    const source = roads || [];
    return [
      { key: 'N', road: source[0] || source[4], count: source[0] || source[4] },
      { key: 'S', road: source[1] || source[5], count: source[1] || source[5] },
      { key: 'W', road: source[2] || source[6], count: source[2] || source[6] },
      { key: 'E', road: source[3] || source[7], count: source[3] || source[7] },
    ].map((item) => ({ ...item, queue: Math.max(0, Number(item.count?.queue || 0)), vehicles: Math.max(0, Number(item.count?.vehicles || 0)) }));
  }, [roads]);
  const queueCars = (key) => {
    const source = directions.find((item) => item.key === key);
    return Math.max(1, Math.min(7, Math.ceil((source?.queue || 2) / 6)));
  };
  const pedestrianCount = Math.min(18, 6 + Number(frame?.heavy_roads || 0) * 2);
  const people = useMemo(() => Array.from({ length: pedestrianCount }, (_, i) => i), [pedestrianCount]);
  const labels = {
    N: directions.find((item) => item.key === 'N')?.road?.road || 'North approach',
    S: directions.find((item) => item.key === 'S')?.road?.road || 'South approach',
    W: directions.find((item) => item.key === 'W')?.road?.road || 'West approach',
    E: directions.find((item) => item.key === 'E')?.road?.road || 'East approach',
  };
  const cars = [];
  const n = queueCars('N'), s = queueCars('S'), w = queueCars('W'), e = queueCars('E');
  for (let i = 0; i < n; i++) cars.push(<Car key={`n-${i}`} x={475 + (i % 2) * 24} y={36 + i * 22} direction="S" index={i} moving={playing && active === 'NS'}/>);
  for (let i = 0; i < s; i++) cars.push(<Car key={`s-${i}`} x={526 - (i % 2) * 24} y={474 - i * 22} direction="N" index={i + 1} moving={playing && active === 'NS'}/>);
  for (let i = 0; i < w; i++) cars.push(<Car key={`w-${i}`} x={28 + i * 27} y={229 + (i % 2) * 30} direction="E" index={i + 2} moving={playing && active === 'EW'}/>);
  for (let i = 0; i < e; i++) cars.push(<Car key={`e-${i}`} x={952 - i * 27} y={269 - (i % 2) * 30} direction="W" index={i + 3} moving={playing && active === 'EW'}/>);
  return <section className={`panel traffic-sim-scene ${playing ? 'is-playing' : ''}`} aria-label="Animated traffic intersection">
    <div className="traffic-sim-scene-head">
      <div><span className="eyebrow">TRAFFIC NETWORK PLAYBACK</span><h3>{areaName} · Intersection activity</h3><p>Vehicle movement, queues and signal phases update during playback.</p></div>
      <div className="traffic-sim-live"><i/>{playing ? 'PLAYING' : 'PAUSED'} <b>MIN {frame?.minute ?? 0}</b></div>
    </div>
    <div className="traffic-sim-scene-canvas">
      <svg viewBox="0 0 980 520" role="img" aria-label={`Road network at simulation minute ${frame?.minute ?? 0}; north-south ${active === 'NS' ? 'green' : 'red'}, east-west ${active === 'EW' ? 'green' : 'red'}`}>
        <defs>
          <pattern id="urban-grid" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M 28 0 L 0 0 0 28" fill="none" stroke="#a5b6a4" strokeWidth=".6" opacity=".36"/></pattern>
          <pattern id="road-grain" width="46" height="46" patternUnits="userSpaceOnUse"><circle cx="7" cy="8" r=".8" fill="#ffffff" opacity=".1"/><circle cx="31" cy="25" r=".8" fill="#000000" opacity=".08"/></pattern>
        </defs>
        <rect width="980" height="520" fill="#e3eadf"/>
        <rect width="980" height="520" fill="url(#urban-grid)"/>
        <g fill="#cbd7c8" stroke="#b6c5b4" strokeWidth="1.3">
          <rect x="22" y="25" width="303" height="115" rx="13"/><rect x="650" y="25" width="305" height="115" rx="13"/>
          <rect x="22" y="385" width="303" height="110" rx="13"/><rect x="650" y="385" width="305" height="110" rx="13"/>
          <rect x="46" y="48" width="66" height="61" rx="7" fill="#bdcbb9"/><rect x="130" y="48" width="80" height="61" rx="7" fill="#bdcbb9"/><rect x="229" y="48" width="72" height="61" rx="7" fill="#bdcbb9"/>
          <rect x="674" y="48" width="78" height="61" rx="7" fill="#bdcbb9"/><rect x="770" y="48" width="62" height="61" rx="7" fill="#bdcbb9"/><rect x="849" y="48" width="83" height="61" rx="7" fill="#bdcbb9"/>
          <rect x="46" y="406" width="80" height="62" rx="7" fill="#bdcbb9"/><rect x="143" y="406" width="65" height="62" rx="7" fill="#bdcbb9"/><rect x="225" y="406" width="77" height="62" rx="7" fill="#bdcbb9"/>
          <rect x="674" y="406" width="80" height="62" rx="7" fill="#bdcbb9"/><rect x="770" y="406" width="66" height="62" rx="7" fill="#bdcbb9"/><rect x="851" y="406" width="80" height="62" rx="7" fill="#bdcbb9"/>
        </g>
        <g fill="#7e8984" stroke="#e5ece3" strokeWidth="2">
          <rect x="0" y="164" width="980" height="194"/><rect x="396" y="0" width="188" height="520"/>
        </g>
        <rect x="0" y="164" width="980" height="194" fill="url(#road-grain)"/><rect x="396" y="0" width="188" height="520" fill="url(#road-grain)"/>
        <g stroke="#e6dfae" strokeWidth="2.5" strokeDasharray="19 16" opacity=".95"><path d="M0 235 H395 M585 235 H980 M0 286 H395 M585 286 H980"/><path d="M449 0 V163 M449 359 V520 M531 0 V163 M531 359 V520"/></g>
        <g stroke="#eaf1e9" strokeWidth="2" opacity=".8"><path d="M0 174 H396 M584 174 H980 M0 347 H396 M584 347 H980"/><path d="M406 0 V164 M574 0 V164 M406 358 V520 M574 358 V520"/></g>
        <g stroke="#f6f7e9" strokeWidth="4" opacity=".95">
          {Array.from({ length: 10 }, (_, i) => <path key={`top-z-${i}`} d={`M${410 + i * 17} 151 v17`}/>)}
          {Array.from({ length: 10 }, (_, i) => <path key={`bottom-z-${i}`} d={`M${410 + i * 17} 358 v17`}/>)}
          {Array.from({ length: 8 }, (_, i) => <path key={`left-z-${i}`} d={`M${376 + i * 3} ${186 + i * 20} h19`}/>)}
          {Array.from({ length: 8 }, (_, i) => <path key={`right-z-${i}`} d={`M${585 + i * 3} ${186 + i * 20} h19`}/>)}
        </g>
        <g fill="#e6c66a" opacity=".85"><rect x="398" y="166" width="14" height="190" rx="3"/><rect x="568" y="166" width="14" height="190" rx="3"/><rect x="0" y="164" width="980" height="10"/><rect x="0" y="348" width="980" height="10"/></g>
        <g fontSize="10" fontWeight="800" fill="#f4f7f1" letterSpacing="1.1"><text x="28" y="207">WEST APPROACH</text><text x="680" y="207">EAST APPROACH</text><text x="427" y="24" transform="rotate(90 427 24)">NORTH APPROACH</text><text x="553" y="501" transform="rotate(-90 553 501)">SOUTH APPROACH</text></g>
        <g fontSize="11" fontWeight="800" fill="#263a31">
          <rect x="19" y="363" width="260" height="27" rx="7" fill="#f4f7ef" stroke="#becbb9"/><text x="31" y="381">W · {labels.W}</text>
          <rect x="700" y="363" width="260" height="27" rx="7" fill="#f4f7ef" stroke="#becbb9"/><text x="712" y="381">E · {labels.E}</text>
          <rect x="595" y="8" width="350" height="27" rx="7" fill="#f4f7ef" stroke="#becbb9"/><text x="607" y="26">N · {labels.N}</text>
          <rect x="595" y="485" width="350" height="27" rx="7" fill="#f4f7ef" stroke="#becbb9"/><text x="607" y="503">S · {labels.S}</text>
        </g>
        {cars}
        <g><SignalHead x={370} y={155} label="W" active={active}/><SignalHead x={610} y={155} label="N" active={active}/><SignalHead x={370} y={367} label="S" active={active}/><SignalHead x={610} y={367} label="E" active={active}/></g>
        <g fill="#263b31"><rect x="21" y="30" width="190" height="25" rx="8" fill="#f8fbf5" stroke="#becbb9"/><text x="32" y="47" fontSize="10" fontWeight="800">PEDESTRIAN WAITING AREAS</text></g>
        {people.map((i) => {
          const groups = [[346,143],[620,143],[347,378],[624,378]]; const group = groups[i % groups.length]; const local = Math.floor(i / groups.length);
          return <Person key={`person-${i}`} x={group[0] + (local % 4) * 10} y={group[1] + Math.floor(local / 4) * 11} scale={.78}/>;
        })}
        <g><rect x="22" y="458" width="210" height="35" rx="9" fill="#f8fbf5" stroke="#bdcbb9"/><text x="35" y="472" fontSize="9" fill="#5a6d61">PEDESTRIANS WAITING</text><text x="35" y="486" fontSize="14" fontWeight="900" fill="#243e32">{pedestrianCount} people</text></g>
        <g><rect x="745" y="458" width="210" height="35" rx="9" fill="#f8fbf5" stroke="#bdcbb9"/><text x="758" y="472" fontSize="9" fill="#5a6d61">QUEUED VEHICLES</text><text x="758" y="486" fontSize="14" fontWeight="900" fill="#243e32">{Number(frame?.queue_total || 0).toLocaleString('en-IN')}</text></g>
      </svg>
    </div>
    <div className="traffic-sim-scene-footer">
      <div className="traffic-sim-signal-summary"><span className={active === 'NS' ? 'go' : 'stop'}><i/>{active === 'NS' ? 'N/S GREEN' : 'N/S RED'}</span><span className={active === 'EW' ? 'go' : 'stop'}><i/>{active === 'EW' ? 'E/W GREEN' : 'E/W RED'}</span><small>Illustrative signal phase</small></div>
      <div className="traffic-sim-road-key"><span><i className="light-road"/> Road network</span><span><i className="light-car"/> Vehicles</span><span><i className="light-person"/> Pedestrian zones</span></div>
    </div>
  </section>;
}
