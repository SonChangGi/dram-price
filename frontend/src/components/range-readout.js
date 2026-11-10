/* Quant 0.4.4. Render adapter-owned values next to their selection. Classic script and side-effect module. */
(() => {
  'use strict';

  const isFinite = Number.isFinite;
  const signed = new Intl.NumberFormat('ko-KR', {maximumFractionDigits: 2, signDisplay: 'exceptZero'});
  const smallSigned = new Intl.NumberFormat('ko-KR', {maximumSignificantDigits: 2, signDisplay: 'exceptZero'});
  const signedChange = (value, unit = '') => isFinite(value) ? (value !== 0 && Math.abs(value) < .01 ? smallSigned : signed).format(value) + unit : '—';

  function zeroBasedAxis(values, minimumTop = 4) {
    let peak = minimumTop;
    for (const value of values) if (isFinite(value) && value > peak) peak = value;
    const target = peak === minimumTop ? peak : peak * 1.035;
    const scale = 10 ** Math.floor(Math.log10(target / 5));
    const steps = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map(x => x * scale);
    const choices = steps.map(interval => {
      const count = Math.ceil(target / interval - 1e-10);
      return {min: 0, max: Number((count * interval).toPrecision(10)), interval, count};
    }).filter(c => c.count >= 4 && c.count <= 6);
    const {min, max, interval} = choices.sort((a, b) => a.max - b.max || Math.abs(a.count - 5) - Math.abs(b.count - 5))[0];
    return {min, max, interval};
  }

  function insideLimit(width, height) {
    if (height < 108 || width < 158) return 0;
    if (height >= 210 && width >= 450) return 3;
    if (height >= 145 && width >= 202) return 2;
    return 1;
  }

  function placeInside(bounds, size, band, avoid = []) {
    const {left, top, width, height} = bounds;
    const inset = 6;
    const lo = left + inset, hi = left + width - size.width - inset;
    const up = top + inset, down = top + height - size.height - inset;
    if (hi < lo || down < up || size.height > height * .54) return null;
    const [first, last] = band?.every(isFinite) ? [...band].sort((a, b) => a - b) : [NaN, NaN];
    if (last < left || first > left + width) return null;
    const candidates = [[hi, up], [lo, up], [hi, down], [lo, down]];
    // Favor a side outside the interval. Endpoints get precedence over decoration.
    const score = ([x, y]) => {
      const hits = avoid.filter(p => Array.isArray(p) && p[0] >= x - 5 && p[0] <= x + size.width + 5 &&
        p[1] >= y - 5 && p[1] <= y + size.height + 5).length;
      const bandOverlap = isFinite(first) ? Math.max(0, Math.min(x + size.width, last) - Math.max(x, first)) : 0;
      return hits * (width + 1) + bandOverlap;
    };
    const [x, y] = candidates.sort((a, b) => score(a) - score(b))[0];
    return {left: x, top: y};
  }

  /** ECharts geometry expressed in the same CSS pixels as the plot node. */
  function echartsGeometry(chart, band, avoid, gridIndex = 0) {
    const rect = chart.getModel?.()?.getComponent('grid', gridIndex)?.coordinateSystem?.getRect();
    if (!rect) return null;
    return {bounds: {left: rect.x, top: rect.y, width: rect.width, height: rect.height}, band, avoid};
  }

  /** Use plain SVG label fills and move edge labels back toward the plot. */
  function scatterLabel(color, x, y, max) {
    return {show: true, color, position: y > max * .88 ? 'bottom' : x > max * .92 ? 'left' : x < max * .08 ? 'right' : 'top',
      fontSize: 11, fontWeight: 650, distance: 5, textBorderColor: 'transparent', textBorderWidth: 0};
  }

  /**
   * Output is a renderer-owned sibling immediately after the plot. The same
   * semantic node moves into the plot when there is room; no duplicate live region.
   * `model`: {start?, end?, title?, items: [{name, change, detail?, color?}], note?, dense?}.
   */
  function createRangeReadout(surface, output, host = surface) {
    const doc = surface.ownerDocument;
    const home = doc.createComment('range readout');
    output.before(home);
    const layer = doc.createElement('div');
    layer.dataset.quantRangeLayer = '';
    const fallback = doc.createElement('span');
    fallback.dataset.quantRangeFallback = '';
    fallback.textContent = '구간 결과 · 차트 아래';
    fallback.setAttribute('aria-hidden', 'true');
    fallback.hidden = true;
    host.dataset.quantRangeHost = '';
    layer.append(fallback);
    host.append(layer);
    if (!output.hasAttribute('aria-live')) output.setAttribute('aria-live', 'polite');
    output.setAttribute('aria-atomic', 'true');

    let model = null, contentKey = '';
    const node = (tag, className, value) => {
      const el = doc.createElement(tag);
      el.className = className;
      if (value != null) el.textContent = value;
      return el;
    };
    function restore() {
      if (output.parentNode !== home.parentNode) home.after(output);
    }
    function clear() {
      model = null;
      output.hidden = true;
      fallback.hidden = true;
      restore();
    }
    function set(next) {
      model = next;
      const key = JSON.stringify(next);
      if (key === contentKey) return;
      contentKey = key;
      const heading = node('div', 'qs-range-title');
      heading.append(node('strong', 'qs-range-caption', next.title || '구간 변화'));
      if (next.start != null && next.end != null) {
        heading.append(node('span', 'qs-range-period', next.start + ' → ' + next.end));
      }
      const list = node('ul', 'qs-range-items');
      for (const item of next.items || []) {
        const li = doc.createElement('li');
        const name = node('span', 'qs-range-name');
        if (item.color) {
          const swatch = node('i', 'qs-range-swatch');
          swatch.setAttribute('aria-hidden', 'true');
          swatch.style.setProperty('--qs-series', item.color);
          name.append(swatch);
        }
        name.append(doc.createTextNode(item.name));
        li.append(name, node('b', 'qs-range-value', item.change));
        if (item.detail) li.append(node('span', 'qs-range-detail', item.detail));
        list.append(li);
      }
      output.replaceChildren(heading, list);
      if (next.note) output.append(node('small', 'qs-range-note', next.note));
    }
    function place(geometry) {
      if (!model) return;
      const count = model.items?.length || 0;
      const bounds = geometry?.bounds;
      const dx = surface === host ? 0 : surface.getBoundingClientRect().left - host.getBoundingClientRect().left;
      const dy = surface === host ? 0 : surface.getBoundingClientRect().top - host.getBoundingClientRect().top;
      let position;
      if (bounds && count && !model.dense && count <= insideLimit(bounds.width, bounds.height)) {
        if (output.parentNode !== layer) layer.append(output);
        output.dataset.quantRangeOutput = 'inline';
        const width = Math.min(bounds.width - 12, count === 3 ? 248 : 214);
        output.style.setProperty('--qs-range-width', width + 'px');
        output.hidden = false;
        position = placeInside(bounds, {width: output.offsetWidth, height: output.offsetHeight}, geometry.band, geometry.avoid);
      }
      fallback.hidden = !!position || !bounds || bounds.width < 155 || bounds.height < 84;
      if (position) {
        output.style.left = (dx + position.left) + 'px';
        output.style.top = (dy + position.top) + 'px';
      } else {
        restore();
        output.dataset.quantRangeOutput = 'below';
        output.style.removeProperty('left');
        output.style.removeProperty('top');
        if (!fallback.hidden) {
          fallback.style.left = (dx + bounds.left + 6) + 'px';
          fallback.style.top = (dy + bounds.top + 5) + 'px';
        }
      }
      output.hidden = false;
    }
    return {show(next, geometry) {set(next); place(geometry);}, place, clear, destroy() {
      clear(); layer.remove(); home.remove(); delete host.dataset.quantRangeHost; delete output.dataset.quantRangeOutput;
    }};
  }

  globalThis.QuantRangeReadout = Object.freeze({createRangeReadout, echartsGeometry, signedChange, zeroBasedAxis, scatterLabel, insideLimit, placeInside});
})();
