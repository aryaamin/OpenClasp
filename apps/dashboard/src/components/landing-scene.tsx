import { useEffect, useRef } from 'react';
import { ClaspMark } from '@/components/clasp-mark';

const LUM = ' .:-=+*#%@';
const COLS = 88;
const ROWS = 40;
const reduceMotion =
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function clockStamp() {
  return new Date().toISOString().slice(11, 19);
}

function rotateX(x: number, y: number, z: number, angle: number) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [x, y * cos - z * sin, y * sin + z * cos] as const;
}

function rotateY(x: number, y: number, z: number, angle: number) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [x * cos + z * sin, y, -x * sin + z * cos] as const;
}

function shade(nx: number, ny: number, nz: number) {
  return nx * 0.16 + ny * 0.38 + nz * 0.86;
}

function plot(pixels: string[][], depth: number[], x: number, y: number, z: number, light: number) {
  const depthOffset = 4.2;
  const scale = COLS * 1.04;
  const zz = z + depthOffset;
  if (zz <= 0.25) return;
  const inverse = 1 / zz;
  const column = (COLS / 2 + scale * inverse * x) | 0;
  const row = (ROWS / 2 - scale * inverse * y * 0.56) | 0;
  if (column < 0 || column >= COLS || row < 0 || row >= ROWS) return;
  const cell = row * COLS + column;
  if (inverse <= depth[cell]) return;
  depth[cell] = inverse;
  pixels[row][column] = LUM[Math.min(LUM.length - 1, Math.max(1, (1 + light * 8) | 0))] ?? '@';
}

function project(
  pixels: string[][],
  depth: number[],
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  yaw: number,
  pitch: number,
) {
  [x, y, z] = rotateY(x, y, z, yaw);
  [x, y, z] = rotateX(x, y, z, pitch);
  [nx, ny, nz] = rotateY(nx, ny, nz, yaw);
  [nx, ny, nz] = rotateX(nx, ny, nz, pitch);
  const light = shade(nx, ny, nz);
  if (light < 0.08) return;
  plot(pixels, depth, x, y, z, light);
}

function plotCapsule(
  pixels: string[][],
  depth: number[],
  x1: number,
  y1: number,
  z1: number,
  x2: number,
  y2: number,
  z2: number,
  radius: number,
  yaw: number,
  pitch: number,
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dz = z2 - z1;
  const length = Math.hypot(dx, dy, dz) || 1;
  const ax = dx / length;
  const ay = dy / length;
  const az = dz / length;
  let px = ay;
  let py = -ax;
  let pz = 0;
  if (Math.hypot(px, py, pz) < 0.12) {
    px = 0;
    py = az;
    pz = -ay;
  }
  const plen = Math.hypot(px, py, pz) || 1;
  px /= plen;
  py /= plen;
  pz /= plen;
  const qx = ay * pz - az * py;
  const qy = az * px - ax * pz;
  const qz = ax * py - ay * px;

  for (let t = 0; t <= 1; t += 0.035) {
    const cx = x1 + dx * t;
    const cy = y1 + dy * t;
    const cz = z1 + dz * t;
    for (let angle = 0; angle < Math.PI * 2; angle += 0.09) {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const nx = px * cos + qx * sin;
      const ny = py * cos + qy * sin;
      const nz = pz * cos + qz * sin;
      project(
        pixels,
        depth,
        cx + nx * radius,
        cy + ny * radius,
        cz + nz * radius,
        nx,
        ny,
        nz,
        yaw,
        pitch,
      );
    }
  }
}

function plotTorusArc(
  pixels: string[][],
  depth: number[],
  major: number,
  minor: number,
  thetaStart: number,
  thetaEnd: number,
  yaw: number,
  pitch: number,
  flip: boolean,
) {
  for (let theta = thetaStart; theta <= thetaEnd; theta += 0.04) {
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    for (let phi = 0; phi < Math.PI * 2; phi += 0.08) {
      const cosP = Math.cos(phi);
      const sinP = Math.sin(phi);
      let x = (major + minor * cosP) * cosT;
      let y = (major + minor * cosP) * sinT;
      let z = minor * sinP;
      let nx = cosP * cosT;
      let ny = cosP * sinT;
      let nz = sinP;
      if (flip) {
        x = -x;
        y = -y;
        z = -z;
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      project(pixels, depth, x, y, z, nx, ny, nz, yaw, pitch);
    }
  }
}

function renderMark(yaw: number, pitch: number, pixels: string[][], depth: number[]): string {
  for (let y = 0; y < ROWS; y += 1) {
    pixels[y].fill(' ');
    for (let x = 0; x < COLS; x += 1) depth[y * COLS + x] = 0;
  }

  const major = 1.08;
  const minor = 0.155;
  const thetaStart = (102 * Math.PI) / 180;
  const thetaEnd = (256 * Math.PI) / 180;

  for (const flip of [false, true]) {
    plotTorusArc(pixels, depth, major, minor, thetaStart, thetaEnd, yaw, pitch, flip);
    let x1 = major * Math.cos(thetaEnd);
    let y1 = major * Math.sin(thetaEnd);
    let x2 = 0.28;
    let y2 = -0.68;
    if (flip) {
      x1 = -x1;
      y1 = -y1;
      x2 = -x2;
      y2 = -y2;
    }
    plotCapsule(pixels, depth, x1, y1, 0, x2, y2, 0, minor, yaw, pitch);
  }

  return pixels.map((row) => row.join('')).join('\n');
}

export function LandingClock() {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const write = () => {
      node.textContent = clockStamp();
    };
    write();
    if (reduceMotion) return;
    const timer = window.setInterval(write, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return <span ref={ref} className="landingClock" />;
}

export function LandingBackdrop() {
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const node = preRef.current;
    if (!node) return;

    const pixels = Array.from({ length: ROWS }, () => Array<string>(COLS).fill(' '));
    const depth = new Array<number>(ROWS * COLS).fill(0);
    let time = 0;

    const paint = () => {
      const yaw = reduceMotion ? 0.25 : time * 0.62;
      const pitch = reduceMotion ? 0.18 : 0.22 + time * 0.31;
      node.textContent = renderMark(yaw, pitch, pixels, depth);
    };

    paint();
    if (reduceMotion) return;

    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      if (now - last >= 50) {
        last = now;
        time += 0.032;
        paint();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="landingBackdrop" aria-hidden="true">
      <pre ref={preRef} className="liveAscii" />
    </div>
  );
}

const RISKS = [
  {
    code: '01',
    title: 'Spend authority is unverified',
    detail: 'The agent has not proved it is authorized to commit this amount.',
  },
  {
    code: '02',
    title: 'The supplier payment destination changed',
    detail: 'No independent verification exists for the new beneficiary account.',
  },
  {
    code: '03',
    title: 'Acceptance terms are incomplete',
    detail: 'The agreement does not define inspection, rejection, or refund conditions.',
  },
] as const;

function ExchangeAgent({
  initials,
  role,
  align,
}: {
  initials: string;
  role: string;
  align: 'start' | 'end';
}) {
  return (
    <article className={`exchangeAgent is-${align}`}>
      <span className="exchangeGlyph">{initials}</span>
      <strong>{role}</strong>
    </article>
  );
}

function ExchangeRail({ inbound }: { inbound: boolean }) {
  return <span className={`exchangeRail${inbound ? ' is-inbound' : ''}`} aria-hidden="true" />;
}

export function LandingDiagram() {
  return (
    <div
      className="asciiDiagram"
      role="group"
      aria-label="Example of OpenClasp sitting between two agents to predict whether an agreement will complete"
    >
      <span className="sceneCorner sceneTL">+</span>
      <span className="sceneCorner sceneTR">+</span>
      <span className="sceneCorner sceneBL">+</span>
      <div className="diagramHud">
        <span>LIVE ASSESSMENT</span>
        <span className="diagramLive">
          <LandingClock />
        </span>
      </div>
      <div className="exchangeLane">
        <ExchangeAgent initials="RA" role="requesting agent" align="start" />
        <ExchangeRail inbound />
        <div className="claspHub">
          <ClaspMark className="hubMark" size={52} />
          <strong>openclasp</strong>
        </div>
        <ExchangeRail inbound={false} />
        <ExchangeAgent initials="PA" role="procurement agent" align="end" />
      </div>
      <div className="exchangeStem" aria-hidden="true" />
      <div className="insightSubject">
        <span>EXACT AGREEMENT</span>
        <strong>Place a $24,800 inventory order by Tuesday</strong>
      </div>
      <section className="insightStream" aria-labelledby="risk-title">
        <div className="insightScore">
          <div>
            <span>EXPERIMENTAL SUCCESS PREDICTION</span>
            <strong id="risk-title">
              <b className="insightScoreValue">64</b>
              <span className="insightScoreUnit">% likely to complete</span>
            </strong>
          </div>
          <small>42% confidence · cold start</small>
        </div>
        <ol className="insightRisks">
          {RISKS.map((risk) => (
            <li key={risk.code}>
              <span>{risk.code}</span>
              <div>
                <strong>{risk.title}</strong>
                <p>{risk.detail}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="insightNext">
          <article>
            <span>ASK</span>
            <strong id="guidance-title">
              Prove the approved spend limit and verified supplier payment destination.
            </strong>
          </article>
          <article>
            <span>LOCK</span>
            <strong>Human approval · lock supplier and maximum spend</strong>
          </article>
        </div>
      </section>
      <p className="diagramSpec">
        no conversation storage · predictions are advisory, not guarantees
      </p>
    </div>
  );
}
