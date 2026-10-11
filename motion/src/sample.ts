// Studio / local-still preview props. Real jobs pass their own props.
import type { AdProps, EditProps } from './types';

const w = (s: string, start: number, step = 0.32) => s.split(' ').map((x, k) => ({ w: x, t: +(start + k * step).toFixed(2) }));

export const SAMPLE_AD: AdProps = {
  fps: 30,
  durationInFrames: 30 * 16,
  captions: true,
  captionStyle: 'pop',
  sfx: false,
  images: [],
  brand: { name: 'Kopi Pening', tagline: 'Sedap, pekat, tak pening.', price: 'RM19', oldPrice: 'RM29', cta: 'Order di TikTok Shop', handle: '@kopipening', accent: '#22c55e' },
  lines: [
    { id: 'l1', act: 'hook', text: 'Pagi-pagi dah mengantuk?', audioStart: 0.35, audioDur: 1.6, sceneStart: 0, sceneEnd: 2.3, words: w('Pagi-pagi dah mengantuk?', 0) },
    { id: 'l2', act: 'pain', text: 'Kopi biasa tak jalan langsung.', audioStart: 2.3, audioDur: 1.9, sceneStart: 2.3, sceneEnd: 4.6, words: w('Kopi biasa tak jalan langsung.', 0) },
    { id: 'l3', act: 'reveal', text: 'Cuba Kopi Pening, pekat dan wangi.', audioStart: 4.6, audioDur: 2.2, sceneStart: 4.6, sceneEnd: 7.2, words: w('Cuba Kopi Pening, pekat dan wangi.', 0) },
    { id: 'l4', act: 'price', text: 'Sekarang cuma sembilan belas ringgit.', audioStart: 7.2, audioDur: 2.2, sceneStart: 7.2, sceneEnd: 9.8, words: w('Sekarang cuma sembilan belas ringgit.', 0) },
    { id: 'l5', act: 'cta', text: 'Order sekarang sebelum habis!', audioStart: 9.8, audioDur: 1.9, sceneStart: 9.8, sceneEnd: 12.2, words: w('Order sekarang sebelum habis!', 0) },
    { id: 'l6', act: 'end', text: 'Kopi Pening.', audioStart: 12.2, audioDur: 1, sceneStart: 12.2, sceneEnd: 16, words: w('Kopi Pening.', 0) },
  ],
  scenes: [
    { id: 's1', from: 'l1', bg: 'dark', items: [{ t: 'headline', text: 'MENGANTUK LAGI?', at: 'l1@mengantuk', zone: 'top' }, { t: 'emoji', text: '😴', at: 'l1+0.6', zone: 'middle' }] },
    { id: 's2', from: 'l2', bg: 'mat', items: [{ t: 'note', text: 'Kopi biasa', sub: 'tak jalan', mark: 'cross', at: 'l2@kopi', zone: 'middle' }, { t: 'scribble', text: 'hmm...', at: 'l2@langsung', zone: 'bottom' }] },
    { id: 's3', from: 'l3', bg: 'accent', items: [{ t: 'tag', text: 'BARU!', at: 'l3@cuba', zone: 'top' }, { t: 'check', text: 'Pekat', at: 'l3@pekat', zone: 'bottom' }, { t: 'check', text: 'Wangi', at: 'l3@wangi', zone: 'bottom' }] },
    { id: 's4', from: 'l4', bg: 'paper', items: [{ t: 'price', text: 'RM19', sub: 'RM29', at: 'l4@sembilan', zone: 'middle' }, { t: 'stamp', text: 'JIMAT', at: 'l4@ringgit', zone: 'top' }] },
    { id: 's5', from: 'l5', bg: 'dark', items: [{ t: 'counter', text: '1,200+', sub: 'pelanggan puas hati', at: 'l5@order', zone: 'top' }, { t: 'chip', text: 'Stok terhad', at: 'l5@habis', zone: 'bottom' }] },
    { id: 's6', from: 'l6', endcard: true, items: [] },
  ],
};

export const SAMPLE_EDIT: EditProps = {
  fps: 30,
  durationInFrames: 30 * 8,
  video: '',
  words: w('Hari ni saya nak tunjuk cara buat kopi paling sedap guna tiga bahan sahaja', 0.3, 0.42),
  captions: { on: true, style: 'pop', pos: 'low', maxWords: 3 },
  accent: '#FFD93B',
  overlays: [
    { t: 'emoji', text: '☕', at: 'w9', zone: 'middle' },
    { t: 'counter', text: '3', sub: 'bahan sahaja', at: 'w11', zone: 'top' },
  ],
  zooms: [{ at: 'w6', to: 'w9', scale: 1.15 }],
  hook: { text: 'KOPI PALING SEDAP', sub: 'resepi 3 bahan' },
  sfx: false,
};
