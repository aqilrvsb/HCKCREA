// Laju v2 "Pro" scene kit, round 4 — two seller scenes there is no open-source piece for:
//   map      Malaysia: each spoken place lights its state (a pop + a pin dropping with a ripple and a label chip);
//            "seluruh Malaysia" sweeps every state on west → east; "Semenanjung" / "Sabah Sarawak" light their half
//   receipt  a receipt printing out of a slot: each item prints on its word, the total counts up, a stamp slams on
// Pure functions of the frame. Map data: overrides/malaysia.ts (Natural Earth, public domain).
import React from 'react';
import { AbsoluteFill, Easing, interpolate } from 'remotion';
import { W, clamp, fitSize } from '../../motion/src/lib';
import type { Face } from './look';
import { MAP_H, MAP_W, MY_CITIES, MY_STATES } from './malaysia';
import { textWidth } from './scenesKit';

const UI: Face = { family: "'Inter', sans-serif", weight: 800, charW: 0.6, upper: false, track: 0 };
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

const ALIAS: Record<string, string> = {
  penang: 'penang', pulaupinang: 'penang', pinang: 'penang', georgetown: 'penang',
  kl: 'kl', kualalumpur: 'kl', wpkualalumpur: 'kl', kualalumpurwp: 'kl',
  n9: 'n9', ns: 'n9', negerisembilan: 'n9', nogori: 'n9',
  melaka: 'melaka', malacca: 'melaka', johor: 'johor', jb: 'johor',
  terengganu: 'terengganu', ganu: 'terengganu', selangor: 'selangor', perak: 'perak', kedah: 'kedah', perlis: 'perlis', kelantan: 'kelantan',
  pahang: 'pahang', sabah: 'sabah', sarawak: 'sarawak', labuan: 'labuan', putrajaya: 'putrajaya',
};
const PENINSULA = ['perlis', 'kedah', 'penang', 'perak', 'kelantan', 'terengganu', 'pahang', 'selangor', 'kl', 'putrajaya', 'n9', 'melaka', 'johor'];
const EAST = ['sarawak', 'sabah', 'labuan'];

/** A spoken place → the states it lights and the pin point (none for a region). */
export const resolvePlace = (name: string): { states: string[]; pin?: { x: number; y: number }; all?: boolean } | null => {
  const n = norm(name);
  if (!n) return null;
  if (/^(seluruh|semua|all|malaysia|seluruhmalaysia|semuanegeri|semuanegeri\w*)$/.test(n) || n.includes('seluruh')) return { states: MY_STATES.map((s) => s.id), all: true };
  if (n.includes('semenanjung') || n.includes('peninsula') || n.includes('malaysiabarat')) return { states: PENINSULA, all: true };
  if (n.includes('sabahsarawak') || n.includes('borneo') || n.includes('malaysiatimur') || n.includes('sabahdansarawak')) return { states: EAST, all: true };
  const city = MY_CITIES.find((c) => norm(c.name) === n);
  if (city) return { states: [city.state], pin: { x: city.x, y: city.y } };
  const id = ALIAS[n] ?? MY_STATES.find((s) => norm(s.name) === n)?.id;
  if (!id) return null;
  const st = MY_STATES.find((s) => s.id === id)!;
  return { states: [id], pin: { x: st.cx, y: st.cy } };
};

export type MapPlace = { f: number; name: string; label?: string; tone?: string };

export const MapBody: React.FC<{ places: MapPlace[]; frame: number; s: number; dark: boolean; heading?: string; face: Face; colorOf: (t?: string) => string; hi: string }> =
  ({ places, frame, s, dark, heading, face, colorOf, hi }) => {
    const f = frame - s;
    const scale = Math.min(1000 / MAP_W, 860 / MAP_H);
    const ox = (W - MAP_W * scale) / 2;
    const oy = 1250 - MAP_H * scale;
    const resolved = places.map((p) => ({ ...p, r: resolvePlace(p.name) })).filter((p) => p.r);
    // each state's light: the first place that names it (a sweep staggers west → east)
    const lit = new Map<string, { at: number; col: string }>();
    const westOf = new Map(MY_STATES.map((st) => [st.id, st.west]));
    const wMin = Math.min(...MY_STATES.map((st) => st.west));
    const wMax = Math.max(...MY_STATES.map((st) => st.west));
    resolved.forEach((p, i) => {
      const col = colorOf(p.tone) || ['#FFD93B', '#3DDC97', '#4FB3FF', '#FF7A59', '#FF5FA2', '#B388FF'][i % 6];
      for (const id of p.r!.states) {
        if (lit.has(id)) continue;
        const delay = p.r!.all ? Math.round(((westOf.get(id)! - wMin) / Math.max(1, wMax - wMin)) * 16) : 0;
        lit.set(id, { at: p.f + delay, col });
      }
    });
    const base = dark ? '#2B3138' : '#D8D2C4';
    const edge = dark ? '#14171A' : '#FFFFFF';
    const enter = interpolate(f, [0, 8], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
    // label chips placed beside their pins, pushed down past earlier chips
    const chips: { x: number; y: number; w: number; h: number }[] = [];
    const chipSize = 40;
    return (
      <AbsoluteFill>
        {heading && (
          <div style={{ position: 'absolute', top: 250, left: 0, right: 0, textAlign: 'center', fontFamily: face.family, fontWeight: face.weight, letterSpacing: face.track,
            fontSize: fitSize(face.upper ? heading.toUpperCase() : heading, 76, W - 160, 1, face.charW, 34), color: dark ? '#FFD93B' : '#111',
            opacity: Math.min(1, f / 4) }}>{face.upper ? heading.toUpperCase() : heading}</div>
        )}
        <svg width={MAP_W * scale} height={MAP_H * scale} viewBox={`0 0 ${MAP_W} ${MAP_H}`}
          style={{ position: 'absolute', left: ox, top: oy, overflow: 'visible', opacity: enter, transform: `translateY(${((1 - enter) * 40).toFixed(1)}px)` }}>
          {MY_STATES.map((st) => {
            const l = lit.get(st.id);
            const d = l ? frame - l.at : -1;
            const k = d >= 0 ? interpolate(d, [0, 6], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) }) : 0;
            const pop = d >= 0 ? interpolate(d, [0, 4, 10], [1, 1.06, 1], clamp) : 1;
            return (
              <path key={st.id} d={st.d} fill={k > 0 ? mix(base, l!.col, k) : base} stroke={edge} strokeWidth={2} strokeLinejoin="round"
                transform={pop !== 1 ? `translate(${st.cx} ${st.cy}) scale(${pop.toFixed(3)}) translate(${-st.cx} ${-st.cy})` : undefined}
                style={k > 0.5 ? { filter: `drop-shadow(0 0 10px ${l!.col}88)` } : undefined} />
            );
          })}
          {resolved.map((p, i) => {
            const d = frame - p.f;
            if (d < 0 || !p.r!.pin) return null;
            const { x, y } = p.r!.pin;
            const drop = interpolate(d, [0, 7], [-90, 0], { ...clamp, easing: Easing.out(Easing.bounce) });
            const ring = interpolate(d, [4, 24], [0, 1], clamp);
            const col = lit.get(p.r!.states[0])?.col ?? hi;
            return (
              <g key={`pin${i}`}>
                {ring > 0 && ring < 1 && <circle cx={x} cy={y} r={10 + 60 * ring} fill="none" stroke={col} strokeWidth={5} opacity={1 - ring} />}
                <g transform={`translate(${x} ${y + drop})`}>
                  <path d="M0 0 C -6 -14 -22 -24 -22 -40 A 22 22 0 1 1 22 -40 C 22 -24 6 -14 0 0 Z" fill={dark ? '#fff' : '#111'} stroke={col} strokeWidth={4} />
                  <circle cx={0} cy={-40} r={8} fill={col} />
                </g>
              </g>
            );
          })}
        </svg>
        {resolved.map((p, i) => {
          const d = frame - p.f;
          const text = (p.label || (p.r!.all ? p.name : p.name)).toUpperCase();
          if (d < 3) return null;
          const k = interpolate(d, [3, 9], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.8)) });
          const tw = textWidth(text, UI, chipSize) + 36;
          const th = chipSize * 1.5;
          const hits = (cx: number, cy: number) => chips.some((c) => cx < c.x + c.w + 8 && cx + tw + 8 > c.x && cy < c.y + c.h + 8 && cy + th + 8 > c.y);
          const fit = (cx: number) => Math.max(30, Math.min(W - 30 - tw, cx));
          let x: number;
          let y: number;
          if (!p.r!.pin) {
            // a region: one chip over the map's top
            x = (W - tw) / 2;
            y = oy - 10;
          } else {
            // beside its pin: right, left, above, below — the first spot no other chip holds
            const px = ox + p.r!.pin.x * scale;
            const py = oy + p.r!.pin.y * scale - 46 * scale;
            const spots: [number, number][] = [[px + 34, py - th / 2], [px - 34 - tw, py - th / 2], [px - tw / 2, py - 70 - th], [px - tw / 2, py + 40]];
            const ok = spots.map(([cx, cy]) => [fit(cx), cy] as [number, number]).find(([cx, cy], k) => !hits(cx, cy) && (k > 1 || Math.abs(cx - spots[k][0]) < 40));
            [x, y] = ok ?? [fit(spots[0][0]), spots[0][1]];
          }
          x = fit(x);
          for (let guard = 0; guard < 8 && hits(x, y); guard++) y += th + 10;
          chips.push({ x, y, w: tw, h: th });
          const col = lit.get(p.r!.states[0])?.col ?? hi;
          return (
            <div key={`chip${i}`} style={{ position: 'absolute', left: x, top: y, height: th, padding: '0 18px', display: 'flex', alignItems: 'center', borderRadius: 14,
              background: dark ? '#fff' : '#111', color: dark ? '#111' : '#fff', borderLeft: `10px solid ${col}`, fontFamily: UI.family, fontWeight: 800, fontSize: chipSize,
              whiteSpace: 'nowrap', transform: `scale(${k.toFixed(3)})`, transformOrigin: x < (ox + (p.r!.pin?.x ?? 0) * scale) ? 'right center' : 'left center',
              boxShadow: '0 8px 18px rgba(0,0,0,0.35)' }}>{text}</div>
          );
        })}
      </AbsoluteFill>
    );
  };

/** Blend two #RRGGBB colours (k = 0 → a, 1 → b). */
const mix = (a: string, b: string, k: number) => {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt((b.length === 7 ? b : '#FFD93B').slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * k)).join(',')})`;
};

// ── receipt ──────────────────────────────────────────────────────────────────

export type ReceiptItem = { f: number; label: string; value: string };

/** The first number in `text` counted up (d frames after it lands), the rest of the text kept. */
const countUp = (text: string, d: number) => {
  const m = text.match(/\d[\d.,]*/);
  if (!m || m.index === undefined) return text;
  const raw = m[0].replace(/[.,]$/, '');
  const dec = /[.,]\d{1,2}$/.test(raw) ? raw.split(/[.,]/).pop()!.length : 0;
  const num = parseFloat(raw.replace(/,(?=\d{3}\b)/g, '').replace(',', '.'));
  if (!Number.isFinite(num)) return text;
  const p = interpolate(d, [0, 18], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  return text.slice(0, m.index) + (num * p).toFixed(dec) + text.slice(m.index + raw.length);
};

export const ReceiptBody: React.FC<{ title?: string; items: ReceiptItem[]; total?: ReceiptItem; stamp?: { f: number; text: string }; frame: number; s: number; date?: string }> =
  ({ title, items, total, stamp, frame, s, date }) => {
    const f = frame - s;
    const PW = 820;
    const left = (W - PW) / 2;
    const slotY = 330;
    const ROW = 96;
    const head = 150;
    const rows = [...items, ...(total ? [total] : [])];
    // printed height follows the items that have landed (each prints over 6 frames)
    let printed = head * interpolate(f, [0, 8], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
    rows.forEach((r, i) => { printed += (i === items.length ? ROW + 30 : ROW) * interpolate(frame - r.f, [0, 6], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) }); });
    const paperH = printed + 50;
    // zig-zag torn edge at the bottom
    const teeth = 24;
    const zig = Array.from({ length: teeth + 1 }, (_, i) => `${((i / teeth) * 100).toFixed(2)}% ${i % 2 ? 'calc(100% - 18px)' : '100%'}`).join(', ');
    const labelSize = fitSize(rows.map((r) => r.label).sort((a, b) => b.length - a.length)[0]?.toUpperCase() ?? '', 56, PW - 330, 1, 0.62, 32);
    return (
      <AbsoluteFill>
        {/* the printer slot */}
        <div style={{ position: 'absolute', left: left - 60, width: PW + 120, top: slotY - 46, height: 70, borderRadius: 20, background: '#1d1f22',
          boxShadow: '0 14px 30px rgba(0,0,0,0.45), inset 0 -10px 0 #0e0f11' }} />
        <div style={{ position: 'absolute', left, width: PW, top: slotY, height: 1560, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: paperH, background: '#FBFAF6', clipPath: `polygon(0 0, 100% 0, 100% calc(100% - 18px), ${zig}, 0 calc(100% - 18px))`,
            boxShadow: '0 20px 40px rgba(0,0,0,0.3)', backgroundImage: 'radial-gradient(rgba(0,0,0,0.035) 1px, transparent 1.4px)', backgroundSize: '7px 7px' }}>
            <div style={{ padding: '44px 46px 0', fontFamily: UI.family, color: '#1a1a1a' }}>
              <div style={{ textAlign: 'center', fontWeight: 900, fontSize: fitSize((title ?? 'RESIT').toUpperCase(), 62, PW - 100, 1, 0.66, 30), letterSpacing: 2 }}>{(title ?? 'RESIT').toUpperCase()}</div>
              <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 24, color: '#777', marginTop: 6, letterSpacing: 3 }}>{date ? date.toUpperCase() : '* * * * * * * * * *'}</div>
              <div style={{ borderTop: '3px dashed #bbb', margin: '20px 0 8px' }} />
              {rows.map((r, i) => {
                const d = frame - r.f;
                if (d < 0) return null;
                const isTotal = total && i === items.length;
                const k = interpolate(d, [0, 5], [0, 1], clamp);
                return (
                  <React.Fragment key={i}>
                    {isTotal && <div style={{ borderTop: '4px double #333', margin: '10px 0 6px' }} />}
                    <div style={{ display: 'flex', alignItems: 'baseline', height: isTotal ? ROW + 10 : ROW, opacity: k, gap: 14 }}>
                      <span style={{ fontWeight: isTotal ? 900 : 800, fontSize: isTotal ? labelSize * 1.15 : labelSize, whiteSpace: 'nowrap' }}>{r.label.toUpperCase()}</span>
                      <span style={{ flex: 1, borderBottom: '3px dotted #c9c9c9', transform: 'translateY(-8px)' }} />
                      <span style={{ fontWeight: 900, fontSize: isTotal ? 74 : 56, fontVariantNumeric: 'tabular-nums', color: isTotal ? '#E5262B' : '#1a1a1a', whiteSpace: 'nowrap' }}>
                        {isTotal ? countUp(r.value, d) : r.value}</span>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </div>
        {stamp && frame >= stamp.f && (() => {
          const d = frame - stamp.f;
          const k = interpolate(d, [0, 4], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
          const text = stamp.text.toUpperCase();
          const size = fitSize(text, 96, 560, 1, 0.66, 40);
          return (
            // straddling the receipt's torn bottom edge (the totals above it stay readable)
            <div style={{ position: 'absolute', left: W / 2 + 60, top: slotY + paperH - 8, transform: `translateX(-50%) rotate(-10deg) scale(${(2 - k).toFixed(3)})`,
              opacity: Math.min(1, k * 1.4) * 0.92, border: '10px solid #E5262B', borderRadius: 22, padding: '6px 28px', color: '#E5262B', fontFamily: "'Archivo Black', sans-serif",
              fontSize: size, letterSpacing: 2, whiteSpace: 'nowrap', background: 'rgba(255,255,255,0.0)' }}>{text}</div>
          );
        })()}
      </AbsoluteFill>
    );
  };
